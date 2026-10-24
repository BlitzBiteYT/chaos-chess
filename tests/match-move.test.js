const assert = require('assert');
const ChessEngine = require('../src/engine/chess');

/**
 * Authoritative Server-Side Move Validation & Security Tests
 */
function runMatchMoveTests() {
  console.log('--- Running Authoritative Move Validation & Security Tests ---');

  const { newPos, FULL, legal, make, san, inCheck, posKey } = ChessEngine;

  // In-Memory Database and Server-Side Validation Simulation
  class ServerMatchEngine {
    constructor() {
      this.matches = new Map();
      this.matchMoves = []; // array of { match_id, move_number, player_id, color, san, move_data }
    }

    createMatch(whiteId, blackId) {
      const matchId = 'match_' + Math.random().toString(36).substring(2, 9);
      const startPos = newPos(FULL);
      const startKey = posKey(startPos);
      const match = {
        id: matchId,
        white_player_id: whiteId,
        black_player_id: blackId,
        status: 'active',
        current_turn: 'w',
        state_version: 0,
        game_state: {
          pos: startPos,
          hist: [],
          sans: [],
          scol: [],
          caps: [],
          seen: { [startKey]: 1 }
        }
      };
      this.matches.set(matchId, match);
      return match;
    }

    processMove(userId, matchId, stateVersion, move) {
      const match = this.matches.get(matchId);
      if (!match) return { statusCode: 404, error: 'Match not found' };
      if (match.status !== 'active') return { statusCode: 400, error: 'Match is already concluded' };

      // Participant check
      const isWhite = match.white_player_id === userId;
      const isBlack = match.black_player_id === userId;
      if (!isWhite && !isBlack) {
        return { statusCode: 403, error: 'You are not a participant in this match' };
      }

      const playerColor = isWhite ? 'w' : 'b';

      // Idempotency and stale version check (evaluated before turn check for network retries)
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
          return {
            statusCode: 200,
            idempotent: true,
            stateVersion: match.state_version,
            currentTurn: match.current_turn,
            move: existing.move_data,
            san: existing.san,
            gameState: match.game_state
          };
        }

        return { statusCode: 409, error: 'Stale state version' };
      }

      if (stateVersion > match.state_version) {
        return { statusCode: 400, error: 'State version ahead of server' };
      }

      // Turn check for new move
      if (match.current_turn !== playerColor) {
        return { statusCode: 400, error: `It is not your turn. Current turn: ${match.current_turn}` };
      }

      // Authoritative Rules Validation
      const currentPos = match.game_state.pos;
      const legalMoves = legal(currentPos);
      const validMove = legalMoves.find(m =>
        m.r === move.r &&
        m.f === move.f &&
        m.tr === move.tr &&
        m.tf === move.tf &&
        (!move.promo || m.promo === move.promo)
      );

      if (!validMove) {
        return { statusCode: 400, error: 'Illegal chess move' };
      }

      // Execute move
      const sanStr = san(currentPos, validMove, legalMoves);
      const nextPos = make(currentPos, validMove);
      const inChk = inCheck(nextPos);
      const isMate = inChk && !legal(nextPos).length;
      const finalSan = sanStr + (isMate ? '#' : inChk ? '+' : '');

      const nextVersion = match.state_version + 1;
      const nextTurn = nextPos.turn;

      const pKey = posKey(nextPos);
      const updatedSeen = { ...match.game_state.seen, [pKey]: (match.game_state.seen[pKey] || 0) + 1 };

      const updatedGameState = {
        ...match.game_state,
        pos: nextPos,
        hist: [...match.game_state.hist, validMove],
        sans: [...match.game_state.sans, finalSan],
        scol: [...match.game_state.scol, playerColor],
        seen: updatedSeen
      };

      // Atomic record insertion
      this.matchMoves.push({
        match_id: matchId,
        move_number: nextVersion,
        player_id: userId,
        color: playerColor,
        san: finalSan,
        move_data: validMove
      });

      // Update match state
      match.state_version = nextVersion;
      match.current_turn = nextTurn;
      match.game_state = updatedGameState;

      return {
        statusCode: 200,
        success: true,
        stateVersion: nextVersion,
        currentTurn: nextTurn,
        san: finalSan,
        gameState: updatedGameState
      };
    }
  }

  const server = new ServerMatchEngine();
  const match = server.createMatch('user_alice', 'user_bob');

  // Test 1: Legal Move (White plays 1. e4: r:6, f:4 -> tr:4, tf:4)
  const e4Move = { r: 6, f: 4, tr: 4, tf: 4, dbl: 1 };
  const res1 = server.processMove('user_alice', match.id, 0, e4Move);
  assert.strictEqual(res1.statusCode, 200, 'Legal move must be accepted');
  assert.strictEqual(res1.stateVersion, 1, 'State version must increment to 1');
  assert.strictEqual(res1.currentTurn, 'b', 'Turn must switch to Black');
  assert.strictEqual(res1.san, 'e4', 'SAN notation must be e4');
  console.log('  PASS: Legal move 1. e4 accepted with state version increment.');

  // Test 2: Out-of-turn rejection (Alice tries to move again on Black\'s turn)
  const outOfTurnMove = { r: 7, f: 6, tr: 5, tf: 5 }; // Ng1-f3
  const res2 = server.processMove('user_alice', match.id, 1, outOfTurnMove);
  assert.strictEqual(res2.statusCode, 400);
  assert(res2.error.includes('not your turn'), 'Must reject out-of-turn move');
  console.log('  PASS: Out-of-turn move rejected with 400.');

  // Test 3: Unauthorized user rejection (Charlie tries to move)
  const res3 = server.processMove('user_charlie', match.id, 1, { r: 1, f: 4, tr: 3, tf: 4 });
  assert.strictEqual(res3.statusCode, 403);
  assert(res3.error.includes('not a participant'), 'Must reject non-participant');
  console.log('  PASS: Unauthorized user rejected with 403 Forbidden.');

  // Test 4: Illegal chess move rejection (Bob tries to move a pawn backwards or illegally)
  const illegalMove = { r: 1, f: 4, tr: 0, tf: 4 }; // e7-e8 backwards into White pieces
  const res4 = server.processMove('user_bob', match.id, 1, illegalMove);
  assert.strictEqual(res4.statusCode, 400);
  assert.strictEqual(res4.error, 'Illegal chess move');
  console.log('  PASS: Illegal move rejected by authoritative rules engine.');

  // Test 5: Legal move by Bob (1... e5: r:1, f:4 -> tr:3, tf:4)
  const e5Move = { r: 1, f: 4, tr: 3, tf: 4, dbl: 1 };
  const res5 = server.processMove('user_bob', match.id, 1, e5Move);
  assert.strictEqual(res5.statusCode, 200);
  assert.strictEqual(res5.stateVersion, 2);
  assert.strictEqual(res5.currentTurn, 'w');
  assert.strictEqual(res5.san, 'e5');
  console.log('  PASS: Legal move 1... e5 accepted with state version 2.');

  // Test 6: Idempotency protection (Bob resends 1... e5 at version 1 due to timeout retry)
  const resRetry = server.processMove('user_bob', match.id, 1, e5Move);
  assert.strictEqual(resRetry.statusCode, 200);
  assert.strictEqual(resRetry.idempotent, true);
  assert.strictEqual(resRetry.stateVersion, 2, 'Version must not increment on idempotent retry');
  assert.strictEqual(server.matchMoves.length, 2, 'No duplicate move record created in DB');
  console.log('  PASS: Idempotent move retry safely resolved without state corruption.');

  // Test 7: Stale version rejection (Attempting different move with old version 1)
  const resStale = server.processMove('user_bob', match.id, 1, { r: 1, f: 2, tr: 2, tf: 2 });
  assert.strictEqual(resStale.statusCode, 409);
  assert.strictEqual(resStale.error, 'Stale state version');
  console.log('  PASS: Stale state version rejected with 409 Conflict.');

  console.log('Authoritative Move Validation Tests Passed!\n');
}

module.exports = { runMatchMoveTests };

if (require.main === module) {
  runMatchMoveTests();
}
