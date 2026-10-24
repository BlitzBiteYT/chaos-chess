const { runPerftTests, runDrawTests } = require('./chess.test');
const { runChaosStressTest } = require('./chaos.test');
const { runSchemaTests } = require('./schema.test');
const { runSessionFunctionTests } = require('./session-function.test');
const { runAuthModuleTests } = require('./auth-module.test');
const { runQueueConcurrencyTests } = require('./queue-concurrency.test');
const { runMatchmakingModuleTests } = require('./matchmaking-module.test');
const { runMatchStateFunctionTests } = require('./match-state-function.test');
const { runMultiplayerSyncTests } = require('./multiplayer-sync.test');
const { runMatchMoveTests } = require('./match-move.test');
const { runChaosSyncTests } = require('./chaos-sync.test');
const { runGameEndingsTests } = require('./game-endings.test');
const { runReconnectionTests } = require('./reconnection.test');
const { runSecurityConcurrencyTests } = require('./security-concurrency.test');

console.log('========================================');
console.log('  Chaos Chess - Regression Test Suite   ');
console.log('========================================\n');

async function main() {
  try {
    runPerftTests();
    runDrawTests();
    runChaosStressTest(20, 80);
    require('./test-index');
    runSchemaTests();
    await runSessionFunctionTests();
    await runAuthModuleTests();
    runQueueConcurrencyTests();
    await runMatchmakingModuleTests();
    await runMatchStateFunctionTests();
    runMultiplayerSyncTests();
    runMatchMoveTests();
    runChaosSyncTests();
    await runGameEndingsTests();
    await runReconnectionTests();
    await runSecurityConcurrencyTests();
    console.log('========================================');
    console.log('  ALL TESTS COMPLETED SUCCESSFULLY!     ');
    console.log('========================================');
    process.exit(0);
  } catch (error) {
    console.error('\nTEST SUITE FAILED:', error);
    process.exit(1);
  }
}

main();
