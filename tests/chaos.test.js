const assert = require('assert');
const ChessEngine = require('../src/engine/chess');
const ChaosEngine = require('../src/engine/chaos');

const {
  newPos,
  legal,
  make,
  FULL
} = ChessEngine;

const {
  mulberry,
  EVENTS,
  validate
} = ChaosEngine;

function runChaosStressTest(gamesCount = 20, pliesCount = 80) {
  console.log(`--- Running Chaos Stress Test (${gamesCount} games x ${pliesCount} plies) ---`);
  const stats = {};
  EVENTS.forEach(e => { stats[e.id] = { ok: 0, rej: 0 }; });
  let invariantFailures = 0;

  for (let g = 0; g < gamesCount; g++) {
    let p = newPos(FULL);
    const rand = mulberry(g * 7 + 1);

    for (let ply = 0; ply < pliesCount; ply++) {
      const ms = legal(p);
      if (!ms.length) break;
      p = make(p, ms[Math.floor(rand() * ms.length)]);

      for (const k of ['portal', 'frozen', 'fog']) {
        if (p[k]) p[k] = p[k].ttl > 1 ? { ...p[k], ttl: p[k].ttl - 1 } : null;
      }

      if (ply % 3 !== 2) continue;

      for (const ev of EVENTS) {
        if (!ev.canFire(p) || !legal(p).length) continue;
        const out = ev.apply(p, rand);
        const err = validate(p, out.p);
        if (err) {
          stats[ev.id].rej++;
          continue;
        }
        stats[ev.id].ok++;
        p = out.p;

        const kings = out.p.b.flat().filter(c => c && c.toLowerCase() === 'k').length;
        if (kings !== 2 || !legal(p).length) {
          invariantFailures++;
        }
      }
    }
  }

  let totalFired = 0;
  let totalRej = 0;
  for (const ev of EVENTS) {
    totalFired += stats[ev.id].ok;
    totalRej += stats[ev.id].rej;
  }

  console.log(`Total events fired: ${totalFired}, rejected by safety: ${totalRej}`);
  console.log(`Invariant failures: ${invariantFailures}`);
  assert.strictEqual(invariantFailures, 0, 'Invariant failures detected during chaos stress test');
  console.log('Chaos Stress Test Passed: 0 invariant failures!\n');
}

module.exports = {
  runChaosStressTest
};

if (require.main === module) {
  runChaosStressTest();
}
