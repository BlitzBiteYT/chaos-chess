const { verifyAuth, getAdminClient } = require('./utils/supabase');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  const matchId = (event.queryStringParameters && event.queryStringParameters.matchId) ||
    (event.body ? JSON.parse(event.body || '{}').matchId : null);

  if (!matchId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required parameter: matchId' })
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

    // 3. Verify user is a participant
    const isWhite = match.white_player_id === user.id;
    const isBlack = match.black_player_id === user.id;

    if (!isWhite && !isBlack) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'You are not a participant in this match.' })
      };
    }

    const myColor = isWhite ? 'w' : 'b';

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        match: {
          id: match.id,
          myColor,
          myPlayerId: user.id,
          whitePlayerId: match.white_player_id,
          blackPlayerId: match.black_player_id,
          status: match.status,
          currentTurn: match.current_turn,
          stateVersion: match.state_version,
          seed: match.seed,
          chaosSettings: match.chaos_settings,
          boardRanks: match.board_ranks,
          gameState: match.game_state,
          result: match.result,
          winnerId: match.winner_id,
          createdAt: match.created_at,
          updatedAt: match.updated_at
        }
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Failed to retrieve match state' })
    };
  }
};
