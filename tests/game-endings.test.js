const assert = require('assert');
const ChessEngine = require('../src/engine/chess');
const ChaosEngine = require('../src/engine/chaos');
const actionHandler = require('../netlify/functions/match-action').handler;
const Multiplayer = require('../src/online/multiplayer');

async function runGameEndingsTests() {
  console.log('--- Running Stage 7 Game Endings & Player Actions Tests ---');

  const { newPos, FULL, make, san, inCheck, legal, posKey } = ChessEngine;

  // --------------------------------------------------------------------------
  // Test 1: Netlify match-action function endpoint checks
  // --------------------------------------------------------------------------
  const optRes = await actionHandler({ httpMethod: 'OPTIONS', headers: {} });
  assert.strictEqual(optRes.statusCode, 204, 'OPTIONS should return 204');
  console.log('  PASS: match-action CORS preflight returns 204.');

  const noAuthRes = await actionHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ matchId: 'm1', action: 'resign' })
  });
  assert.strictEqual(noAuthRes.statusCode, 401, 'Missing auth should return 401');
  console.log('  PASS: match-action rejects unauthenticated request with 401.');

  // --------------------------------------------------------------------------
  // Test 2: In-Memory Authoritative Server Action & Ending Simulation
  // --------------------------------------------------------------------------
  class TestServer {
    constructor() {
      this.matches = new Map();
      this.matchMoves = [];
    }

    createMatch(whiteId, blackId, customPos = null) {
      const matchId = 'm_' + Math.random().toString(36).substring(2, 9);
      const pos = customPos || newPos(FULL);
      const match = {
        id: matchId,
        white_player_id: whiteId,
        black_player_id: blackId,
        status: 'active',
        current_turn: pos.turn,
        state_version: 0,
        seed: 12345,
        board_ranks: pos.b.length,
        result: null,
        winner_id: null,
        chaos_settings: { on: true, every: 5, burst: 1 },
        game_state: {
          pos,
          hist: [],
          sans: [],
          scol: [],
          caps: [],
          seen: { [posKey(pos)]: 1 },
          chaos: { seed: 12345, meter: 9, max: 9, n: 0, next: null, last: null },
          draw_offer_by: null
        }
      };
      this.matches.set(matchId, match);
      return match;
    }

    processAction(userId, matchId, action) {
      const match = this.matches.get(matchId);
      if (!match) return { statusCode: 404, error: 'Match not found' };

      const isWhite = match.white_player_id === userId;
      const isBlack = match.black_player_id === userId;
      if (!isWhite && !isBlack) {
        return { statusCode: 403, error: 'You are not a participant in this match' };
      }

      if (match.status !== 'active') {
        return { statusCode: 400, error: 'Match has already concluded', status: match.status, result: match.result };
      }

      if (action === 'resign') {
        const resigningColor = isWhite ? 'White' : 'Black';
        const winningColor = isWhite ? 'Black' : 'White';
        const winnerId = isWhite ? match.black_player_id : match.white_player_id;
        const resultString = `${resigningColor} resigns. ${winningColor} wins`;

        match.status = 'completed';
        match.result = resultString;
        match.winner_id = winnerId;

        return { statusCode: 200, success: true, status: 'completed', result: resultString, winnerId };
      }

      if (action === 'offer_draw') {
        const opponentId = isWhite ? match.black_player_id : match.white_player_id;
        if (match.game_state.draw_offer_by === opponentId) {
          const resultString = 'Draw agreed by both players';
          match.status = 'completed';
          match.result = resultString;
          match.winner_id = null;
          return { statusCode: 200, success: true, status: 'completed', result: resultString };
        }

        match.game_state.draw_offer_by = userId;
        return { statusCode: 200, success: true, status: 'active', drawOffered: true };
      }

      if (action === 'accept_draw') {
        const opponentId = isWhite ? match.black_player_id : match.white_player_id;
        if (match.game_state.draw_offer_by !== opponentId) {
          return { statusCode: 400, error: 'No draw offer pending from opponent' };
        }

        const resultString = 'Draw agreed by both players';
        match.status = 'completed';
        match.result = resultString;
        match.winner_id = null;
        return { statusCode: 200, success: true, status: 'completed', result: resultString };
      }

      return { statusCode: 400, error: 'Unknown action: ' + action };
    }

    processMove(userId, matchId, stateVersion, move) {
      const match = this.matches.get(matchId);
      if (!match) return { statusCode: 404, error: 'Match not found' };

      const isWhite = match.white_player_id === userId;
      const isBlack = match.black_player_id === userId;
      if (!isWhite && !isBlack) return { statusCode: 403, error: 'Not participant' };

      const playerColor = isWhite ? 'w' : 'b';

      // Idempotency check before turn or status
      if (stateVersion < match.state_version) {
        const existing = this.matchMoves.find(m =>
          m.match_id === matchId &&
          m.move_number === stateVersion + 1 &&
          m.player_id === userId &&
          m.move_data.r === move.r &&
          m.move_data.f === move.f &&
          m.move_data.tr === move.tr &&
          m.move_data.tf === move.tf
        );
        if (existing) {
          return { statusCode: 200, success: true, idempotent: true, status: match.status, result: match.result };
        }
        return { statusCode: 409, error: 'Stale state version' };
      }

      if (match.status !== 'active') {
        return { statusCode: 400, error: 'Match has already concluded', status: match.status, result: match.result };
      }

      if (match.current_turn !== playerColor) {
        return { statusCode: 400, error: 'Not your turn' };
      }

      const currentPos = match.game_state.pos;
      const legalMoves = ChessEngine.legal(currentPos);
      const validMove = legalMoves.find(m =>
        m.r === move.r && m.f === move.f && m.tr === move.tr && m.tf === move.tf &&
        (!move.promo || m.promo === move.promo)
      );
      if (!validMove) return { statusCode: 400, error: 'Illegal move' };

      const sanStr = ChessEngine.san(currentPos, validMove, legalMoves);
      const nextPos = ChessEngine.make(currentPos, validMove);
      const inChk = ChessEngine.inCheck(nextPos);
      const isMate = inChk && !ChessEngine.legal(nextPos).length;
      const finalSan = sanStr + (isMate ? '#' : inChk ? '+' : '');

      const nextStateVersion = match.state_version + 1;
      const posKeyStr = ChessEngine.posKey(nextPos);
      const nextSeen = { ...match.game_state.seen, [posKeyStr]: (match.game_state.seen[posKeyStr] || 0) + 1 };

      const authoritativeG = {
        pos: nextPos,
        chaos: { ...match.game_state.chaos },
        seen: nextSeen,
        hist: [...match.game_state.hist, validMove]
      };

      const chaosResult = isMate ? null : ChaosEngine.chaosTick(authoritativeG, true);
      const finalPos = authoritativeG.pos;
      const gameStatus = ChessEngine.status(authoritativeG);

      let matchStatus = 'active';
      let matchResult = null;
      let winnerId = null;

      if (gameStatus.over) {
        matchStatus = 'completed';
        matchResult = gameStatus.text;
        if (gameStatus.text.includes('wins by checkmate')) {
          winnerId = userId;
        } else {
          winnerId = null;
        }
      }

      const updatedGameState = {
        ...match.game_state,
        pos: finalPos,
        hist: authoritativeG.hist,
        sans: [...match.game_state.sans, finalSan],
        scol: [...match.game_state.scol, playerColor],
        seen: authoritativeG.seen,
        chaos: authoritativeG.chaos,
        draw_offer_by: null // Move resets draw offers
      };

      this.matchMoves.push({
        match_id: matchId,
        move_number: nextStateVersion,
        player_id: userId,
        color: playerColor,
        san: finalSan,
        move_data: validMove
      });

      match.state_version = nextStateVersion;
      match.current_turn = finalPos.turn;
      match.board_ranks = finalPos.b.length;
      match.game_state = updatedGameState;
      match.status = matchStatus;
      match.result = matchResult;
      match.winner_id = winnerId;

      return {
        statusCode: 200,
        success: true,
        status: matchStatus,
        result: matchResult,
        winnerId,
        stateVersion: nextStateVersion
      };
    }
  }

  const server = new TestServer();
  const playerW = 'usr_white_001';
  const playerB = 'usr_black_002';
  const spectator = 'usr_spectator_999';

  // --------------------------------------------------------------------------
  // Test 3: Resignation Flow & Result Immutability
  // --------------------------------------------------------------------------
  const match1 = server.createMatch(playerW, playerB);

  // Spectator cannot resign
  const specResign = server.processAction(spectator, match1.id, 'resign');
  assert.strictEqual(specResign.statusCode, 403, 'Spectator cannot resign');

  // White resigns
  const whiteResign = server.processAction(playerW, match1.id, 'resign');
  assert.strictEqual(whiteResign.statusCode, 200);
  assert.strictEqual(whiteResign.status, 'completed');
  assert.strictEqual(whiteResign.result, 'White resigns. Black wins');
  assert.strictEqual(whiteResign.winnerId, playerB);
  assert.strictEqual(match1.status, 'completed');
  assert.strictEqual(match1.winner_id, playerB);
  console.log('  PASS: White resignation marks match completed with Black as winner.');

  // Subsequent resignation attempt rejected
  const blackResignAfter = server.processAction(playerB, match1.id, 'resign');
  assert.strictEqual(blackResignAfter.statusCode, 400);
  assert.strictEqual(blackResignAfter.error, 'Match has already concluded');
  console.log('  PASS: Resignation on completed match rejected with 400.');

  // Subsequent move attempt on completed match rejected
  const moveAfterResign = server.processMove(playerW, match1.id, 0, { r: 6, f: 4, tr: 4, tf: 4 });
  assert.strictEqual(moveAfterResign.statusCode, 400);
  assert.strictEqual(moveAfterResign.error, 'Match has already concluded');
  console.log('  PASS: Moves on completed match rejected with 400.');

  // --------------------------------------------------------------------------
  // Test 4: Draw Offer and Mutual Agreement Flow
  // --------------------------------------------------------------------------
  const match2 = server.createMatch(playerW, playerB);

  // Black tries to accept draw before any offer
  const prematureAccept = server.processAction(playerB, match2.id, 'accept_draw');
  assert.strictEqual(prematureAccept.statusCode, 400);
  assert.strictEqual(prematureAccept.error, 'No draw offer pending from opponent');

  // White offers draw
  const whiteOffer = server.processAction(playerW, match2.id, 'offer_draw');
  assert.strictEqual(whiteOffer.statusCode, 200);
  assert.strictEqual(whiteOffer.status, 'active');
  assert.strictEqual(match2.game_state.draw_offer_by, playerW);
  console.log('  PASS: Draw offer records pending offer in game state.');

  // Black accepts draw
  const blackAccept = server.processAction(playerB, match2.id, 'accept_draw');
  assert.strictEqual(blackAccept.statusCode, 200);
  assert.strictEqual(blackAccept.status, 'completed');
  assert.strictEqual(blackAccept.result, 'Draw agreed by both players');
  assert.strictEqual(match2.status, 'completed');
  assert.strictEqual(match2.winner_id, null);
  console.log('  PASS: Draw acceptance finalizes match as completed with winner_id: null.');

  // --------------------------------------------------------------------------
  // Test 5: Move implicitly resets pending draw offer
  // --------------------------------------------------------------------------
  const match3 = server.createMatch(playerW, playerB);
  server.processAction(playerB, match3.id, 'offer_draw');
  assert.strictEqual(match3.game_state.draw_offer_by, playerB);

  // White makes a move instead of accepting draw
  const moveRes = server.processMove(playerW, match3.id, 0, { r: 6, f: 4, tr: 4, tf: 4 }); // 1. e4
  assert.strictEqual(moveRes.statusCode, 200);
  assert.strictEqual(match3.game_state.draw_offer_by, null, 'Move should reset pending draw offer');
  console.log('  PASS: Playing a move cancels any pending draw offer.');

  // --------------------------------------------------------------------------
  // Test 6: Checkmate Ending (Fool\'s Mate)
  // --------------------------------------------------------------------------
  const match4 = server.createMatch(playerW, playerB);

  // 1. f3
  const m1 = server.processMove(playerW, match4.id, 0, { r: 6, f: 5, tr: 5, tf: 5 });
  assert.strictEqual(m1.statusCode, 200);
  assert.strictEqual(m1.status, 'active');

  // 1... e5
  const m2 = server.processMove(playerB, match4.id, 1, { r: 1, f: 4, tr: 3, tf: 4 });
  assert.strictEqual(m2.statusCode, 200);
  assert.strictEqual(m2.status, 'active');

  // 2. g4
  const m3 = server.processMove(playerW, match4.id, 2, { r: 6, f: 6, tr: 4, tf: 6 });
  assert.strictEqual(m3.statusCode, 200);
  assert.strictEqual(m3.status, 'active');

  // 2... Qh4# (Fool\'s Mate checkmate by Black)
  const m4 = server.processMove(playerB, match4.id, 3, { r: 0, f: 3, tr: 4, tf: 7 });
  assert.strictEqual(m4.statusCode, 200);
  assert.strictEqual(m4.status, 'completed');
  assert.strictEqual(m4.result, 'Black wins by checkmate');
  assert.strictEqual(m4.winnerId, playerB);
  assert.strictEqual(match4.status, 'completed');
  assert.strictEqual(match4.winner_id, playerB);
  console.log('  PASS: Fool\'s mate automatically finalizes match with Black checkmate victory.');

  // Further moves are blocked
  const postMateMove = server.processMove(playerW, match4.id, 4, { r: 6, f: 0, tr: 5, tf: 0 });
  assert.strictEqual(postMateMove.statusCode, 400);
  assert.strictEqual(postMateMove.error, 'Match has already concluded');
  console.log('  PASS: Moves after checkmate are rejected.');

  // Idempotent retry of winning move is permitted
  const retryWinningMove = server.processMove(playerB, match4.id, 3, { r: 0, f: 3, tr: 4, tf: 7 });
  assert.strictEqual(retryWinningMove.statusCode, 200);
  assert.strictEqual(retryWinningMove.idempotent, true);
  assert.strictEqual(retryWinningMove.status, 'completed');
  console.log('  PASS: Idempotent retry of checkmating move succeeds with completed status.');

  // --------------------------------------------------------------------------
  // Test 7: Stalemate Detection
  // --------------------------------------------------------------------------
  // Position: White King on g6, White Queen on e7, Black King on h8
  // White plays Qe7 -> Qf7 (r:1, f:4 -> tr:1, tf:5), leaving Black with 0 legal moves and not in check.
  const preStalematePos = ChessEngine.newPos('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1');
  const match5 = server.createMatch(playerW, playerB, preStalematePos);

  const staleMove = { r: 1, f: 4, tr: 1, tf: 5 };
  const staleRes = server.processMove(playerW, match5.id, 0, staleMove);
  assert.strictEqual(staleRes.statusCode, 200);
  assert.strictEqual(staleRes.status, 'completed');
  assert.strictEqual(staleRes.result, 'Draw by stalemate');
  assert.strictEqual(staleRes.winnerId, null);
  assert.strictEqual(match5.status, 'completed');
  assert.strictEqual(match5.winner_id, null);
  console.log('  PASS: Stalemate move automatically finalizes match as Draw with winner_id: null.');

  // --------------------------------------------------------------------------
  // Test 8: Multiplayer module action client methods
  // --------------------------------------------------------------------------
  assert.strictEqual(typeof Multiplayer.resignMatch, 'function', 'resignMatch exists');
  assert.strictEqual(typeof Multiplayer.offerDraw, 'function', 'offerDraw exists');
  assert.strictEqual(typeof Multiplayer.acceptDraw, 'function', 'acceptDraw exists');
  console.log('  PASS: Multiplayer module exports resignMatch, offerDraw, acceptDraw.');

  console.log('--- All Game Endings & Player Actions Tests Passed! ---\n');
}

if (require.main === module) {
  runGameEndingsTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runGameEndingsTests };
