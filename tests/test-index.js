const fs = require('fs');
const assert = require('assert');

// 1. Check that files exist and are readable
assert(fs.existsSync('index.html'), 'index.html missing');
assert(fs.existsSync('src/engine/chess.js'), 'src/engine/chess.js missing');
assert(fs.existsSync('src/engine/chaos.js'), 'src/engine/chaos.js missing');
assert(fs.existsSync('src/online/config.js'), 'src/online/config.js missing');
assert(fs.existsSync('.env.example'), '.env.example missing');
assert(fs.existsSync('netlify.toml'), 'netlify.toml missing');

// 2. Read index.html and verify scripts are loaded
const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('<script src="src/online/config.js"></script>'), 'src/online/config.js not included');
assert(html.includes('<script src="src/online/auth.js"></script>'), 'src/online/auth.js not included');
assert(html.includes('<script src="src/online/matchmaking.js"></script>'), 'src/online/matchmaking.js not included');
assert(html.includes('<script src="src/online/multiplayer.js"></script>'), 'src/online/multiplayer.js not included');
assert(html.includes('<script src="src/engine/chess.js"></script>'), 'src/engine/chess.js not included');
assert(html.includes('<script src="src/engine/chaos.js"></script>'), 'src/engine/chaos.js not included');

// 3. Test that config works
const Config = require('../src/online/config');
const initialConfig = Config.getConfig();
assert('isConfigured' in initialConfig);
assert.strictEqual(initialConfig.isConfigured, false, 'Default config should not be marked as configured');

// 4. Test loading in simulated DOM environment
const chessCode = fs.readFileSync('src/engine/chess.js', 'utf8');
const chaosCode = fs.readFileSync('src/engine/chaos.js', 'utf8');
const configCode = fs.readFileSync('src/online/config.js', 'utf8');
const authCode = fs.readFileSync('src/online/auth.js', 'utf8');
const matchCode = fs.readFileSync('src/online/matchmaking.js', 'utf8');
const multiCode = fs.readFileSync('src/online/multiplayer.js', 'utf8');
const appScriptMatch = html.match(/<!-- Shared modularized engines -->[\s\S]*?<script>([\s\S]*?)<\/script>/);
assert(appScriptMatch, 'Could not find app script in index.html');
const appScript = appScriptMatch[1];

const domElements = {};
function getEl(id) {
  if (!domElements[id]) {
    domElements[id] = {
      innerHTML: '',
      textContent: '',
      className: '',
      style: { setProperty: () => {} },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      appendChild: () => {},
      append: () => {},
      addEventListener: () => {},
      closest: () => null,
      querySelectorAll: () => [],
      setAttribute: () => {},
      hidden: false,
      value: '',
      checked: true,
      disabled: false,
      dataset: {}
    };
  }
  return domElements[id];
}

const windowObj = {
  AudioContext: function() {
    return {
      currentTime: 0,
      destination: {},
      resume: () => {},
      createOscillator: () => ({
        type: '',
        frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {}
      }),
      createGain: () => ({
        gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {}
      })
    };
  },
  webkitAudioContext: function() { return windowObj.AudioContext(); },
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  }
};
const documentObj = {
  getElementById: getEl,
  createElement: (tag) => getEl(tag),
  documentElement: { style: { setProperty: () => {} } }
};
const performanceObj = {
  now: () => Date.now()
};

// Evaluate the complete chain
const runEnv = new Function(
  'window', 'document', 'performance', 'setTimeout', 'clearTimeout', 'self',
  `
  ${configCode}
  ${authCode}
  ${matchCode}
  ${multiCode}
  ${chessCode}
  ${chaosCode}
  ${appScript}
  return {
    G: () => G,
    startGame,
    commit,
    undo,
    resign,
    aiMove,
    evalPos,
    status,
    runTests,
    drawTests,
    chaosStress,
    setMode: (m) => { mode = m; },
    getLog: () => document.getElementById('log').textContent,
    getClog: () => document.getElementById('clog').textContent,
    getStatus: () => document.getElementById('status').textContent
  };
  `
);

const env = runEnv(windowObj, documentObj, performanceObj, (fn) => fn(), () => {}, windowObj);

console.log('--- Verifying Game Initialization ---');
const g = env.G();
assert(g.pos, 'Game position initialized');
assert.strictEqual(g.pos.turn, 'w', 'White starts');
assert.strictEqual(g.pos.b.length, 8, '8 rows');
console.log('  PASS: Game initialized correctly.');

console.log('--- Verifying Local Move Execution ---');
// White plays 1. e4 (rank 6, file 4 to rank 4, file 4)
const whiteMove = { r: 6, f: 4, tr: 4, tf: 4, dbl: 1 };
env.commit(whiteMove);
// Note: In synchronous setTimeout mock, AI immediately responds
assert(env.G().hist.length >= 1, 'Hist recorded move');
assert.strictEqual(env.G().sans[0], 'e4', 'White SAN is e4');
if (env.G().hist.length === 2) {
  console.log(`  PASS: White played e4, and AI synchronously replied with ${env.G().sans[1]}`);
} else {
  assert.strictEqual(env.G().pos.turn, 'b', 'Turn passed to black');
  console.log('  PASS: Local move committed and recorded.');
}

console.log('--- Verifying AI Move Generation Directly ---');
const bestMove = env.aiMove(env.G().pos, 1000);
assert(bestMove, 'AI produced a legal move');
console.log(`  PASS: AI chose move: [${bestMove.r}, ${bestMove.f}] -> [${bestMove.tr}, ${bestMove.tf}]`);

console.log('--- Verifying Undo Functionality ---');
const prevLen = env.G().hist.length;
env.commit(bestMove);
// With synchronous setTimeout, AI responded to bestMove as well
assert.strictEqual(env.G().hist.length, prevLen + 2, 'Two more plies played');
env.undo();
assert.strictEqual(env.G().hist.length, prevLen, 'Undo successfully rolled back 2 plies');
console.log('  PASS: Local undo operational.');

console.log('--- Verifying Online Mode Undo Block ---');
env.setMode('online');
const onlineLen = env.G().hist.length;
env.undo();
assert.strictEqual(env.G().hist.length, onlineLen, 'Online undo should be blocked');
const toastText = documentObj.getElementById('toast').textContent;
assert(toastText.includes('disabled in online multiplayer'), 'Toast alerts that online undo is disabled');
console.log('  PASS: Online undo blocked and toast displayed.');
env.setMode('w');

console.log('--- Verifying Developer Tests within index.html ---');
env.drawTests();
const clog = env.getClog();
assert(clog.includes('Draw rule tests'), 'Draw tests executed in UI environment');
assert(clog.includes('passed'), 'Draw tests passed');
console.log('  PASS: UI developer draw test execution verified.');

console.log('\n=============================================');
console.log('  INDEX.HTML INTEGRATION VERIFICATION PASSED! ');
console.log('=============================================');
