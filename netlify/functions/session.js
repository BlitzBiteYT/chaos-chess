const { verifyAuth, getAdminClient } = require('./utils/supabase');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Verify player authentication token
  const auth = await verifyAuth(event);
  if (auth.error) {
    return {
      statusCode: auth.status,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: auth.error
      })
    };
  }

  const { user } = auth;

  try {
    const admin = getAdminClient();
    const displayName = (event.body ? JSON.parse(event.body || '{}').displayName : null) ||
      user.user_metadata?.display_name ||
      'Player ' + user.id.slice(0, 6);

    // Upsert player session
    const { data: session, error } = await admin
      .from('player_sessions')
      .upsert({
        id: user.id,
        display_name: displayName,
        last_seen_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.warn('Could not upsert player session in DB:', error.message);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        player: {
          id: user.id,
          isAnonymous: user.is_anonymous || false,
          displayName: session ? session.display_name : displayName
        }
      })
    };
  } catch (err) {
    // If admin client or DB is not configured, still return the verified user identity from auth
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        player: {
          id: user.id,
          isAnonymous: user.is_anonymous || false,
          displayName: 'Player ' + user.id.slice(0, 6)
        },
        notice: 'Database session sync skipped: ' + err.message
      })
    };
  }
};
