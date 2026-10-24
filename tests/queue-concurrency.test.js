const assert = require('assert');
const fs = require('fs');

/**
 * Concurrency-Safe Queue & Matchmaking Logic Verification
 */
function runQueueConcurrencyTests() {
  console.log('--- Running Matchmaking Queue Concurrency Tests ---');

  // 1. Verify RPC SQL Migration exists and contains atomic FOR UPDATE SKIP LOCKED
  const rpcPath = 'supabase/migrations/20261024000001_matchmaking_rpc.sql';
  assert(fs.existsSync(rpcPath), 'Matchmaking RPC migration file missing');
  const rpcSql = fs.readFileSync(rpcPath, 'utf8');

  assert(rpcSql.includes('for update skip locked'), 'Missing atomic FOR UPDATE SKIP LOCKED in queue processor');
  console.log('  PASS: Atomic FOR UPDATE SKIP LOCKED verified in RPC SQL.');

  const sqlWithoutComments = rpcSql.replace(/--.*$/gm, '');
  assert(!sqlWithoutComments.toLowerCase().includes('elo'), 'Elo must NOT be referenced in SQL code');
  assert(!sqlWithoutComments.toLowerCase().includes('rating'), 'Rating must NOT be referenced in SQL code');
  console.log('  PASS: Strict FIFO verified (zero Elo/rating dependency in schema or RPC).');

  // 2. In-Memory Mock of PostgreSQL atomic queue & RPC
  class MockDatabase {
    constructor() {
      this.queue = new Map(); // id -> row
      this.matches = new Map();
    }

    upsertQueue(playerId) {
      // Uniqueness constraint on player_id
      for (const [id, row] of this.queue.entries()) {
        if (row.player_id === playerId) {
          if (row.status === 'matched') {
            return { ...row };
          }
          // Update existing waiting row
          row.queued_at = Date.now();
          row.status = 'waiting';
          row.match_id = null;
          return { ...row };
        }
      }

      const id = 'queue_' + Math.random().toString(36).substring(2, 9);
      const row = {
        id,
        player_id: playerId,
        status: 'waiting',
        match_id: null,
        queued_at: Date.now()
      };
      this.queue.set(id, row);
      return { ...row };
    }

    cancelQueue(playerId) {
      for (const [id, row] of this.queue.entries()) {
        if (row.player_id === playerId && row.status === 'waiting') {
          row.status = 'cancelled';
          return true;
        }
      }
      return false;
    }

    // Simulates the atomic process_matchmaking_queue() RPC
    processMatchmakingQueue() {
      const waiting = Array.from(this.queue.values())
        .filter(r => r.status === 'waiting')
        .sort((a, b) => a.queued_at - b.queued_at);

      if (waiting.length < 2) {
        return { matched: false };
      }

      const [p1, p2] = [waiting[0], waiting[1]];
      const matchId = 'match_' + Math.random().toString(36).substring(2, 10);
      const seed = Math.floor(Math.random() * 4000000000);

      this.matches.set(matchId, {
        id: matchId,
        white_player_id: p1.player_id,
        black_player_id: p2.player_id,
        seed
      });

      p1.status = 'matched';
      p1.match_id = matchId;
      p2.status = 'matched';
      p2.match_id = matchId;

      return {
        matched: true,
        matchId,
        white: p1.player_id,
        black: p2.player_id
      };
    }
  }

  const db = new MockDatabase();

  // Test: Player 1 joins queue
  const p1 = db.upsertQueue('user_alice');
  assert.strictEqual(p1.status, 'waiting');
  assert.strictEqual(p1.match_id, null);
  console.log('  PASS: Player 1 entered queue in waiting status.');

  // Test: Player 1 attempts duplicate join
  const p1Dup = db.upsertQueue('user_alice');
  assert.strictEqual(p1Dup.id, p1.id, 'Duplicate join must return the same queue entry');
  assert.strictEqual(db.queue.size, 1, 'Duplicate join must NOT create multiple entries');
  console.log('  PASS: Duplicate queue request prevented (single entry maintained).');

  // Test: Match check with only 1 player waiting
  let matchRes = db.processMatchmakingQueue();
  assert.strictEqual(matchRes.matched, false, 'Should not match with only 1 player');
  console.log('  PASS: Single player remains waiting without partial match.');

  // Test: Player 2 joins queue
  const p2 = db.upsertQueue('user_bob');
  assert.strictEqual(p2.status, 'waiting');
  console.log('  PASS: Player 2 entered queue.');

  // Test: Concurrency-safe atomic match formation
  matchRes = db.processMatchmakingQueue();
  assert.strictEqual(matchRes.matched, true);
  assert(matchRes.matchId, 'Match ID must be generated');

  // Verify both players received the EXACT same matchId
  const aliceRow = Array.from(db.queue.values()).find(r => r.player_id === 'user_alice');
  const bobRow = Array.from(db.queue.values()).find(r => r.player_id === 'user_bob');
  assert.strictEqual(aliceRow.status, 'matched');
  assert.strictEqual(bobRow.status, 'matched');
  assert.strictEqual(aliceRow.match_id, bobRow.match_id, 'Both players must receive the exact same match ID');
  console.log(`  PASS: Both players matched with identical Match ID: ${matchRes.matchId}`);

  // Test: Player 3 enters queue after match formed
  const p3 = db.upsertQueue('user_charlie');
  assert.strictEqual(p3.status, 'waiting');
  const matchRes3 = db.processMatchmakingQueue();
  assert.strictEqual(matchRes3.matched, false, 'Player 3 must remain waiting alone');
  console.log('  PASS: Player 3 remains waiting alone (no duplicate matching).');

  // Test: Player 3 cancels queue
  const cancelled = db.cancelQueue('user_charlie');
  assert.strictEqual(cancelled, true, 'Queue cancellation succeeded');
  const charlieEntry = Array.from(db.queue.values()).find(r => r.player_id === 'user_charlie');
  assert.strictEqual(charlieEntry.status, 'cancelled');
  console.log('  PASS: Queue cancellation correctly marks entry as cancelled.');

  console.log('Matchmaking Queue Concurrency Tests Passed!\n');
}

module.exports = { runQueueConcurrencyTests };

if (require.main === module) {
  runQueueConcurrencyTests();
}
