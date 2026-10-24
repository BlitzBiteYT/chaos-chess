/**
 * Chaos Chess - Authoritative Chess Rules Engine
 * Reusable across client UI, serverless functions, and test suites.
 */
(function(root, factory) {
  const lib = factory();
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = lib;
  }
  if (root) {
    root.ChaosChessEngine = lib;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function() {
  const BASE = '<rect x="24" y="78" width="52" height="10" rx="5"/>';
  const PIECES = {
    p: '<circle cx="50" cy="30" r="11"/><path d="M39 78Q43 58 45 46H55Q57 58 61 78Z"/><rect x="36" y="44" width="28" height="7" rx="3.5"/>' + BASE,
    r: '<path d="M28 20H40V29H46V20H54V29H60V20H72V40H28Z"/><path d="M33 40H67L63 76H37Z"/>' + BASE,
    n: '<path d="M30 78C32 60 38 50 47 42C40 42 34 45 28 51C26 45 32 35 42 29L44 17L52 26C66 28 75 42 72 60C71 68 71 73 72 78Z"/><circle class="eye" cx="52" cy="37" r="3"/>' + BASE,
    b: '<circle cx="50" cy="17" r="5"/><path d="M50 22C62 30 64 44 58 52H42C36 44 38 30 50 22Z"/><path class="ln" d="M52 30L57 38"/><path d="M42 52H58Q57 66 62 78H38Q43 66 42 52Z"/><rect x="36" y="50" width="28" height="7" rx="3.5"/>' + BASE,
    q: '<path d="M28 80L20 32L38 50L50 22L62 50L80 32L72 80Z"/><circle cx="20" cy="28" r="5"/><circle cx="50" cy="17" r="5"/><circle cx="80" cy="28" r="5"/>' + BASE,
    k: '<path d="M46 6H54V14H62V22H54V32H46V22H38V14H46Z"/><path d="M32 80C27 58 36 36 50 36C64 36 73 58 68 80Z"/>' + BASE
  };
  const NAMES = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const FILES = 'abcdefgh';
  const FULL = START + ' w KQkq - 0 1';

  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ST = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const inb = (r, f, nr) => r >= 0 && r < nr && f >= 0 && f < 8;
  const isW = c => c && c === c.toUpperCase();

  function parseFen(fen) {
    return fen.split('/').map(row => {
      const out = [];
      for (const ch of row) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < +ch; i++) out.push(null);
        } else {
          out.push(ch);
        }
      }
      return out;
    });
  }

  function newPos(fen) {
    const a = fen.split(' ');
    return {
      b: parseFen(a[0]),
      turn: a[1] || 'w',
      cast: (a[2] && a[2] !== '-') ? a[2] : '',
      ep: (a[3] && a[3] !== '-') ? [8 - a[3][1], FILES.indexOf(a[3][0])] : null,
      hm: +(a[4] || 0),
      fm: +(a[5] || 1)
    };
  }

  function attacked(b, r, f, by) {
    const nr = b.length;
    const w = by === 'w';
    const at = (rr, ff, s) => {
      if (!inb(rr, ff, nr)) return false;
      const c = b[rr][ff];
      return !!c && isW(c) === w && s.includes(c.toLowerCase());
    };
    const pr = w ? r + 1 : r - 1;
    if (at(pr, f - 1, 'p') || at(pr, f + 1, 'p')) return true;
    for (const [d, e] of KN) if (at(r + d, f + e, 'n')) return true;
    for (const [d, e] of KG) if (at(r + d, f + e, 'k')) return true;
    for (const [ds, s] of [[ST, 'rq'], [DG, 'bq']]) {
      for (const [d, e] of ds) {
        let rr = r + d, ff = f + e;
        while (inb(rr, ff, nr)) {
          const c = b[rr][ff];
          if (c) {
            if (isW(c) === w && s.includes(c.toLowerCase())) return true;
            break;
          }
          rr += d;
          ff += e;
        }
      }
    }
    return false;
  }

  function pseudo(p) {
    const b = p.b, w = p.turn === 'w', out = [];
    const nr = b.length;
    for (let r = 0; r < nr; r++) {
      for (let f = 0; f < 8; f++) {
        const c = b[r][f];
        if (!c || isW(c) !== w) continue;
        const t = c.toLowerCase();
        const add = (tr, tf, x) => out.push({ r, f, tr, tf, ...x });
        const isOv = p.overcharged && ((w && p.overcharged.w && p.overcharged.w[0] === r && p.overcharged.w[1] === f) || (!w && p.overcharged.b && p.overcharged.b[0] === r && p.overcharged.b[1] === f));
        if (t === 'p') {
          const d = w ? -1 : 1, start = w ? nr - 2 : 1, last = w ? 0 : nr - 1;
          const push = (tr, tf, x) => {
            if (tr === last) {
              for (const q of 'qrbn') add(tr, tf, { ...x, promo: q });
            } else {
              add(tr, tf, x);
            }
          };
          if (!b[r + d][f]) {
            push(r + d, f, {});
            if (r === start && !b[r + 2 * d][f]) add(r + 2 * d, f, { dbl: 1 });
          }
          for (const e of [-1, 1]) {
            const tr = r + d, tf = f + e;
            if (!inb(tr, tf, nr)) continue;
            const x = b[tr][tf];
            if (x && isW(x) !== w) push(tr, tf, {});
            else if (!x && p.ep && p.ep[0] === tr && p.ep[1] === tf) add(tr, tf, { ep: 1 });
          }
        } else if (t === 'n' || t === 'k') {
          for (const [d, e] of (t === 'n' ? KN : KG)) {
            const tr = r + d, tf = f + e;
            if (!inb(tr, tf, nr)) continue;
            const x = b[tr][tf];
            if (!x || isW(x) !== w) add(tr, tf, {});
          }
          if (t === 'n' && isOv) {
            for (const [d, e] of KG) {
              const tr = r + d, tf = f + e;
              if (!inb(tr, tf, nr)) continue;
              const x = b[tr][tf];
              if (!x || isW(x) !== w) add(tr, tf, {});
            }
          }
          if (t === 'k') {
            const row = w ? nr - 1 : 0, opp = w ? 'b' : 'w';
            if (r === row && f === 4 && !attacked(b, row, 4, opp)) {
              if (p.cast.includes(w ? 'K' : 'k') && !b[row][5] && !b[row][6] && b[row][7] === (w ? 'R' : 'r') && !attacked(b, row, 5, opp) && !attacked(b, row, 6, opp)) {
                add(row, 6, { castle: 'k' });
              }
              if (p.cast.includes(w ? 'Q' : 'q') && !b[row][1] && !b[row][2] && !b[row][3] && b[row][0] === (w ? 'R' : 'r') && !attacked(b, row, 3, opp) && !attacked(b, row, 2, opp)) {
                add(row, 2, { castle: 'q' });
              }
            }
          }
        } else {
          const ds = t === 'r' ? ST : t === 'b' ? DG : ST.concat(DG);
          for (const [d, e] of ds) {
            let tr = r + d, tf = f + e;
            while (inb(tr, tf, nr)) {
              const x = b[tr][tf];
              if (!x) {
                add(tr, tf, {});
              } else {
                if (isW(x) !== w) add(tr, tf, {});
                break;
              }
              tr += d;
              tf += e;
            }
          }
          if (t === 'b' && isOv) {
            for (const [d, e] of ST) {
              const tr = r + d, tf = f + e;
              if (!inb(tr, tf, nr)) continue;
              const x = b[tr][tf];
              if (!x || isW(x) !== w) add(tr, tf, {});
            }
          }
        }
      }
    }
    const fzs = p.frozen && (p.frozen.sqs || (p.frozen.sq ? [p.frozen.sq] : []));
    let filtered = out;
    if (fzs && fzs.length) {
      filtered = filtered.filter(m => !fzs.some(s => m.tr === s[0] && m.tf === s[1]) && !(m.castle && fzs.some(s => m.r === s[0] && s[1] === (m.castle === 'k' ? 5 : 3))));
    }
    const mg = p.magma && p.magma.sqs;
    if (mg && mg.length) {
      filtered = filtered.filter(m => !mg.some(s => m.tr === s[0] && m.tf === s[1]));
    }
    const phSqs = p.phantom && (p.phantom.sqs || (p.phantom.sq ? [p.phantom.sq] : []));
    if (phSqs && phSqs.length) {
      filtered = filtered.filter(m => !phSqs.some(s => m.tr === s[0] && m.tf === s[1]));
    }
    return filtered;
  }

  function teleDest(p, m) {
    const o = p.portal;
    if (!o || m.castle || m.ep || m.promo) return null;
    let from;
    if (m.tr === o.a[0] && m.tf === o.a[1]) from = o.b;
    else if (m.tr === o.b[0] && m.tf === o.b[1]) from = o.a;
    else return null;
    return (p.b[m.tr][m.tf] || p.b[from[0]][from[1]]) ? null : from;
  }

  function findKing(b, w) {
    const k = w ? 'K' : 'k';
    for (let r = 0; r < b.length; r++) {
      for (let f = 0; f < 8; f++) {
        if (b[r][f] === k) return [r, f];
      }
    }
    return null;
  }

  function inCheck(p, w) {
    if (w === undefined) w = p.turn === 'w';
    const k = findKing(p.b, w);
    return !!k && attacked(p.b, k[0], k[1], w ? 'b' : 'w');
  }

  function make(p, m) {
    const b = p.b.map(r => r.slice());
    const c = b[m.r][m.f], w = isW(c), t = c.toLowerCase();
    const cap = b[m.tr][m.tf] || m.ep;
    b[m.tr][m.tf] = m.promo ? (w ? m.promo.toUpperCase() : m.promo) : c;
    b[m.r][m.f] = null;
    if (m.ep) b[m.r][m.tf] = null;
    if (m.castle === 'k') { b[m.r][5] = b[m.r][7]; b[m.r][7] = null; }
    if (m.castle === 'q') { b[m.r][3] = b[m.r][0]; b[m.r][0] = null; }
    let cast = p.cast;
    const strip = s => { cast = cast.split('').filter(x => !s.includes(x)).join(''); };
    if (t === 'k') strip(w ? 'KQ' : 'kq');
    for (const [sr, sf, ch] of [[b.length - 1, 0, 'Q'], [b.length - 1, 7, 'K'], [0, 0, 'q'], [0, 7, 'k']]) {
      if ((m.r === sr && m.f === sf) || (m.tr === sr && m.tf === sf)) strip(ch);
    }
    const td = teleDest(p, m);
    if (td) { b[td[0]][td[1]] = b[m.tr][m.tf]; b[m.tr][m.tf] = null; }
    const me = w ? 'w' : 'b';
    let turn = w ? 'b' : 'w', dt = p.dt || null;
    if (dt === me) {
      dt = null;
      const ok = findKing(b, !w);
      if (!(ok && attacked(b, ok[0], ok[1], me))) turn = me;
    }
    const dest = td || [m.tr, m.tf];
    const same = (s, r, f) => !!s && s[0] === r && s[1] === f;
    let bounty = p.bounty;
    if (bounty && bounty.sq) {
      const rk = m.castle ? [m.r, m.castle === 'k' ? 7 : 0, m.castle === 'k' ? 5 : 3] : null;
      if (same(bounty.sq, m.r, m.f)) {
        bounty = { ...bounty, sq: dest };
      } else if (rk && same(bounty.sq, rk[0], rk[1])) {
        bounty = { ...bounty, sq: [rk[0], rk[2]] };
      } else if (same(bounty.sq, m.tr, m.tf)) {
        const capRow = w ? b.length - 2 : 1;
        const pawnChar = w ? 'P' : 'p';
        for (let f = 0; f < 8; f++) {
          if (!b[capRow][f]) {
            b[capRow][f] = pawnChar;
            break;
          }
        }
        bounty = null;
      }
    }
    // Overcharge markers follow their piece; capturing the enemy's marked piece clears it
    let overcharged = p.overcharged;
    if (overcharged) {
      const mine = w ? 'w' : 'b', theirs = w ? 'b' : 'w', o = { ...overcharged };
      if (same(o[mine], m.r, m.f)) o[mine] = dest;
      if (same(o[theirs], m.tr, m.tf)) o[theirs] = null;
      overcharged = o;
    }
    return {
      b,
      turn,
      cast,
      ep: (m.dbl && !td && turn !== me) ? [(m.r + m.tr) / 2, m.f] : null,
      hm: (t === 'p' || cap) ? 0 : p.hm + 1,
      fm: p.fm + (w ? 0 : 1),
      portal: p.portal,
      frozen: p.frozen,
      fog: p.fog,
      dt,
      magma: p.magma,
      phantom: p.phantom,
      bounty,
      overcharged
    };
  }

  function legal(p) {
    const w = p.turn === 'w';
    return pseudo(p).filter(m => !inCheck(make(p, m), w));
  }

  function perft(p, d) {
    const ms = legal(p);
    if (d === 1) return ms.length;
    let n = 0;
    for (const m of ms) n += perft(make(p, m), d - 1);
    return n;
  }

  function posKey(p) {
    return p.b.map(r => r.map(c => c || '1').join('')).join('/') + p.turn + p.cast + (p.ep ? p.ep.join('') : '');
  }

  function insufficient(b) {
    const ps = [];
    for (let r = 0; r < b.length; r++) {
      for (let f = 0; f < 8; f++) {
        const c = b[r][f];
        if (c && c.toLowerCase() !== 'k') ps.push([c.toLowerCase(), (r + f) % 2]);
      }
    }
    if (!ps.length) return true;
    if (ps.length === 1 && 'bn'.includes(ps[0][0])) return true;
    return ps.every(x => x[0] === 'b' && x[1] === ps[0][1]);
  }

  function status(g, rescueFn) {
    const p = g.pos, chk = inCheck(p);
    if (!legal(p).length) {
      return chk ? { over: 1, text: (p.turn === 'w' ? 'Black' : 'White') + ' wins by checkmate' } : { over: 1, text: 'Draw by stalemate' };
    }
    const isRescued = typeof rescueFn === 'function' ? rescueFn() : false;
    if (insufficient(p.b) && !isRescued) return { over: 1, text: 'Draw: insufficient material' };
    if (g.seen && g.seen[posKey(p)] >= 3) return { over: 1, text: 'Draw: threefold repetition' };
    if (p.hm >= 100) return { over: 1, text: 'Draw: 50-move rule' };
    return { over: 0, text: (p.turn === 'w' ? 'White' : 'Black') + ' to move' + (chk ? ' (check)' : '') };
  }

  function san(p, m, ms) {
    if (m.castle) return m.castle === 'k' ? 'O-O' : 'O-O-O';
    const c = p.b[m.r][m.f], t = c.toLowerCase(), cap = p.b[m.tr][m.tf] || m.ep;
    const sq = (r, f) => FILES[f] + (p.b.length - r);
    let s = '';
    if (t === 'p') {
      if (cap) s += FILES[m.f] + 'x';
      s += sq(m.tr, m.tf);
      if (m.promo) s += '=' + m.promo.toUpperCase();
    } else {
      s += t.toUpperCase();
      const o = ms.filter(x => x !== m && p.b[x.r][x.f] === c && x.tr === m.tr && x.tf === m.tf);
      if (o.length) {
        if (!o.some(x => x.f === m.f)) s += FILES[m.f];
        else if (!o.some(x => x.r === m.r)) s += p.b.length - m.r;
        else s += sq(m.r, m.f);
      }
      if (cap) s += 'x';
      s += sq(m.tr, m.tf);
    }
    return s;
  }

  const TESTS = [
    ['Start position', FULL, [20, 400, 8902]],
    ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['Endgame (en passant, pins)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
    ['Promotions and castling', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['Check evasions', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]]
  ];

  return {
    BASE,
    PIECES,
    NAMES,
    START,
    FILES,
    FULL,
    KN,
    KG,
    DG,
    ST,
    inb,
    isW,
    parseFen,
    newPos,
    attacked,
    pseudo,
    teleDest,
    findKing,
    inCheck,
    make,
    legal,
    perft,
    posKey,
    insufficient,
    status,
    san,
    TESTS
  };
}));
