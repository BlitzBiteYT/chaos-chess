const assert = require('assert');
const ChessEngine = require('../src/engine/chess');
const ChaosEngine = require('../src/engine/chaos');

function runChaosSyncTests() {
  console.log('--- Running Authoritative Chaos Synchronization Tests ---');

  const { newPos, FULL, make, legal, posKey } = ChessEngine;
  const { chaosTick, EVENTS } = ChaosEngine;

  const seed = 42109823;

  function createSimulatedMatch(matchSeed) {
    const startPos = newPos(FULL);
    return {
      pos: startPos,
      seen: { [posKey(startPos)]: 1 },
      hist: [],
      chaos: {
        seed: matchSeed,
        meter: 9, // CH.start
        max: 9,
        n: 0,
        next: null,
        last: null
      }
    };
  }

  // 1. Deterministic Sequence Test across 2 independent simulated runs
  const matchA = createSimulatedMatch(seed);
  const matchB = createSimulatedMatch(seed);

  const sampleMoves = [
    { r: 6, f: 4, tr: 4, tf: 4 }, // 1. e4
    { r: 1, f: 4, tr: 3, tf: 4 }, // 1... e5
    { r: 7, f: 6, tr: 5, tf: 5 }, // 2. Nf3
    { r: 0, f: 1, tr: 2, tf: 2 }, // 2... Nc6
    { r: 7, f: 5, tr: 4, tf: 2 }, // 3. Bc4
    { r: 0, f: 5, tr: 3, tf: 2 }, // 3... Bc5
    { r: 6, f: 2, tr: 5, tf: 2 }, // 4. c3
    { r: 1, f: 3, tr: 2, tf: 3 }, // 4... d6
    { r: 6, f: 3, tr: 4, tf: 3 }  // 5. d4 (Ply 9: meter hits 0!)
  ];

  const chaosEventsA = [];
  const chaosEventsB = [];

  for (let ply = 0; ply < sampleMoves.length; ply++) {
    const m = sampleMoves[ply];

    // Run A
    matchA.pos = make(matchA.pos, m);
    matchA.hist.push(m);
    const evA = chaosTick(matchA, true);
    if (evA) chaosEventsA.push({ ply: ply + 1, id: evA.ev.id, name: evA.ev.name });

    // Run B
    matchB.pos = make(matchB.pos, m);
    matchB.hist.push(m);
    const evB = chaosTick(matchB, true);
    if (evB) chaosEventsB.push({ ply: ply + 1, id: evB.ev.id, name: evB.ev.name });

    // Both must have identical meter state at every single ply
    assert.strictEqual(matchA.chaos.meter, matchB.chaos.meter, `Meter desync at ply ${ply + 1}`);
    assert.strictEqual(matchA.chaos.max, matchB.chaos.max);
    assert.strictEqual(posKey(matchA.pos), posKey(matchB.pos), `Position desync at ply ${ply + 1}`);
  }

  assert.strictEqual(chaosEventsA.length, chaosEventsB.length, 'Both clients must trigger identical number of events');
  assert(chaosEventsA.length > 0, 'At least one chaos event must have fired by ply 9');
  for (let i = 0; i < chaosEventsA.length; i++) {
    assert.strictEqual(chaosEventsA[i].id, chaosEventsB[i].id, `Event mismatch at event ${i}`);
    assert.strictEqual(chaosEventsA[i].ply, chaosEventsB[i].ply, `Event ply timing mismatch at event ${i}`);
  }
  console.log(`  PASS: Deterministic chaos event sequence verified across both runs (${chaosEventsA.map(e => e.name).join(', ')}).`);

  // 2. Meter Reset & Rhythm Verification
  // After event on ply 9, meter resets to CH.every (5)
  assert.strictEqual(matchA.chaos.meter, 5, 'Meter must reset to 5 after triggering');
  console.log('  PASS: Chaos meter reset to 5 verified.');

  // 3. No Repeats in a Row Rule Verification
  let prevEventId = null;
  let testMatch = createSimulatedMatch(887123);
  let repeatViolations = 0;
  for (let i = 0; i < 60; i++) {
    const ms = legal(testMatch.pos);
    if (!ms.length) break;
    testMatch.pos = make(testMatch.pos, ms[0]);
    const ev = chaosTick(testMatch, true);
    if (ev && !ev.rejected) {
      if (prevEventId && ev.ev.id === prevEventId) {
        repeatViolations++;
      }
      prevEventId = ev.ev.id;
    }
  }
  assert.strictEqual(repeatViolations, 0, 'No event may fire twice consecutively');
  console.log('  PASS: Rule 4 verified (no event fires twice in a row).');

  // 4. Invariant Safety in Online Match Engine
  let safetyFailures = 0;
  for (const ev of EVENTS) {
    const p = newPos(FULL);
    if (!ev.canFire(p)) continue;
    const out = ev.apply(p, ChaosEngine.mulberry(12345));
    const err = ChaosEngine.validate(p, out.p);
    if (!err) {
      // Invariant check: exactly 2 kings
      const kings = out.p.b.flat().filter(c => c && c.toLowerCase() === 'k').length;
      if (kings !== 2) safetyFailures++;
    }
  }
  assert.strictEqual(safetyFailures, 0, 'King safety invariants preserved');
  console.log('  PASS: Safety invariants strictly preserved during online execution.');

  console.log('Authoritative Chaos Synchronization Tests Passed!\n');
}

module.exports = { runChaosSyncTests };

if (require.main === module) {
  runChaosSyncTests();
}
