const { verifyAuth, getAdminClient } = require('./utils/supabase');
const { checkRateLimit, isValidUUID } = require('./utils/validation');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ABANDON_TIMEOUT_MS = 60 * 1000; // 60 seconds abandonment threshold

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

  const { matchId, claimAbandonment } = body;
  if (!matchId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required matchId' })
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
    const nowIso = new Date().toISOString();

    // 2. Update caller's last_seen_at in player_sessions
    await admin
      .from('player_sessions')
      .upsert({
        player_id: user.id,
        last_seen_at: nowIso
      }, { onConflict: 'player_id' });

    // 3. Fetch authoritative match
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

    const isWhite = match.white_player_id === user.id;
    const isBlack = match.black_player_id === user.id;
    if (!isWhite && !isBlack) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'Not a participant in this match' })
      };
    }

    const opponentId = isWhite ? match.black_player_id : match.white_player_id;

    // 4. Fetch opponent's last seen timestamp
    const { data: opponentSession } = await admin
      .from('player_sessions')
      .select('last_seen_at')
      .eq('player_id', opponentId)
      .maybeSingle();

    const opponentLastSeen = opponentSession ? new Date(opponentSession.last_seen_at).getTime() : 0;
    const timeSinceOpponentSeen = Date.now() - opponentLastSeen;
    const opponentConnected = opponentLastSeen > 0 && timeSinceOpponentSeen < 25000; // Within 25s
    const opponentAbandoned = opponentLastSeen > 0 && timeSinceOpponentSeen >= ABANDON_TIMEOUT_MS;

    // 5. Handle abandonment claim if match is active and opponent exceeded timeout
    if (claimAbandonment && match.status === 'active') {
      if (opponentAbandoned) {
        const winningColor = isWhite ? 'White' : 'Black';
        const resultString = `Opponent disconnected. ${winningColor} wins by abandonment`;

        const { data: updatedMatch, error: updateErr } = await admin
          .from('matches')
          .update({
            status: 'abandoned',
            result: resultString,
            winner_id: user.id,
            updated_at: nowIso
          })
          .eq('id', matchId)
          .eq('status', 'active')
          .select()
          .single();

        if (updateErr) throw updateErr;

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            status: 'abandoned',
            result: resultString,
            winnerId: user.id,
            opponentConnected: false,
            opponentAbandoned: true
          })
        };
      } else {
        const remainingSeconds = Math.max(0, Math.ceil((ABANDON_TIMEOUT_MS - timeSinceOpponentSeen) / 1000));
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: false,
            error: `Opponent has not yet reached abandonment timeout. Remaining: ${remainingSeconds}s`,
            remainingSeconds
          })
        };
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        matchStatus: match.status,
        result: match.result,
        winnerId: match.winner_id,
        opponentConnected,
        opponentAbandoned,
        secondsSinceOpponentSeen: Math.floor(timeSinceOpponentSeen / 1000)
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Heartbeat processing failed' })
    };
  }
};
