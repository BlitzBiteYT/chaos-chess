/**
 * Chaos Chess - Global Matchmaking Client Module
 * Manages entering, leaving, and subscribing to the global queue without Elo ratings.
 */
(function(root, factory) {
  let authLib = null;
  if (typeof require === 'function') {
    try { authLib = require('./auth'); } catch (e) {}
  }
  if (!authLib && root && root.ChaosChessAuth) {
    authLib = root.ChaosChessAuth;
  }

  const lib = factory(authLib);

  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = lib;
  }
  if (root) {
    root.ChaosChessMatchmaking = lib;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function(AuthLib) {
  let currentState = 'idle'; // idle | connecting | searching | matched | cancelled | error
  let currentMatchId = null;
  let listeners = [];
  let pollTimer = null;
  let realtimeChannel = null;

  function emit(data) {
    currentState = data.status || currentState;
    if (data.matchId) currentMatchId = data.matchId;
    listeners.forEach(cb => {
      try { cb({ status: currentState, matchId: currentMatchId, ...data }); } catch (e) { console.error('Matchmaking listener error', e); }
    });
  }

  function getStatus() {
    return {
      status: currentState,
      matchId: currentMatchId
    };
  }

  async function callQueueEndpoint(payload) {
    const token = AuthLib ? AuthLib.getAccessToken() : null;
    if (!token) {
      throw new Error('Not authenticated. Please initialize player session first.');
    }

    const endpoint = (typeof window !== 'undefined' && window.__QUEUE_ENDPOINT__) || '/.netlify/functions/queue';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    return data;
  }

  function startRealtimeSubscription(player, sbClient) {
    if (!sbClient || !player || !player.id) return;
    try {
      if (realtimeChannel) {
        sbClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }

      realtimeChannel = sbClient.channel(`queue:${player.id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchmaking_queue',
          filter: `player_id=eq.${player.id}`
        }, payload => {
          const row = payload.new;
          if (row && row.status === 'matched' && row.match_id) {
            stopPolling();
            emit({ status: 'matched', matchId: row.match_id });
          } else if (row && row.status === 'cancelled') {
            stopPolling();
            emit({ status: 'cancelled' });
          }
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription error in queue:', e);
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await callQueueEndpoint({ action: 'status' });
        if (res.status === 'matched' && res.matchId) {
          stopPolling();
          emit({ status: 'matched', matchId: res.matchId });
        } else if (res.status === 'cancelled') {
          stopPolling();
          emit({ status: 'cancelled' });
        }
      } catch (err) {
        console.warn('Polling check notice:', err.message);
      }
    }, 2500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function joinQueue() {
    emit({ status: 'connecting' });
    try {
      // 1. Ensure authenticated
      const authResult = await AuthLib.initAuth();
      if (!authResult.success) {
        throw new Error(authResult.error || 'Authentication failed');
      }

      const player = AuthLib.getPlayer();
      const sbClient = AuthLib.getSupabaseClient();

      emit({ status: 'searching' });

      // 2. Subscribe to realtime push
      startRealtimeSubscription(player, sbClient);

      // 3. Send join request to Netlify Function
      const res = await callQueueEndpoint({ action: 'join' });

      if (res.status === 'matched' && res.matchId) {
        stopPolling();
        emit({ status: 'matched', matchId: res.matchId });
        return { status: 'matched', matchId: res.matchId };
      }

      // 4. Start fallback polling while searching
      startPolling();
      return { status: 'searching' };
    } catch (err) {
      stopPolling();
      emit({ status: 'error', error: err.message });
      return { status: 'error', error: err.message };
    }
  }

  async function leaveQueue() {
    stopPolling();
    const sbClient = AuthLib ? AuthLib.getSupabaseClient() : null;
    if (sbClient && realtimeChannel) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    try {
      const res = await callQueueEndpoint({ action: 'leave' });
      emit({ status: 'cancelled' });
      return res;
    } catch (err) {
      emit({ status: 'cancelled' });
      return { success: true, status: 'cancelled' };
    }
  }

  function onMatchmakingStateChange(callback) {
    if (typeof callback === 'function') {
      listeners.push(callback);
    }
    return () => {
      listeners = listeners.filter(cb => cb !== callback);
    };
  }

  return {
    joinQueue,
    leaveQueue,
    getStatus,
    onMatchmakingStateChange
  };
}));
