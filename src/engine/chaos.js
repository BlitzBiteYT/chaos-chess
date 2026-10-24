/**
 * Chaos Chess - Chaos Mechanics and Event System
 * Handles deterministic PRNG seeding, event definitions, safety validation, and meter cycling.
 */
(function(root, factory) {
  let chessLib = null;
  if (root && root.ChaosChessEngine) {
    chessLib = root.ChaosChessEngine;
  } else if (typeof require === 'function') {
    try {
      chessLib = require('./chess');
    } catch (e) {}
  }
  const lib = factory(chessLib);
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = lib;
  }
  if (root) {
    root.ChaosEngine = lib;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function(ChessEngine) {
  const {
    inb,
    isW,
    inCheck,
    legal,
    posKey,
    attacked,
    pseudo
  } = ChessEngine;

  function mulberry(a) {
    return () => {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CH = { start: 9, every: 5, burst: 1 };
  const clonePos = p => ({ ...p, b: p.b.map(r => r.slice()) });

  const emptySqs = (p, r0, r1) => {
    const o = [];
    r1 += p.b.length - 8;
    for (let r = r0; r <= r1; r++) {
      for (let f = 0; f < 8; f++) {
        if (!p.b[r][f]) o.push([r, f]);
      }
    }
    return o;
  };

  const activeEmptySqs = p => {
    const o = [];
    const seen = new Set();
    const addMoves = pos => {
      const ms = legal(pos);
      for (const m of ms) {
        if (!pos.b[m.tr][m.tf]) {
          const key = m.tr + ',' + m.tf;
          if (!seen.has(key)) {
            seen.add(key);
            o.push([m.tr, m.tf]);
          }
        }
      }
    };
    addMoves(p);
    addMoves({ ...p, turn: p.turn === 'w' ? 'b' : 'w' });
    return o.length ? o : emptySqs(p, 0, p.b.length - 1);
  };

  const pickOut = (a, rand) => a.splice(Math.floor(rand() * a.length), 1)[0];

  const quakeCands = (p, skip) => {
    const o = [];
    const nr = p.b.length;
    for (let r = 0; r < nr; r++) {
      for (let f = 0; f < 8; f++) {
        const c = p.b[r][f];
        if (c && c.toLowerCase() === 'p' && !(skip && skip.has(r + ',' + f))) {
          for (const d of [-1, 1]) {
            if (inb(r, f + d, nr) && !p.b[r][f + d]) o.push([r, f, f + d]);
          }
        }
      }
    }
    return o;
  };

  const MV = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const mat = (p, w) => {
    let s = 0;
    for (const row of p.b) {
      for (const c of row) {
        if (c && c.toLowerCase() !== 'k' && isW(c) === w) s += MV[c.toLowerCase()];
      }
    }
    return s;
  };

  const pieceList = (p, test) => {
    const o = [];
    for (let r = 0; r < p.b.length; r++) {
      for (let f = 0; f < 8; f++) {
        const c = p.b[r][f];
        if (c && test(c)) o.push([r, f]);
      }
    }
    return o;
  };

  const swapPairs = (p, w) => {
    const L = pieceList(p, c => c.toLowerCase() !== 'k' && isW(c) === w);
    const o = [];
    const bad = (c, r) => c.toLowerCase() === 'p' && (r === 0 || r === p.b.length - 1);
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j], ca = p.b[a[0]][a[1]], cb = p.b[b[0]][b[1]];
        if (ca === cb || bad(ca, b[0]) || bad(cb, a[0])) continue;
        o.push([a, b]);
      }
    }
    return o;
  };

  const rushT = p => {
    const o = [];
    for (const w of [true, false]) {
      let best = null;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          if (p.b[r][f] !== (w ? 'P' : 'p')) continue;
          const adv = w ? p.b.length - 1 - r : r;
          if (!best || adv > best[2]) best = [r, f, adv];
        }
      }
      if (!best || best[2] < 3) return null;
      o.push(best);
    }
    return o;
  };

  const rushApply = p => {
    const q = clonePos(p), t = rushT(p);
    q.ep = null;
    t.forEach(([r, f], i) => { q.b[r][f] = i ? 'n' : 'N'; });
    return { p: q, pops: t.map(x => [x[0], x[1]]) };
  };

  const reshape = (p, k, d) => {
    const q = clonePos(p);
    q.ep = null;
    if (d > 0) q.b.splice(k, 0, Array(8).fill(null));
    else q.b.splice(k, 1);
    const mv = t => t[0] < k ? t : d > 0 ? [t[0] + 1, t[1]] : t[0] === k ? null : [t[0] - 1, t[1]];
    if (q.portal) {
      const a = mv(q.portal.a), b = mv(q.portal.b);
      q.portal = a && b ? { ...q.portal, a, b } : null;
    }
    if (q.frozen) {
      const t = mv(q.frozen.sq);
      q.frozen = t ? { ...q.frozen, sq: t } : null;
    }
    return q;
  };

  const emptyRows = p => {
    const o = [];
    for (let k = 2; k <= p.b.length - 3; k++) {
      if (p.b[k].every(c => !c)) o.push(k);
    }
    return o;
  };

  const tideRows = p => {
    const o = [];
    for (let r = 1; r < p.b.length - 1; r++) {
      if (p.b[r].some(c => c)) o.push(r);
    }
    return o;
  };

  const meteorOpts = p => {
    const o = [];
    for (let r = 0; r < p.b.length - 1; r++) {
      for (let f = 0; f < 7; f++) {
        const hit = [];
        let w = 0, b = 0;
        for (const [dr, df] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          const c = p.b[r + dr][f + df];
          if (c && !'kKqQ'.includes(c)) {
            hit.push([r + dr, f + df]);
            if (isW(c)) w += MV[c.toLowerCase()];
            else b += MV[c.toLowerCase()];
          }
        }
        if (hit.length && Math.abs(w - b) <= 3) o.push(hit);
      }
    }
    return o;
  };

  const defOpts = p => {
    const w = mat(p, true) > mat(p, false);
    return pieceList(p, c => isW(c) === w && 'nbr'.includes(c.toLowerCase()));
  };

  const fixCast = q => {
    q.cast = q.cast.split('').filter(x => {
      const w = x < 'a', row = w ? q.b.length - 1 : 0;
      return q.b[row][4] === (w ? 'K' : 'k') && q.b[row][x.toLowerCase() === 'k' ? 7 : 0] === (w ? 'R' : 'r');
    }).join('');
  };

  const grav = p => {
    const q = clonePos(p), slides = [], R = q.b.length;
    q.ep = null;
    for (const w of [true, false]) {
      const rows = [...Array(R).keys()];
      if (w) rows.reverse();
      for (const r of rows) {
        for (let f = 0; f < 8; f++) {
          const c = q.b[r][f];
          if (!c || isW(c) !== w || 'pk'.includes(c.toLowerCase())) continue;
          const nr = r + (w ? 1 : -1);
          if (nr < 0 || nr >= R || q.b[nr][f]) continue;
          q.b[nr][f] = c;
          q.b[r][f] = null;
          slides.push({ from: [r, f], to: [nr, f] });
        }
      }
    }
    fixCast(q);
    return { p: q, slides };
  };

  const coronate = p => {
    const q = clonePos(p), w = mat(p, true) < mat(p, false);
    let best = null;
    for (let r = 0; r < p.b.length; r++) {
      for (let f = 0; f < 8; f++) {
        if (p.b[r][f] !== (w ? 'P' : 'p')) continue;
        const adv = w ? p.b.length - 1 - r : r;
        if (!best || adv > best[2]) best = [r, f, adv];
      }
    }
    if (!best || best[2] < 3) return null;
    q.ep = null;
    q.b[best[0]][best[1]] = w ? 'Q' : 'q';
    return { p: q, pops: [[best[0], best[1]]] };
  };

  const tradeOpts = p => {
    const o = [];
    for (const t of 'nbrqp') {
      const W = pieceList(p, c => c === t.toUpperCase()), B = pieceList(p, c => c === t);
      if (W.length && B.length) o.push([W, B]);
    }
    return o;
  };

  const stamp = p => {
    const q = clonePos(p), w = mat(p, true) < mat(p, false), slides = [];
    q.ep = null;
    const L = pieceList(q, c => c === (w ? 'P' : 'p')).sort((x, y) => w ? x[0] - y[0] : y[0] - x[0]);
    for (const [r, f] of L) {
      const nr = r + (w ? -1 : 1);
      if (nr <= 0 || nr >= q.b.length - 1 || q.b[nr][f]) continue;
      q.b[nr][f] = q.b[r][f];
      q.b[r][f] = null;
      slides.push({ from: [r, f], to: [nr, f] });
    }
    return { p: q, slides };
  };

  const mirrorRows = p => tideRows(p).filter(r => p.b[r].some((c, f) => c !== p.b[r][7 - f]));
  const nbOf = (p, w) => pieceList(p, c => isW(c) === w && 'nb'.includes(c.toLowerCase()));
  const riftOf = (p, w) => pieceList(p, c => isW(c) === w && !'pk'.includes(c.toLowerCase()));

  // Safety rules: an event may never break these, or it is rejected
  function validate(a, b) {
    const cnt = p => {
      const o = {};
      p.b.flat().forEach(c => { if (c) o[c] = (o[c] || 0) + 1; });
      return o;
    };
    const ca = cnt(a), cb = cnt(b);
    if (cb.K !== 1 || cb.k !== 1) return 'king missing or duplicated';
    for (const k of 'KQkq') {
      if ((cb[k] || 0) < (ca[k] || 0)) return 'would remove a king or queen';
    }
    if (b.b[0].concat(b.b[b.b.length - 1]).some(c => c && c.toLowerCase() === 'p')) return 'pawn on back rank';
    for (const w of [true, false]) {
      if (!inCheck(a, w) && inCheck(b, w)) return 'would put a king in check';
    }
    if (legal(a).length && !legal(b).length) return 'would end the game';
    return null;
  }

  const EVENTS = [
    {
      id: 'quake', name: 'Earthquake', color: '#e0407a', sound: 'quake', desc: 'Up to 3 pawns slide sideways.',
      canFire: p => quakeCands(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), slides = [], skip = new Set();
        q.ep = null;
        for (let i = 0; i < 3; i++) {
          const c = quakeCands(q, skip);
          if (!c.length) break;
          const [r, f, tf] = c[Math.floor(rand() * c.length)];
          q.b[r][tf] = q.b[r][f];
          q.b[r][f] = null;
          skip.add(r + ',' + tf);
          slides.push({ from: [r, f], to: [r, tf] });
        }
        return { p: q, slides };
      }
    },
    {
      id: 'portal', name: 'Portal', color: '#8e5cf0', sound: 'portal', desc: 'Two squares are linked. Step into one, exit the other.',
      canFire: p => !p.portal && emptySqs(p, 1, 6).length >= 6,
      apply(p, rand) {
        const q = clonePos(p), e = emptySqs(q, 1, 6), a = pickOut(e, rand);
        const far = e.filter(s => Math.max(Math.abs(s[0] - a[0]), Math.abs(s[1] - a[1])) >= 3);
        q.portal = { a, b: pickOut(far.length ? far : e, rand), ttl: 6 };
        return { p: q };
      }
    },
    {
      id: 'frozen', name: 'Frozen Square', color: '#4aa8e8', sound: 'ice', desc: 'One tactical empty square is frozen: nobody can move onto it.',
      canFire: p => !p.frozen && activeEmptySqs(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), e = activeEmptySqs(q);
        q.frozen = { sq: pickOut(e, rand), ttl: 4 };
        return { p: q };
      }
    },
    {
      id: 'swap', name: 'Swap Meet', color: '#f0a020', sound: 'warp', desc: 'Two pieces of the same color trade places.',
      canFire: p => swapPairs(p, true).length + swapPairs(p, false).length > 0,
      apply(p, rand) {
        const q = clonePos(p), opts = [true, false].map(w => swapPairs(q, w)).filter(a => a.length), prs = opts[Math.floor(rand() * opts.length)];
        const [a, b] = prs[Math.floor(rand() * prs.length)], t = q.b[a[0]][a[1]];
        q.b[a[0]][a[1]] = q.b[b[0]][b[1]];
        q.b[b[0]][b[1]] = t;
        q.ep = null;
        fixCast(q);
        return { p: q, slides: [{ from: a, to: b }, { from: b, to: a }] };
      }
    },
    {
      id: 'rush', name: 'Promotion Rush', color: '#2fb97a', sound: 'portal', desc: "Each side's most advanced pawn becomes a knight.",
      canFire: p => !!rushT(p) && !validate(p, rushApply(p).p),
      apply: p => rushApply(p)
    },
    {
      id: 'fog', name: 'Fog of War', color: '#7a869e', sound: 'fog', desc: 'Enemy pieces and threat analysis are hidden in the fog until the next event trigger.',
      canFire: p => !p.fog,
      apply(p) {
        const q = clonePos(p);
        q.fog = { untilNextTrigger: true, ttl: 99 };
        return { p: q };
      }
    },
    {
      id: 'dtime', name: 'Double Time', color: '#e8742a', sound: 'dtime', desc: 'The side behind in material gets a bonus move.',
      canFire: p => !p.dt && mat(p, true) !== mat(p, false),
      apply(p) {
        const q = clonePos(p), w = mat(p, true) < mat(p, false);
        q.dt = w ? 'w' : 'b';
        return { p: q, msg: (w ? 'White' : 'Black') + ' is behind and gets a bonus move (a checking move ends it)' };
      }
    },
    {
      id: 'zap', name: 'Lightning', color: '#f2c230', sound: 'zap', desc: 'One pawn from each side is struck down.',
      canFire: p => [true, false].every(w => pieceList(p, c => c === (w ? 'P' : 'p')).length > 0),
      apply(p, rand) {
        const q = clonePos(p), zaps = [];
        q.ep = null;
        for (const w of [true, false]) {
          const L = pieceList(q, c => c === (w ? 'P' : 'p')), [r, f] = L[Math.floor(rand() * L.length)];
          q.b[r][f] = null;
          zaps.push([r, f]);
        }
        return { p: q, zaps };
      }
    },
    {
      id: 'grow', name: 'Growth', color: '#18b4c8', sound: 'quake', desc: 'The board stretches: a new empty rank opens up.',
      canFire: p => p.b.length < 10,
      apply(p, rand) {
        const k = 2 + Math.floor(rand() * (p.b.length - 4));
        return { p: reshape(p, k, 1), shift: { k, d: 1 } };
      }
    },
    {
      id: 'squeeze', name: 'Squeeze', color: '#c85a18', sound: 'quake', desc: 'An empty rank collapses and the board shrinks.',
      canFire: p => p.b.length > 8 && emptyRows(p).length > 0,
      apply(p, rand) {
        const e = emptyRows(p), k = e[Math.floor(rand() * e.length)];
        return { p: reshape(p, k, -1), shift: { k, d: -1 } };
      }
    },
    {
      id: 'tide', name: 'Tide', color: '#2a7fd8', sound: 'warp', desc: 'A rank of pieces rotates one file, wrapping around the edge.',
      canFire: p => tideRows(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), rs = tideRows(q), r = rs[Math.floor(rand() * rs.length)], d = rand() < .5 ? 1 : -1, row = q.b[r].slice(), slides = [];
        q.ep = null;
        for (let f = 0; f < 8; f++) {
          const t = (f + d + 8) % 8;
          q.b[r][t] = row[f];
          if (row[f]) slides.push({ from: [r, f], to: [r, t] });
        }
        return { p: q, slides };
      }
    },
    {
      id: 'meteor', name: 'Meteor', color: '#d83a2a', sound: 'quake', desc: 'A meteor smashes a 2×2 area: everything but kings and queens is destroyed.',
      canFire: p => meteorOpts(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), o = meteorOpts(q), hit = o[Math.floor(rand() * o.length)];
        q.ep = null;
        hit.forEach(([r, f]) => { q.b[r][f] = null; });
        fixCast(q);
        return { p: q, zaps: hit };
      }
    },
    {
      id: 'defect', name: 'Defection', color: '#8a2fb8', sound: 'warp', desc: 'A rook, bishop or knight of the side ahead in material switches sides.',
      canFire: p => mat(p, true) !== mat(p, false) && defOpts(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), o = defOpts(q), [r, f] = o[Math.floor(rand() * o.length)], c = q.b[r][f];
        q.b[r][f] = isW(c) ? c.toLowerCase() : c.toUpperCase();
        q.ep = null;
        fixCast(q);
        return { p: q, pops: [[r, f]] };
      }
    },
    {
      id: 'stampede', name: 'Stampede', color: '#b8742f', sound: 'quake', desc: 'The side behind in material pushes every pawn forward one square.',
      canFire: p => mat(p, true) !== mat(p, false) && stamp(p).slides.length > 0,
      apply: p => stamp(p)
    },
    {
      id: 'reinforce', name: 'Reinforcements', color: '#3a9a4a', sound: 'portal', desc: 'Each side gets a new pawn on its pawn rank.',
      canFire: p => [true, false].every(w => p.b[w ? p.b.length - 2 : 1].some(c => !c)),
      apply(p, rand) {
        const q = clonePos(p), pops = [];
        q.ep = null;
        for (const w of [true, false]) {
          const row = w ? q.b.length - 2 : 1, e = [];
          for (let f = 0; f < 8; f++) if (!q.b[row][f]) e.push(f);
          const f = e[Math.floor(rand() * e.length)];
          q.b[row][f] = w ? 'P' : 'p';
          pops.push([row, f]);
        }
        return { p: q, pops };
      }
    },
    {
      id: 'mirror', name: 'Mirror', color: '#6a6ad8', sound: 'warp', desc: 'A rank of pieces is flipped left to right.',
      canFire: p => mirrorRows(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), rs = mirrorRows(q), r = rs[Math.floor(rand() * rs.length)], row = q.b[r].slice(), slides = [];
        q.ep = null;
        for (let f = 0; f < 8; f++) {
          q.b[r][7 - f] = row[f];
          if (row[f]) slides.push({ from: [r, f], to: [r, 7 - f] });
        }
        return { p: q, slides };
      }
    },
    {
      id: 'mutate', name: 'Mutation', color: '#b83a9a', sound: 'warp', desc: 'One knight or bishop per side turns into the other.',
      canFire: p => nbOf(p, true).length > 0 && nbOf(p, false).length > 0,
      apply(p, rand) {
        const q = clonePos(p), pops = [];
        for (const w of [true, false]) {
          const L = nbOf(q, w), [r, f] = L[Math.floor(rand() * L.length)], t = q.b[r][f].toLowerCase() === 'n' ? 'b' : 'n';
          q.b[r][f] = w ? t.toUpperCase() : t;
          pops.push([r, f]);
        }
        return { p: q, pops };
      }
    },
    {
      id: 'rift', name: 'Rift', color: '#5a2fd8', sound: 'portal', desc: 'One piece per side is flung to a random empty square.',
      canFire: p => riftOf(p, true).length > 0 && riftOf(p, false).length > 0 && emptySqs(p, 1, 6).length >= 2,
      apply(p, rand) {
        const q = clonePos(p), e = emptySqs(q, 1, 6), slides = [];
        q.ep = null;
        for (const w of [true, false]) {
          const L = riftOf(q, w), [r, f] = L[Math.floor(rand() * L.length)], to = pickOut(e, rand);
          q.b[to[0]][to[1]] = q.b[r][f];
          q.b[r][f] = null;
          slides.push({ from: [r, f], to });
        }
        fixCast(q);
        return { p: q, slides };
      }
    },
    {
      id: 'coronate', name: 'Coronation', color: '#d8a010', sound: 'dtime', desc: 'The side behind in material crowns its most advanced pawn as a queen.',
      canFire: p => mat(p, true) !== mat(p, false) && (o => !!o && !validate(p, o.p))(coronate(p)),
      apply: p => coronate(p)
    },
    {
      id: 'trade', name: 'Trade Deal', color: '#18a878', sound: 'warp', desc: 'A white and a black piece of the same type swap squares.',
      canFire: p => tradeOpts(p).length > 0,
      apply(p, rand) {
        const q = clonePos(p), o = tradeOpts(q), [W, B] = o[Math.floor(rand() * o.length)], a = W[Math.floor(rand() * W.length)], b = B[Math.floor(rand() * B.length)], t = q.b[a[0]][a[1]];
        q.b[a[0]][a[1]] = q.b[b[0]][b[1]];
        q.b[b[0]][b[1]] = t;
        q.ep = null;
        fixCast(q);
        return { p: q, slides: [{ from: a, to: b }, { from: b, to: a }] };
      }
    },
    {
      id: 'gravity', name: 'Gravity', color: '#7a5a3a', sound: 'quake', desc: 'Every knight, bishop, rook and queen drops one rank toward its own back rank if the square is free.',
      canFire: p => grav(p).slides.length > 0,
      apply: p => grav(p)
    },
    {
      id: 'fault', name: 'Fault Line', color: '#a83a3a', sound: 'quake', desc: 'Two files swap places, pieces and all.',
      canFire: p => true,
      apply(p, rand) {
        const q = clonePos(p), f1 = Math.floor(rand() * 8), f2 = (f1 + 1 + Math.floor(rand() * 7)) % 8, slides = [];
        q.ep = null;
        for (let r = 0; r < q.b.length; r++) {
          const t = q.b[r][f1];
          q.b[r][f1] = q.b[r][f2];
          q.b[r][f2] = t;
          if (q.b[r][f1]) slides.push({ from: [r, f2], to: [r, f1] });
          if (q.b[r][f2]) slides.push({ from: [r, f1], to: [r, f2] });
        }
        fixCast(q);
        return { p: q, slides };
      }
    },
    {
      id: 'blackhole', name: 'Black Hole', color: '#7c3aed', sound: 'quake', desc: 'A cosmic singularity pulls pieces 1 square inward toward the center.',
      canFire: p => {
        const nr = p.b.length;
        for (let r = 0; r < nr; r++) {
          for (let f = 0; f < 8; f++) {
            const c = p.b[r][f];
            if (!c || c.toLowerCase() === 'k') continue;
            const dr = r < 3 ? 1 : (r > 4 ? -1 : 0);
            const df = f < 3 ? 1 : (f > 4 ? -1 : 0);
            if ((dr || df) && inb(r + dr, f + df, nr) && !p.b[r + dr][f + df]) {
              if (c.toLowerCase() === 'p' && (r + dr === 0 || r + dr === nr - 1)) continue;
              return true;
            }
          }
        }
        return false;
      },
      apply(p) {
        const q = clonePos(p), nr = q.b.length, slides = [];
        q.ep = null;
        const rOrder = [...Array(nr).keys()].sort((a, b) => Math.abs(a - 3.5) - Math.abs(b - 3.5));
        const fOrder = [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => Math.abs(a - 3.5) - Math.abs(b - 3.5));
        for (const r of rOrder) {
          for (const f of fOrder) {
            const c = q.b[r][f];
            if (!c || c.toLowerCase() === 'k') continue;
            const dr = r < 3 ? 1 : (r > 4 ? -1 : 0);
            const df = f < 3 ? 1 : (f > 4 ? -1 : 0);
            if (!dr && !df) continue;
            const tr = r + dr, tf = f + df;
            if (inb(tr, tf, nr) && !q.b[tr][tf]) {
              if (c.toLowerCase() === 'p' && (tr === 0 || tr === nr - 1)) continue;
              q.b[tr][tf] = c;
              q.b[r][f] = null;
              slides.push({ from: [r, f], to: [tr, tf] });
            }
          }
        }
        fixCast(q);
        return { p: q, slides };
      }
    },
    {
      id: 'bounty', name: "King's Ransom", color: '#f59e0b', sound: 'portal', desc: 'A bounty is placed on a minor piece. Its capturer claims an immediate bonus pawn!',
      canFire: p => pieceList(p, c => 'nbr'.includes(c.toLowerCase())).length > 0,
      apply(p, rand) {
        const q = clonePos(p), opts = pieceList(q, c => 'nbr'.includes(c.toLowerCase()));
        const [r, f] = opts[Math.floor(rand() * opts.length)];
        q.bounty = { sq: [r, f], piece: q.b[r][f], ttl: 6 };
        return { p: q, pops: [[r, f]] };
      }
    },
    {
      id: 'phantom', name: 'Phantom Split', color: '#06b6d4', sound: 'warp', desc: 'A knight or bishop projects an illusory decoy onto an adjacent square.',
      canFire: p => pieceList(p, c => 'nb'.includes(c.toLowerCase())).length > 0 && emptySqs(p, 1, 6).length > 0,
      apply(p, rand) {
        const q = clonePos(p), opts = pieceList(q, c => 'nb'.includes(c.toLowerCase()));
        const [r, f] = opts[Math.floor(rand() * opts.length)];
        const adj = [];
        for (const dr of [-1, 0, 1]) {
          for (const df of [-1, 0, 1]) {
            if (!dr && !df) continue;
            if (inb(r + dr, f + df, q.b.length) && !q.b[r + dr][f + df]) adj.push([r + dr, f + df]);
          }
        }
        const target = adj.length ? adj[Math.floor(rand() * adj.length)] : pickOut(emptySqs(q, 1, 6), rand);
        q.phantom = { sq: target, source: [r, f], ttl: 4 };
        return { p: q, pops: [target] };
      }
    },
    {
      id: 'overcharge', name: 'Overcharge', color: '#eab308', sound: 'zap', desc: 'One piece per side surges with electric energy, supercharging its power.',
      canFire: p => nbOf(p, true).length > 0 && nbOf(p, false).length > 0,
      apply(p, rand) {
        const q = clonePos(p), wNb = nbOf(q, true), bNb = nbOf(q, false);
        const wSq = wNb[Math.floor(rand() * wNb.length)];
        const bSq = bNb[Math.floor(rand() * bNb.length)];
        q.overcharged = { w: wSq, b: bSq, ttl: 4 };
        return { p: q, pops: [wSq, bSq] };
      }
    },
    {
      id: 'necromancy', name: 'Necromancy', color: '#10b981', sound: 'portal', desc: 'A fallen piece rises from the dead onto an empty square on its back rank.',
      canFire: p => {
        const nr = p.b.length;
        const wEmpty = [0, 1, 2, 3, 4, 5, 6, 7].some(f => !p.b[nr - 1][f]);
        const bEmpty = [0, 1, 2, 3, 4, 5, 6, 7].some(f => !p.b[0][f]);
        return wEmpty && bEmpty;
      },
      apply(p, rand) {
        const q = clonePos(p), nr = q.b.length, pops = [];
        q.ep = null;
        for (const w of [true, false]) {
          const row = w ? nr - 1 : 0;
          const openCols = [];
          for (let f = 0; f < 8; f++) if (!q.b[row][f]) openCols.push(f);
          if (openCols.length) {
            const f = openCols[Math.floor(rand() * openCols.length)];
            const resurrected = rand() < .5 ? 'n' : 'b';
            q.b[row][f] = w ? resurrected.toUpperCase() : resurrected;
            pops.push([row, f]);
          }
        }
        fixCast(q);
        return { p: q, pops };
      }
    },
    {
      id: 'magma', name: 'Magma Floor', color: '#dc2626', sound: 'quake', desc: 'Two tactical squares turn into boiling lava for 3 moves.',
      canFire: p => !p.magma && activeEmptySqs(p).length >= 2,
      apply(p, rand) {
        const q = clonePos(p), e = activeEmptySqs(q).slice();
        const sq1 = pickOut(e, rand);
        const sq2 = pickOut(e, rand);
        q.magma = { sqs: [sq1, sq2], ttl: 4 };
        return { p: q, pops: [sq1, sq2] };
      }
    }
  ];

  EVENTS.forEach(e => { e.on = true; });

  function chaosPick(g) {
    let ok = EVENTS.filter(e => e.on && e.canFire(g.pos));
    const nl = ok.filter(e => e.id !== g.chaos.last);
    if (nl.length) ok = nl;
    return ok.length ? ok[Math.floor(mulberry(g.chaos.seed + g.chaos.n * 131)() * ok.length)] : null;
  }

  function isOverdrive(pos) {
    if (!pos || !pos.b) return false;
    let nonKingPawns = 0;
    for (const row of pos.b) {
      for (const c of row) {
        if (c && !'kp'.includes(c.toLowerCase())) nonKingPawns++;
      }
    }
    return nonKingPawns <= 4;
  }

  function computeDangerZones(g) {
    if (!g || !g.chaos || g.chaos.meter !== 1 || !g.chaos.next) return [];
    const ev = g.chaos.next;
    const p = g.pos;
    const rand = mulberry(g.chaos.seed + (g.chaos.n + 1) * 977);

    if (ev.id === 'meteor') {
      const o = meteorOpts(p);
      if (o.length) return o[Math.floor(rand() * o.length)];
    } else if (ev.id === 'zap') {
      const zones = [];
      for (const w of [true, false]) {
        const L = pieceList(p, c => c === (w ? 'P' : 'p'));
        if (L.length) zones.push(L[Math.floor(rand() * L.length)]);
      }
      return zones;
    } else if (ev.id === 'magma') {
      const e = activeEmptySqs(p).slice();
      if (e.length >= 2) {
        const s1 = pickOut(e, rand);
        const s2 = pickOut(e, rand);
        return [s1, s2];
      }
    } else if (ev.id === 'frozen') {
      const e = activeEmptySqs(p);
      if (e.length) return [e[Math.floor(rand() * e.length)]];
    }
    return [];
  }

  function ageEffects(pos) {
    for (const k of ['portal', 'frozen', 'magma', 'phantom', 'bounty', 'overcharged']) {
      if (!pos[k]) continue;
      const t = pos[k].ttl - 1;
      pos[k] = t > 0 ? { ...pos[k], ttl: t } : null;
    }
    if (pos.fog && !pos.fog.untilNextTrigger) {
      const t = pos.fog.ttl - 1;
      pos.fog = t > 0 ? { ...pos.fog, ttl: t } : null;
    }
  }

  function evReset(pos, seen) {
    pos.hm = 0;
    if (seen) {
      Object.keys(seen).forEach(k => delete seen[k]);
      seen[posKey(pos)] = 1;
    }
  }

  function chaosTick(G, chaosOn, clog) {
    const c = G.chaos;
    ageEffects(G.pos);
    if (!chaosOn) return null;
    c.meter--;
    if (c.meter === 1) {
      c.next = chaosPick(G);
      c.danger = computeDangerZones(G);
    } else if (c.meter !== 1) {
      c.danger = [];
    }
    if (c.meter > 0) return null;
    if (!legal(G.pos).length) return null;

    if (G.pos.fog && G.pos.fog.untilNextTrigger) {
      G.pos.fog = null;
    }

    const od = isOverdrive(G.pos);
    const targetInterval = od ? Math.min(3, CH.every) : CH.every;
    c.meter = targetInterval;
    c.max = targetInterval;
    c.overdrive = od;
    const list = [];
    const log = typeof clog === 'function' ? clog : () => {};

    for (let i = 0; i < CH.burst; i++) {
      if (!legal(G.pos).length) break;
      let ev = i ? null : c.next;
      if (!ev || !ev.on || !ev.canFire(G.pos)) ev = chaosPick(G);
      c.n++;
      c.next = null;
      if (!ev) {
        log('Ply ' + (G.hist ? G.hist.length : 0) + ': no event can fire, skipped');
        break;
      }
      c.last = ev.id;
      const rand = mulberry(c.seed + c.n * 977);
      let out, err;
      for (let t = 0; t < 8; t++) {
        out = ev.apply(G.pos, rand);
        err = validate(G.pos, out.p);
        if (!err) break;
      }
      if (err) {
        log('Ply ' + (G.hist ? G.hist.length : 0) + ': ' + ev.name + ' REJECTED (' + err + ')');
        list.push({ ev, rejected: err });
        continue;
      }
      const before = posKey(G.pos), prev = G.pos;
      G.pos = out.p;
      evReset(G.pos, G.seen);
      const k = posKey(G.pos);
      log('Ply ' + (G.hist ? G.hist.length : 0) + ': ' + ev.name + ' fired, validated OK');
      list.push({ ev, ...out, changed: before !== k, after: out.p, before: prev });
    }

    if (!list.length) return null;
    list.forEach(x => { x.multi = list.length > 1; });
    list[0].more = list.slice(1);
    return list[0];
  }

  const PRE = {
    mild: { every: 7, burst: 1, ev: ['quake', 'portal', 'frozen', 'swap', 'fog', 'mutate', 'bounty', 'phantom'] },
    wild: { every: 5, burst: 1, ev: ['quake', 'portal', 'frozen', 'swap', 'rush', 'fog', 'dtime', 'zap', 'mutate', 'mirror', 'reinforce', 'trade', 'coronate', 'blackhole', 'bounty', 'phantom', 'overcharge', 'necromancy', 'magma'] },
    mayhem: { every: 3, burst: 2, ev: EVENTS.map(e => e.id) }
  };

  const preObj = n => ({
    on: true,
    every: PRE[n].every,
    burst: PRE[n].burst,
    off: EVENTS.filter(e => !PRE[n].ev.includes(e.id)).map(e => e.id),
    int: n
  });

  return {
    mulberry,
    CH,
    clonePos,
    emptySqs,
    activeEmptySqs,
    pickOut,
    quakeCands,
    MV,
    mat,
    pieceList,
    swapPairs,
    rushT,
    rushApply,
    reshape,
    emptyRows,
    tideRows,
    meteorOpts,
    defOpts,
    fixCast,
    grav,
    coronate,
    tradeOpts,
    stamp,
    mirrorRows,
    nbOf,
    riftOf,
    validate,
    EVENTS,
    chaosPick,
    ageEffects,
    evReset,
    chaosTick,
    isOverdrive,
    computeDangerZones,
    PRE,
    preObj
  };
}));
