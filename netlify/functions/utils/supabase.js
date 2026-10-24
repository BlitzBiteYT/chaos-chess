const { createClient } = require('@supabase/supabase-js');

function getEnvConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';

  return {
    supabaseUrl,
    serviceRoleKey,
    anonKey,
    isConfigured: Boolean(supabaseUrl && (serviceRoleKey || anonKey))
  };
}

let adminClientInstance = null;

function getAdminClient() {
  const { supabaseUrl, serviceRoleKey } = getEnvConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin credentials missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured.');
  }

  if (!adminClientInstance) {
    adminClientInstance = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return adminClientInstance;
}

function getUserClient(token) {
  const { supabaseUrl, anonKey } = getEnvConfig();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase credentials missing: SUPABASE_URL or SUPABASE_ANON_KEY not configured.');
  }

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

async function verifyAuth(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: 'Missing or malformed Authorization header. Expected Bearer <token>',
      status: 401
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return {
      error: 'Empty bearer token provided',
      status: 401
    };
  }

  try {
    const { supabaseUrl, anonKey } = getEnvConfig();
    if (!supabaseUrl || !anonKey) {
      return {
        error: 'Backend is not configured with Supabase credentials',
        status: 503
      };
    }

    const client = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) {
      return {
        error: 'Invalid or expired user session',
        status: 401
      };
    }

    return {
      user,
      token,
      status: 200
    };
  } catch (err) {
    return {
      error: err.message || 'Authentication verification failed',
      status: 500
    };
  }
}

module.exports = {
  getEnvConfig,
  getAdminClient,
  getUserClient,
  verifyAuth
};
