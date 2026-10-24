const assert = require('assert');
const Matchmaking = require('../src/online/matchmaking');

async function runMatchmakingModuleTests() {
  console.log('--- Running Matchmaking Client Module Tests ---');

  // Verify exports
  assert.strictEqual(typeof Matchmaking.joinQueue, 'function');
  assert.strictEqual(typeof Matchmaking.leaveQueue, 'function');
  assert.strictEqual(typeof Matchmaking.getStatus, 'function');
  assert.strictEqual(typeof Matchmaking.onMatchmakingStateChange, 'function');
  console.log('  PASS: Matchmaking module exports verified.');

  // Test initial state
  const initial = Matchmaking.getStatus();
  assert.strictEqual(initial.status, 'idle');
  console.log('  PASS: Initial matchmaking state is idle.');

  // Test listener subscription & notification
  const receivedStates = [];
  const unsubscribe = Matchmaking.onMatchmakingStateChange(state => {
    receivedStates.push(state.status);
  });

  // Attempting join without configured auth should transition connecting -> error
  const joinResult = await Matchmaking.joinQueue();
  assert.strictEqual(joinResult.status, 'error');
  assert(receivedStates.includes('connecting'), 'Should have emitted connecting');
  assert(receivedStates.includes('error'), 'Should have emitted error');
  console.log('  PASS: Unauthenticated join safely transitions connecting -> error.');

  // Test unsubscribe
  unsubscribe();
  const countBefore = receivedStates.length;
  await Matchmaking.leaveQueue();
  assert.strictEqual(receivedStates.length, countBefore, 'Unsubscribed listener must not receive further events');
  console.log('  PASS: Listener unsubscription verified.');

  console.log('Matchmaking Client Module Tests Passed!\n');
}

module.exports = { runMatchmakingModuleTests };

if (require.main === module) {
  runMatchmakingModuleTests();
}
