/**
 * Chaos Chess - Online Multiplayer Configuration Layer
 * Manages Supabase URL and anonymous public API key.
 * Never hardcode secret service-role keys here.
 */
(function(root, factory) {
  const lib = factory();
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = lib;
  }
  if (root) {
    root.ChaosChessConfig = lib;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function() {
  const STORAGE_KEY = 'chaosChessOnlineConfig';

  function getStoredConfig() {
    if (typeof localStorage !== 'undefined') {
      try {
        const item = localStorage.getItem(STORAGE_KEY);
        if (item) return JSON.parse(item);
      } catch (e) {
        console.warn('Unable to read config from localStorage', e);
      }
    }
    return {};
  }

  function getConfig() {
    const stored = getStoredConfig();
    const globalConfig = (typeof window !== 'undefined' && window.__CHAOS_CHESS_CONFIG__) || {};
    const envConfig = (typeof process !== 'undefined' && process.env) || {};

    const supabaseUrl = globalConfig.supabaseUrl ||
      envConfig.SUPABASE_URL ||
      stored.supabaseUrl ||
      '';

    const supabaseAnonKey = globalConfig.supabaseAnonKey ||
      envConfig.SUPABASE_ANON_KEY ||
      stored.supabaseAnonKey ||
      '';

    return {
      supabaseUrl,
      supabaseAnonKey,
      isConfigured: Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-project-id'))
    };
  }

  function setConfig(newConfig) {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      } catch (e) {
        console.warn('Unable to save config to localStorage', e);
      }
    }
    return getConfig();
  }

  return {
    getConfig,
    setConfig,
    STORAGE_KEY
  };
}));
