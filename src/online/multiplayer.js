/**
 * Chaos Chess - Multiplayer Match State Synchronizer
 * Handles match snapshot fetching, Realtime subscriptions, and page-reload state restoration.
 */
(function(root, factory) {
  let authLib = null;
  let chessLib = null;
  let chaosLib = null;

  if (typeof require === 'function') {
    try { authLib = require('./auth'); } catch (e) {}
    try { chessLib = require('../engine/chess'); } catch (e) {}
    try { chaosLib = require('../engine/chaos'); } catch (e) {}
  }
  if (!authLib && root && root.ChaosChessAuth) {
    authLib = root.ChaosChessAuth;
  }
  if (!chessLib && root && root.ChaosChessEngine) {
    chessLib = root.ChaosChessEngine;
  }
  if (!chaosLib && root && root.ChaosEngine) {
    chaosLib = root.ChaosEngine;
  }

  const lib = factory(authLib, chessLib, chaosLib);

  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = lib;
  }
  if (root) {
    root.ChaosChessMultiplayer = lib;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function(AuthLib, ChessEngine, ChaosEngine) {
  const ACTIVE_MATCH_KEY = 'chaosChessActiveMatchId';
  let activeMatch = null;
  let realtimeChannel = null;
  let matchListeners = [];
  let peerListeners = [];
  let heartbeatInterval = null;
  let isPeerConnected = true;

  function emit(data) {
    activeMatch = data;
    matchListeners.forEach(cb => {
      try { cb(activeMatch); } catch (e) { console.error('Match update listener error', e); }
    });
  }

  function emitPeerStatus(status) {
    isPeerConnected = status.connected;
    peerListeners.forEach(cb => {
      try { cb(status); } catch (e) { console.error('Peer listener error', e); }
    });
  }

  function getMatchData() {
    return activeMatch;
  }

  async function fetchMatchState(matchId) {
    const token = AuthLib ? AuthLib.getAccessToken() : null;
    if (!token) {
      throw new Error('Not authenticated. Please initialize player session first.');
    }

    const endpoint = (typeof window !== 'undefined' && window.__MATCH_STATE_ENDPOINT__) ||
      `/.netlify/functions/match-state?matchId=${encodeURIComponent(matchId)}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    return data.match;
  }

  async function sendHeartbeat(claimAbandonment = false) {
    if (!activeMatch || !activeMatch.id) return null;
    const token = AuthLib ? AuthLib.getAccessToken() : null;
    if (!token) return null;

    const endpoint = (typeof window !== 'undefined' && window.__HEARTBEAT_ENDPOINT__) ||
      '/.netlify/functions/heartbeat';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          matchId: activeMatch.id,
          claimAbandonment: !!claimAbandonment
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        emitPeerStatus({
          connected: data.opponentConnected,
          abandoned: data.opponentAbandoned,
          secondsSinceSeen: data.secondsSinceOpponentSeen
        });

        if (data.status === 'abandoned' || data.matchStatus === 'abandoned') {
          activeMatch = {
            ...activeMatch,
            status: 'abandoned',
            result: data.result || activeMatch.result,
            winnerId: data.winnerId || activeMatch.winnerId
          };
          emit(activeMatch);
        }
      }
      return data;
    } catch (e) {
      console.warn('Heartbeat failed:', e.message);
      return null;
    }
  }

  function startHeartbeat(matchId) {
    stopHeartbeat();
    sendHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (activeMatch && activeMatch.id === matchId && activeMatch.status === 'active') {
        sendHeartbeat();
      } else {
        stopHeartbeat();
      }
    }, 10000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function setupRealtimeSubscription(matchId, sbClient) {
    if (!sbClient) return;
    try {
      if (realtimeChannel) {
        sbClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }

      realtimeChannel = sbClient.channel(`match:${matchId}`, {
        config: { presence: { key: activeMatch ? activeMatch.myPlayerId : undefined } }
      })
        .on('presence', { event: 'sync' }, () => {
          const state = realtimeChannel.presenceState();
          const opponentId = activeMatch ? (activeMatch.myColor === 'w' ? activeMatch.blackPlayerId : activeMatch.whitePlayerId) : null;
          const isOpponentPresent = opponentId ? !!state[opponentId] : Object.keys(state).length > 1;
          emitPeerStatus({ connected: isOpponentPresent });
        })
        .on('presence', { event: 'leave' }, () => {
          emitPeerStatus({ connected: false });
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`
        }, payload => {
          const row = payload.new;
          if (row && activeMatch) {
            const updatedMatch = {
              ...activeMatch,
              status: row.status,
              currentTurn: row.current_turn,
              stateVersion: row.state_version,
              gameState: row.game_state,
              boardRanks: row.board_ranks,
              result: row.result,
              winnerId: row.winner_id,
              updatedAt: row.updated_at
            };
            emit(updatedMatch);
          }
        });

      realtimeChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await realtimeChannel.track({
              online_at: new Date().toISOString()
            });
          } catch (e) {}
        }
      });
    } catch (e) {
      console.warn('Realtime subscription error for match:', e);
    }
  }

  async function resyncMatch() {
    if (!activeMatch || !activeMatch.id) return null;
    try {
      const latestMatch = await fetchMatchState(activeMatch.id);
      emit(latestMatch);
      return latestMatch;
    } catch (e) {
      console.warn('Resync match error:', e.message);
      return null;
    }
  }

  // Auto-resync when browser regains network
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', () => {
      if (activeMatch && activeMatch.id) {
        resyncMatch();
        sendHeartbeat();
      }
    });
  }

  async function initMatch(matchId) {
    try {
      const authRes = await AuthLib.initAuth();
      if (!authRes.success) {
        throw new Error(authRes.error || 'Authentication required');
      }

      const match = await fetchMatchState(matchId);

      // Save match ID for reload restoration
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(ACTIVE_MATCH_KEY, matchId); } catch (e) {}
      }

      const sbClient = AuthLib.getSupabaseClient();
      setupRealtimeSubscription(matchId, sbClient);
      startHeartbeat(matchId);

      emit(match);
      return { success: true, match };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function restoreActiveMatch() {
    let savedMatchId = null;
    if (typeof localStorage !== 'undefined') {
      try { savedMatchId = localStorage.getItem(ACTIVE_MATCH_KEY); } catch (e) {}
    }

    if (!savedMatchId) return null;

    try {
      const res = await initMatch(savedMatchId);
      if (res.success && res.match) {
        if (res.match.status === 'active') {
          return res.match;
        }
        // Completed or abandoned: show final result to returning user, then clear storage
        if (typeof localStorage !== 'undefined') {
          try { localStorage.removeItem(ACTIVE_MATCH_KEY); } catch (e) {}
        }
        return res.match;
      }
      leaveMatch();
      return null;
    } catch (e) {
      leaveMatch();
      return null;
    }
  }

  function leaveMatch() {
    stopHeartbeat();
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(ACTIVE_MATCH_KEY); } catch (e) {}
    }

    const sbClient = AuthLib ? AuthLib.getSupabaseClient() : null;
    if (sbClient && realtimeChannel) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    activeMatch = null;
    emit(null);
  }

  async function submitMove(move) {
    if (!activeMatch) {
      throw new Error('No active match');
    }

    const token = AuthLib ? AuthLib.getAccessToken() : null;
    if (!token) {
      throw new Error('Not authenticated');
    }

    const endpoint = (typeof window !== 'undefined' && window.__MATCH_MOVE_ENDPOINT__) ||
      '/.netlify/functions/match-move';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        matchId: activeMatch.id,
        stateVersion: activeMatch.stateVersion,
        move
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    activeMatch = {
      ...activeMatch,
      status: data.status || activeMatch.status,
      result: data.result || activeMatch.result,
      winnerId: data.winnerId !== undefined ? data.winnerId : activeMatch.winnerId,
      stateVersion: data.stateVersion,
      currentTurn: data.currentTurn,
      boardRanks: data.boardRanks || activeMatch.boardRanks,
      chaosEvent: data.chaosEvent || null,
      gameState: data.gameState
    };

    emit(activeMatch);
    return data;
  }

  async function performAction(action) {
    if (!activeMatch) {
      throw new Error('No active match');
    }

    const token = AuthLib ? AuthLib.getAccessToken() : null;
    if (!token) {
      throw new Error('Not authenticated');
    }

    const endpoint = (typeof window !== 'undefined' && window.__MATCH_ACTION_ENDPOINT__) ||
      '/.netlify/functions/match-action';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        matchId: activeMatch.id,
        action
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    if (data.status) {
      activeMatch = {
        ...activeMatch,
        status: data.status,
        result: data.result || activeMatch.result,
        winnerId: data.winnerId !== undefined ? data.winnerId : activeMatch.winnerId
      };
      emit(activeMatch);
    }
    return data;
  }

  async function resignMatch() {
    return performAction('resign');
  }

  async function offerDraw() {
    return performAction('offer_draw');
  }

  async function acceptDraw() {
    return performAction('accept_draw');
  }

  function onMatchUpdate(callback) {
    if (typeof callback === 'function') {
      matchListeners.push(callback);
    }
    return () => {
      matchListeners = matchListeners.filter(cb => cb !== callback);
    };
  }

  async function claimAbandonment() {
    if (!activeMatch) throw new Error('No active match');
    return sendHeartbeat(true);
  }

  function onPeerStatusChange(callback) {
    if (typeof callback === 'function') {
      peerListeners.push(callback);
    }
    return () => {
      peerListeners = peerListeners.filter(cb => cb !== callback);
    };
  }

  return {
    initMatch,
    restoreActiveMatch,
    leaveMatch,
    submitMove,
    performAction,
    resignMatch,
    offerDraw,
    acceptDraw,
    claimAbandonment,
    sendHeartbeat,
    resyncMatch,
    getMatchData,
    onMatchUpdate,
    onPeerStatusChange,
    ACTIVE_MATCH_KEY
  };
}));
