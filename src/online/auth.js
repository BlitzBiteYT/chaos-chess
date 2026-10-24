/**
 * Chaos Chess - Supabase Anonymous Authentication Module
 * Provides seamless guest login without traditional sign-up.
 */
(function(root, factory) {
  let supabaseLib = null;
  let configLib = null;

  if (typeof require === 'function') {
    try { supabaseLib = require('@supabase/supabase-js'); } catch (e) {}
    try { configLib = require('./config'); } catch (e) {}
  }

  if (!supabaseLib && root && root.supabase) {
    supabaseLib = root.supabase;
  }
  if (!configLib && root && root.ChaosChessConfig) {
    configLib = root.ChaosChessConfig;
  }

  const lib = factory(supabaseLib, configLib);

  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = lib;
  }
  if (root) {
    root.ChaosChessAuth = lib;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function(SupabaseLib, ConfigLib) {
  let client = null;
  let currentUser = null;
  let currentSession = null;
  let authListeners = [];

  function getSupabaseClient() {
    if (client) return client;

    const config = ConfigLib ? ConfigLib.getConfig() : {};
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return null;
    }

    const createClientFn = (SupabaseLib && SupabaseLib.createClient) || (typeof window !== 'undefined' && window.supabase && window.supabase.createClient);
    if (!createClientFn) {
      console.warn('Supabase JS library not loaded.');
      return null;
    }

    client = createClientFn(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    client.auth.onAuthStateChange((event, session) => {
      currentSession = session;
      currentUser = session ? session.user : null;
      authListeners.forEach(cb => {
        try { cb(event, session); } catch (e) { console.error('Auth listener error', e); }
      });
    });

    return client;
  }

  async function initAuth() {
    const sb = getSupabaseClient();
    if (!sb) {
      return {
        success: false,
        error: 'Supabase credentials not configured'
      };
    }

    try {
      // 1. Check for existing session
      const { data: { session }, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;

      if (session) {
        currentSession = session;
        currentUser = session.user;
        return {
          success: true,
          player: {
            id: currentUser.id,
            isAnonymous: currentUser.is_anonymous || false,
            displayName: currentUser.user_metadata?.display_name || 'Player ' + currentUser.id.slice(0, 6)
          },
          session
        };
      }

      // 2. No session: sign in anonymously
      const { data: authData, error: signInError } = await sb.auth.signInAnonymously();
      if (signInError) throw signInError;

      currentSession = authData.session;
      currentUser = authData.user;

      return {
        success: true,
        player: {
          id: currentUser.id,
          isAnonymous: currentUser.is_anonymous || true,
          displayName: 'Player ' + currentUser.id.slice(0, 6)
        },
        session: currentSession
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Anonymous authentication failed'
      };
    }
  }

  function getPlayer() {
    if (!currentUser) return null;
    return {
      id: currentUser.id,
      isAnonymous: currentUser.is_anonymous || false,
      displayName: currentUser.user_metadata?.display_name || 'Player ' + currentUser.id.slice(0, 6)
    };
  }

  function getAccessToken() {
    return currentSession ? currentSession.access_token : null;
  }

  async function signOut() {
    if (client) {
      await client.auth.signOut();
    }
    currentUser = null;
    currentSession = null;
  }

  function onAuthStateChange(callback) {
    if (typeof callback === 'function') {
      authListeners.push(callback);
    }
    return () => {
      authListeners = authListeners.filter(cb => cb !== callback);
    };
  }

  return {
    getSupabaseClient,
    initAuth,
    getPlayer,
    getAccessToken,
    signOut,
    onAuthStateChange
  };
}));
