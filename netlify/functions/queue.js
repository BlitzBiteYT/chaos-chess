const { verifyAuth, getAdminClient } = require('./utils/supabase');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 1. Authenticate requester
  const auth = await verifyAuth(event);
  if (auth.error) {
    return {
      statusCode: auth.status,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: auth.error })
    };
  }

  const { user } = auth;
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

  const method = event.httpMethod;
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      body = {};
    }
  }

  const action = body.action || (method === 'DELETE' ? 'leave' : method === 'GET' ? 'status' : 'join');

  try {
    // --------------------------------------------------------------------------
    // ACTION: JOIN QUEUE
    // --------------------------------------------------------------------------
    if (action === 'join') {
      // Check existing queue entry
      const { data: existing, error: findErr } = await admin
        .from('matchmaking_queue')
        .select('*')
        .eq('player_id', user.id)
        .maybeSingle();

      if (findErr) throw findErr;

      // If already matched in an active match, return it
      if (existing && existing.status === 'matched' && existing.match_id) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            status: 'matched',
            matchId: existing.match_id
          })
        };
      }

      // Upsert queue entry with status = 'waiting' (ignoring Elo completely)
      const { data: queueEntry, error: upsertErr } = await admin
        .from('matchmaking_queue')
        .upsert({
          player_id: user.id,
          status: 'waiting',
          match_id: null,
          queued_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'player_id' })
        .select()
        .single();

      if (upsertErr) throw upsertErr;

      // Trigger atomic FIFO matchmaking RPC
      try {
        await admin.rpc('process_matchmaking_queue');
      } catch (rpcErr) {
        console.warn('RPC process_matchmaking_queue note:', rpcErr.message);
      }

      // Re-fetch our entry to check if an opponent was immediately paired
      const { data: refreshed } = await admin
        .from('matchmaking_queue')
        .select('*')
        .eq('player_id', user.id)
        .single();

      const isMatched = refreshed && refreshed.status === 'matched' && refreshed.match_id;

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          status: isMatched ? 'matched' : 'waiting',
          matchId: isMatched ? refreshed.match_id : null,
          queuedAt: refreshed.queued_at
        })
      };
    }

    // --------------------------------------------------------------------------
    // ACTION: LEAVE QUEUE
    // --------------------------------------------------------------------------
    if (action === 'leave') {
      const { data: updated, error: leaveErr } = await admin
        .from('matchmaking_queue')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('player_id', user.id)
        .eq('status', 'waiting')
        .select();

      if (leaveErr) throw leaveErr;

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          status: 'cancelled',
          cancelled: Boolean(updated && updated.length > 0)
        })
      };
    }

    // --------------------------------------------------------------------------
    // ACTION: STATUS / POLL
    // --------------------------------------------------------------------------
    if (action === 'status') {
      // Run atomic matchmaking check in case someone joined
      try {
        await admin.rpc('process_matchmaking_queue');
      } catch (e) {}

      const { data: entry, error: statusErr } = await admin
        .from('matchmaking_queue')
        .select('*')
        .eq('player_id', user.id)
        .maybeSingle();

      if (statusErr) throw statusErr;

      if (!entry) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, status: 'idle' })
        };
      }

      if (entry.status === 'matched' && entry.match_id) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: true,
            status: 'matched',
            matchId: entry.match_id
          })
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          status: entry.status, // 'waiting' or 'cancelled'
          queuedAt: entry.queued_at
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
      body: JSON.stringify({ success: false, error: err.message || 'Matchmaking operation failed' })
    };
  }
};
