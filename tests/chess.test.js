const assert = require('assert');
const ChessEngine = require('../src/engine/chess');

const {
  newPos,
  perft,
  status,
  legal,
  make,
  TESTS,
  FULL,
  FILES
} = ChessEngine;

function runPerftTests() {
  console.log('--- Running Perft Tests ---');
  let passed = 0;
  let total = 0;
  for (const [name, fen, expectedCounts] of TESTS) {
    const pos = newPos(fen);
    expectedCounts.forEach((expected, index) => {
      const depth = index + 1;
      const count = perft(pos, depth);
      total++;
      assert.strictEqual(count, expected, `Failed ${name} at depth ${depth}: got ${count}, expected ${expected}`);
      passed++;
      console.log(`  PASS: ${name} depth ${depth} = ${count}`);
    });
  }
  console.log(`Perft Tests Passed: ${passed}/${total}\n`);
}

function runDrawTests() {
  console.log('--- Running Draw Rule Tests ---');
  let passed = 0;
  let total = 0;

  const testCases = [
    ['Stalemate', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'stalemate'],
    ['King vs king', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'insufficient'],
    ['King+bishop vs king', '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', 'insufficient'],
    ['King+knight vs king', '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1', 'insufficient'],
    ['Same-color bishops', '5b2/8/4k3/8/8/3K4/8/2B5 w - - 0 1', 'insufficient'],
    ['Opposite-color bishops play on', '4b3/8/4k3/8/8/3K4/8/2B5 w - - 0 1', 'to move'],
    ['Two knights play on', '4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1', 'to move'],
    ['King+pawn plays on', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'to move']
  ];

  for (const [name, fen, substring] of testCases) {
    const pos = newPos(fen);
    const result = status({ pos, seen: {} });
    total++;
    assert(result.text.includes(substring), `${name} failed: expected "${substring}" in "${result.text}"`);
    passed++;
    console.log(`  PASS: ${name}`);
  }

  // 50-move rule
  const pos100 = newPos('4k3/8/8/8/8/8/8/R3K3 w - - 100 80');
  total++;
  assert(status({ pos: pos100, seen: {} }).text.includes('50-move'), '50-move rule check failed at hm=100');
  passed++;
  console.log('  PASS: 50-move rule at 100');

  const pos99 = newPos('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
  total++;
  assert(status({ pos: pos99, seen: {} }).text.includes('to move'), '50-move rule check failed at hm=99');
  passed++;
  console.log('  PASS: No draw at 99');

  // Threefold repetition
  const game = { pos: newPos(FULL), seen: {}, hist: [] };
  game.seen[ChessEngine.posKey(game.pos)] = 1;
  const rc = q => [8 - q[1], FILES.indexOf(q[0])];
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
  for (const mv of moves) {
    const a = rc(mv.slice(0, 2)), b = rc(mv.slice(2));
    const m = legal(game.pos).find(x => x.r === a[0] && x.f === a[1] && x.tr === b[0] && x.tf === b[1]);
    assert(m, `Move ${mv} not legal`);
    game.pos = make(game.pos, m);
    const k = ChessEngine.posKey(game.pos);
    game.seen[k] = (game.seen[k] || 0) + 1;
    game.hist.push(m);
  }
  total++;
  assert(status(game).text.includes('threefold'), 'Threefold repetition failed');
  passed++;
  console.log('  PASS: Threefold repetition');

  // Bare kings with and without rescue
  const bareFen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
  total++;
  assert(status({ pos: newPos(bareFen), seen: {} }, () => true).text.includes('to move'), 'Bare kings rescue failed');
  passed++;
  console.log('  PASS: Chaos + rescue: bare kings play on');

  total++;
  assert(status({ pos: newPos(bareFen), seen: {} }, () => false).text.includes('insufficient'), 'Bare kings without rescue failed');
  passed++;
  console.log('  PASS: Bare kings without rescue draw');

  console.log(`Draw Tests Passed: ${passed}/${total}\n`);
}

module.exports = {
  runPerftTests,
  runDrawTests
};

if (require.main === module) {
  runPerftTests();
  runDrawTests();
}
