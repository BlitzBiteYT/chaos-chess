const { verifyAuth, getAdminClient } = require('./utils/supabase');
const { checkRateLimit, isValidUUID, validateMovePayload } = require('./utils/validation');
const ChessEngine = require('../../src/engine/chess');
const ChaosEngine = require('../../src/engine/chaos');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 1. Authenticate player
  const auth = await verifyAuth(event);
  if (auth.error) {
    return {
      statusCode: auth.status,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: auth.error })
    };
  }

  const { user } = auth;

  // Rate limit check
  if (!checkRateLimit(user.id)) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Too many requests. Please slow down.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Malformed JSON payload' })
    };
  }

  const { matchId, stateVersion, move } = body;
  if (!matchId || stateVersion === undefined || !move) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required parameters: matchId, stateVersion, move' })
    };
  }

  if (!isValidUUID(matchId)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid matchId format' })
    };
  }

  let admin;
  try {
    admin = getAdminClient();
  } catch (err) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Database service not configured: ' + err.message })
    };
  }

  try {
    // 2. Fetch authoritative match record
    const { data: match, error: matchErr } = await admin
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();

    if (matchErr) throw matchErr;
    if (!match) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'Match not found' })
      };
    }

    const moveVal = validateMovePayload(move, match.board_ranks || 8);
    if (!moveVal.valid) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: moveVal.error })
      };
    }

    if (match.status !== 'active') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'Match is already concluded' })
      };
    }

    // 3. Verify requester is a participant
    const isWhite = match.white_player_id === user.id;
    const isBlack = match.black_player_id === user.id;
    if (!isWhite && !isBlack) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'You are not a participant in this match' })
      };
    }

    const playerColor = isWhite ? 'w' : 'b';

    // 4. State version and idempotency check (evaluated before turn and status check to support network retries)
    if (stateVersion < match.state_version) {
      // Check if this exact move was already submitted by this player (retry / idempotency)
      const { data: existingMove } = await admin
        .from('match_moves')
        .select('*')
        .eq('match_id', matchId)
        .eq('move_number', stateVersion + 1)
        .eq('player_id', user.id)
        .maybeSingle();

      if (existingMove &&
          existingMove.move_data.r === move.r &&
          existingMove.move_data.f === move.f &&
          existingMove.move_data.tr === move.tr &&
          existingMove.move_data.tf === move.tf) {
        // Idempotent retry: return previously accepted move
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            idempotent: true,
            status: match.status,
            result: match.result,
            winnerId: match.winner_id,
            stateVersion: match.state_version,
            currentTurn: match.current_turn,
            boardRanks: match.board_ranks,
            move: existingMove.move_data,
            san: existingMove.san,
            chaosEvent: existingMove.chaos_event || null,
            gameState: match.game_state
          })
        };
      }

      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Stale state version. Please reload latest match state.',
          serverVersion: match.state_version
        })
      };
    }

    if (stateVersion > match.state_version) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Submitted state version is ahead of server.'
        })
      };
    }

    // Check if match is already concluded
    if (match.status !== 'active') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Match has already concluded',
          result: match.result,
          status: match.status
        })
      };
    }

    // 5. Verify player turn for new move submission
    if (match.current_turn !== playerColor) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `It is not your turn. Current turn: ${match.current_turn}`
        })
      };
    }

    // 6. Validate move against authoritative chess rules
    const currentPos = match.game_state.pos;
    const legalMoves = ChessEngine.legal(currentPos);
    const validMove = legalMoves.find(m =>
      m.r === move.r &&
      m.f === move.f &&
      m.tr === move.tr &&
      m.tf === move.tf &&
      (!move.promo || m.promo === move.promo)
    );

    if (!validMove) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'Illegal chess move' })
      };
    }

    // 7. Execute move authoritatively
    validMove.tele = ChessEngine.teleDest(currentPos, validMove);
    validMove.wh = currentPos.turn === 'w';

    const sanStr = ChessEngine.san(currentPos, validMove, legalMoves);
    const nextPos = ChessEngine.make(currentPos, validMove);
    const inChk = ChessEngine.inCheck(nextPos);
    const isMate = inChk && !ChessEngine.legal(nextPos).length;
    const finalSan = sanStr + (isMate ? '#' : inChk ? '+' : '');

    const nextStateVersion = match.state_version + 1;
    const cap = validMove.ep ? currentPos.b[validMove.r][validMove.tf] : currentPos.b[validMove.tr][validMove.tf];

    // Build initial repetition key for position
    const currentSeen = match.game_state.seen || {};
    const posKey = ChessEngine.posKey(nextPos);
    const nextSeen = { ...currentSeen, [posKey]: (currentSeen[posKey] || 0) + 1 };

    // 8. Authoritative Chaos Tick Evaluation
    const chaosConfig = match.chaos_settings || { on: true, every: 5, burst: 1 };
    const chaosOn = chaosConfig.on !== false;
    const currentChaos = match.game_state.chaos || {
      seed: match.seed,
      meter: (chaosConfig.every || 5) + 4,
      max: (chaosConfig.every || 5) + 4,
      n: 0,
      next: null,
      last: null
    };

    const authoritativeG = {
      pos: nextPos,
      chaos: { ...currentChaos },
      seen: nextSeen,
      hist: [...(match.game_state.hist || []), validMove]
    };

    // If game ended in checkmate, no chaos fires
    const chaosResult = isMate ? null : ChaosEngine.chaosTick(authoritativeG, chaosOn);

    const finalPos = authoritativeG.pos;
    const finalRanks = finalPos.b.length;
    const nextTurn = finalPos.turn;

    // Evaluate game over conditions on the final authoritative state
    const gameStatus = ChessEngine.status(authoritativeG);
    let matchStatus = 'active';
    let matchResult = null;
    let winnerId = null;

    if (gameStatus.over) {
      matchStatus = 'completed';
      matchResult = gameStatus.text;
      if (gameStatus.text.includes('wins by checkmate')) {
        winnerId = user.id; // The player who just moved gave checkmate
      } else {
        winnerId = null; // Stalemate, insufficient material, repetition, 50-move draw
      }
    }

    const updatedGameState = {
      ...match.game_state,
      pos: finalPos,
      hist: authoritativeG.hist,
      sans: [...(match.game_state.sans || []), finalSan],
      scol: [...(match.game_state.scol || []), playerColor],
      caps: cap ? [...(match.game_state.caps || []), cap] : (match.game_state.caps || []),
      seen: authoritativeG.seen,
      chaos: authoritativeG.chaos,
      draw_offer_by: null // Move implicitly resets pending draw offers
    };

    // 9. Record move in match_moves (enforces unique(match_id, move_number))
    const { error: moveInsertErr } = await admin
      .from('match_moves')
      .insert({
        match_id: matchId,
        move_number: nextStateVersion,
        player_id: user.id,
        color: playerColor,
        san: finalSan,
        move_data: validMove,
        chaos_event: chaosResult || null
      });

    if (moveInsertErr) throw moveInsertErr;

    // 10. Update matches record atomically with optimistic locking
    const { data: updatedMatch, error: matchUpdateErr } = await admin
      .from('matches')
      .update({
        state_version: nextStateVersion,
        current_turn: nextTurn,
        board_ranks: finalRanks,
        game_state: updatedGameState,
        status: matchStatus,
        result: matchResult,
        winner_id: winnerId,
        updated_at: new Date().toISOString()
      })
      .eq('id', matchId)
      .eq('state_version', match.state_version) // Optimistic lock!
      .select()
      .single();

    if (matchUpdateErr) throw matchUpdateErr;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        status: matchStatus,
        result: matchResult,
        winnerId: winnerId,
        stateVersion: nextStateVersion,
        currentTurn: nextTurn,
        boardRanks: finalRanks,
        move: validMove,
        san: finalSan,
        chaosEvent: chaosResult,
        gameState: updatedGameState
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Move execution failed' })
    };
  }
};
