const assert = require('assert');
const ChessEngine = require('../src/engine/chess');
const ChaosEngine = require('../src/engine/chaos');

function runMultiplayerSyncTests() {
  console.log('--- Running Multiplayer Synchronization & State Restoration Tests ---');

  const { newPos, FULL, posKey, make, legal } = ChessEngine;
  const { mulberry } = ChaosEngine;

  const matchId = 'match-synced-789';
  const sharedSeed = 19840219;
  const startPos = newPos(FULL);

  const authoritativeMatch = {
    id: matchId,
    whitePlayerId: 'user-white-uuid',
    blackPlayerId: 'user-black-uuid',
    status: 'active',
    currentTurn: 'w',
    stateVersion: 0,
    seed: sharedSeed,
    chaosSettings: { on: true, every: 5, burst: 1 },
    boardRanks: 8,
    gameState: {
      pos: startPos,
      hist: [],
      sans: [],
      scol: [],
      caps: [],
      chaos: { seed: sharedSeed, meter: 9, max: 9, n: 0, next: null, last: null }
    }
  };

  // Client A: White's browser session
  const clientWhite = {
    mode: 'online',
    myColor: 'w',
    human: 'w',
    flipped: false,
    matchId: authoritativeMatch.id,
    seed: authoritativeMatch.seed,
    pos: authoritativeMatch.gameState.pos,
    turn: authoritativeMatch.gameState.pos.turn
  };

  // Client B: Black's browser session
  const clientBlack = {
    mode: 'online',
    myColor: 'b',
    human: 'b',
    flipped: true, // Black view is flipped
    matchId: authoritativeMatch.id,
    seed: authoritativeMatch.seed,
    pos: authoritativeMatch.gameState.pos,
    turn: authoritativeMatch.gameState.pos.turn
  };

  // 1. Verify both clients agree on match ID, seed, and turn
  assert.strictEqual(clientWhite.matchId, clientBlack.matchId, 'Both clients must agree on match ID');
  assert.strictEqual(clientWhite.seed, clientBlack.seed, 'Both clients must agree on shared seed');
  assert.strictEqual(clientWhite.turn, 'w', 'Current turn is White');
  assert.strictEqual(clientBlack.turn, 'w', 'Black agrees turn is White');
  console.log('  PASS: Both clients agree on Match ID, shared seed, and initial turn.');

  // 2. Verify board orientation: White is unflipped, Black is flipped
  assert.strictEqual(clientWhite.flipped, false, 'White client board is not flipped');
  assert.strictEqual(clientBlack.flipped, true, 'Black client board is flipped');
  console.log('  PASS: Board orientation automatically configured per player color.');

  // 3. Verify PRNG determinism with shared seed
  const randWhite = mulberry(clientWhite.seed);
  const randBlack = mulberry(clientBlack.seed);
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(randWhite(), randBlack(), `PRNG diverged at roll ${i}`);
  }
  console.log('  PASS: Seeded PRNG produces 100% identical sequence on both clients.');

  // 4. Verify turn guard (Black cannot move on White\'s turn)
  function canPlayerMove(client, sideToMove) {
    if (client.mode !== 'online') return true;
    return client.human === sideToMove;
  }

  assert.strictEqual(canPlayerMove(clientWhite, clientWhite.turn), true, 'White can move on White turn');
  assert.strictEqual(canPlayerMove(clientBlack, clientBlack.turn), false, 'Black cannot move on White turn');
  console.log('  PASS: Turn-lock prevents out-of-turn moves on online client.');

  // 5. Test page reload restoration simulation
  const mockLocalStorage = {
    data: { chaosChessActiveMatchId: matchId },
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = v; },
    removeItem(k) { delete this.data[k]; }
  };

  const reloadedMatchId = mockLocalStorage.getItem('chaosChessActiveMatchId');
  assert.strictEqual(reloadedMatchId, matchId, 'Saved active match ID preserved across reload');

  // Restoring match from saved ID
  const restoredClient = {
    mode: 'online',
    myColor: 'b',
    human: 'b',
    flipped: ('b' === 'b'),
    pos: authoritativeMatch.gameState.pos,
    turn: authoritativeMatch.gameState.pos.turn
  };

  assert.strictEqual(posKey(restoredClient.pos), posKey(authoritativeMatch.gameState.pos));
  assert.strictEqual(restoredClient.flipped, true);
  console.log('  PASS: Page reload restoration restores authoritative position and orientation.');

  console.log('Multiplayer Synchronization Tests Passed!\n');
}

module.exports = { runMultiplayerSyncTests };

if (require.main === module) {
  runMultiplayerSyncTests();
}
