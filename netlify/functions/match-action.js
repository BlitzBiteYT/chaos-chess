const { verifyAuth, getAdminClient } = require('./utils/supabase');
const { checkRateLimit, isValidUUID, validateActionPayload } = require('./utils/validation');

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

  // 1. Authenticate user
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

  const { matchId, action } = body;
  if (!matchId || !action) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required parameters: matchId, action' })
    };
  }

  if (!isValidUUID(matchId)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid matchId format' })
    };
  }

  const actionVal = validateActionPayload(action);
  if (!actionVal.valid) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: actionVal.error })
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
    // 2. Fetch match record
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

    // 3. Verify user is a participant
    const isWhite = match.white_player_id === user.id;
    const isBlack = match.black_player_id === user.id;
    if (!isWhite && !isBlack) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'You are not a participant in this match' })
      };
    }

    // Check if match already finished (immutability)
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

    // --------------------------------------------------------------------------
    // ACTION: RESIGN
    // --------------------------------------------------------------------------
    if (action === 'resign') {
      const resigningColor = isWhite ? 'White' : 'Black';
      const winningColor = isWhite ? 'Black' : 'White';
      const winnerId = isWhite ? match.black_player_id : match.white_player_id;
      const resultString = `${resigningColor} resigns. ${winningColor} wins`;

      const { data: updatedMatch, error: updateErr } = await admin
        .from('matches')
        .update({
          status: 'completed',
          result: resultString,
          winner_id: winnerId,
          updated_at: new Date().toISOString()
        })
        .eq('id', matchId)
        .eq('status', 'active') // Concurrency lock
        .select()
        .single();

      if (updateErr) throw updateErr;

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          status: 'completed',
          result: resultString,
          winnerId
        })
      };
    }

    // --------------------------------------------------------------------------
    // ACTION: OFFER DRAW
    // --------------------------------------------------------------------------
    if (action === 'offer_draw') {
      const existingOffer = match.game_state.draw_offer_by;
      const opponentId = isWhite ? match.black_player_id : match.white_player_id;

      // If opponent already offered, mutual agreement is reached!
      if (existingOffer && existingOffer === opponentId) {
        const resultString = 'Draw agreed by both players';
        const { error: drawErr } = await admin
          .from('matches')
          .update({
            status: 'completed',
            result: resultString,
            winner_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', matchId)
          .eq('status', 'active');

        if (drawErr) throw drawErr;

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            status: 'completed',
            result: resultString
          })
        };
      }

      // Record pending draw offer
      const updatedGameState = {
        ...match.game_state,
        draw_offer_by: user.id
      };

      await admin
        .from('matches')
        .update({
          game_state: updatedGameState,
          updated_at: new Date().toISOString()
        })
        .eq('id', matchId);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          status: 'active',
          drawOffered: true
        })
      };
    }

    // --------------------------------------------------------------------------
    // ACTION: ACCEPT DRAW
    // --------------------------------------------------------------------------
    if (action === 'accept_draw') {
      const opponentId = isWhite ? match.black_player_id : match.white_player_id;
      if (match.game_state.draw_offer_by !== opponentId) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'No draw offer pending from opponent' })
        };
      }

      const resultString = 'Draw agreed by both players';
      const { error: drawErr } = await admin
        .from('matches')
        .update({
          status: 'completed',
          result: resultString,
          winner_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', matchId)
        .eq('status', 'active');

      if (drawErr) throw drawErr;

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          status: 'completed',
          result: resultString
        })
      };
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Unknown action: ' + action })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Match action failed' })
    };
  }
};
