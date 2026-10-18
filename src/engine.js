// Gridiron Replay game engine: turns one fantasy matchup into an original football game.
//
// What is guaranteed:
//   1. Final score is league-relative: a league-average fantasy score (season to date) becomes NFL_AVG
//      points, and each standard deviation above or below moves it NFL_SD points. Fantasy winner always wins.
//   2. Touches, yards and touchdowns go to starters in proportion to their fantasy points,
//      leaning on whoever was producing at that point in the week. Style (run vs catch,
//      yards per touch) comes from the player's real weekly line when we have it.
//   3. Timing: the NFL week's kickoff slots are laid across the 60-minute clock, and each
//      team's football score follows its fantasy total along that clock.
// Everything else (individual plays, downs, yardage) is invented, deterministically from a seed.

export const NFL_AVG = 23, NFL_SD = 10;
// fantasy total -> football points, given the league's season-to-date mean and standard deviation
export function footballScore(f, scale) {
  const mu = scale && scale.mu > 0 ? scale.mu : 110, sd = scale && scale.sd > 0 ? scale.sd : mu * .27;
  return Math.max(0, Math.round(NFL_AVG + (f - mu) / sd * NFL_SD));
}
const O = { A: 'B', B: 'A' };
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const GAME_LEN = 3600;
const GAME_REAL_MS = 3.2 * 3600e3; // a real NFL game, kickoff to final

// ---------- seeded randomness
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
function rngFrom(seed) {
  let a = hashStr(String(seed));
  const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.logn = (mu, sd) => { const u = 1 - r(), v = r(); return Math.exp(mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); };
  r.weighted = pairs => { const tot = pairs.reduce((s, p) => s + p[1], 0); let x = r() * tot; for (const [k, w] of pairs) { x -= w; if (x <= 0) return k; } return pairs[pairs.length - 1][0]; };
  return r;
}
const last = n => { const p = String(n).split(' '); return p.length > 1 && /^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(p[p.length - 1]) ? p[p.length - 2] : p[p.length - 1]; };
const pl = y => Math.abs(y) === 1 ? `${y} yd` : `${y} yds`;

// ---------- the week's clock: kickoff slots -> game minutes
export function buildClock(schedule) {
  const games = (schedule || []).map(([a, h, k]) => ({ a, h, t: Date.parse(k) })).filter(g => !isNaN(g.t)).sort((x, y) => x.t - y.t);
  const slots = [];
  for (const g of games) {
    const s = slots[slots.length - 1];
    if (s && g.t - s.start < 2.5 * 3600e3) { s.n++; s.end = Math.max(s.end, g.t + GAME_REAL_MS); }
    else slots.push({ start: g.t, end: g.t + GAME_REAL_MS, n: 1 });
  }
  if (!slots.length) return null;
  const wt = slots.map(s => Math.sqrt(s.n) + 0.5), tot = wt.reduce((a, b) => a + b, 0);
  let acc = 0;
  slots.forEach((s, i) => { s.g0 = acc; acc += GAME_LEN * wt[i] / tot; s.g1 = acc; s.label = slotLabel(s.start); });
  const kick = {}; for (const g of games) { kick[g.a] = g.t; kick[g.h] = g.t; }
  const toGc = t => {
    for (const s of slots) { if (t <= s.end) return t < s.start ? s.g0 : s.g0 + (s.g1 - s.g0) * (t - s.start) / (s.end - s.start); }
    return GAME_LEN;
  };
  const toReal = gc => { for (const s of slots) if (gc <= s.g1 + 1e-9) return s.start + (s.end - s.start) * Math.max(0, gc - s.g0) / (s.g1 - s.g0); return slots[slots.length - 1].end; };
  return { slots, kick, toGc, toReal };
}
function slotLabel(t) {
  const d = new Date(t); const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(d);
  const h = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d);
  if (day === 'Sun') return h < 12 ? 'Sunday morning' : h < 15 ? 'Sunday early' : h < 19 ? 'Sunday late' : 'Sunday night';
  return { Thu: 'Thursday night', Mon: 'Monday night', Sat: 'Saturday', Fri: 'Friday', Wed: 'Wednesday', Tue: 'Tuesday' }[day] || day;
}

// ---------- score pieces
function decompose(n) {
  let best = null;
  for (let td = 0; td <= Math.floor(n / 6); td++) for (let two = 0; two <= td; two++) for (let miss = 0; miss <= td - two; miss++) {
    const ptd = 7 * (td - two - miss) + 8 * two + 6 * miss; if (ptd > n) continue;
    for (let fg = 0; fg <= Math.floor((n - ptd) / 3); fg++) {
      const rem = n - ptd - 3 * fg; if (rem % 2) continue; const sf = rem / 2;
      const cost = Math.abs(td - n / 7.5) + .8 * Math.abs(fg - Math.max(1, n / 12)) + 2.5 * two + 3 * miss + 4 * sf;
      if (!best || cost < best.cost) best = { cost, td: td - two - miss, two, miss, fg, sf };
    }
  }
  return best || { td: 0, two: 0, miss: 0, fg: 0, sf: 0 };
}

// ---------- main
export function generateGame(input) {
  const { seed, schedule, styles = {} } = input;
  const rng = rngFrom(seed);
  const clock = buildClock(schedule) || { slots: [], kick: {}, toGc: () => 0, toReal: () => Date.now() };
  const T = {};
  for (const s of ['A', 'B']) {
    const src = input.teams[s];
    const ps = src.starters.map((p, i) => ({ ...p, i, pts: +p.pts || 0 }));
    const fant = ps.reduce((a, p) => a + p.pts, 0);
    const qbs = ps.filter(p => p.pos === 'QB').sort((a, b) => b.pts - a.pts);
    const qb = qbs[0] || null;
    const skill = ps.filter(p => SKILL.has(p.pos) && p !== qb);
    const kicker = ps.filter(p => p.pos === 'K').sort((a, b) => b.pts - a.pts)[0] || null;
    const defs = ps.filter(p => p.pos === 'DEF' || ['DL', 'LB', 'DB', 'IDP'].includes(p.pos));
    // accrual window per player, in game seconds
    for (const p of ps) {
      const k = clock.kick[p.team];
      if (k != null) { p.g0 = clock.toGc(k); p.g1 = clock.toGc(k + GAME_REAL_MS); if (p.g1 - p.g0 < 30) p.g1 = p.g0 + 30; }
      else { p.g0 = 0; p.g1 = GAME_LEN; }
    }
    T[s] = { ...src, ps, fant, qb, skill, kicker, defs, abbr: abbrev(src.name) };
  }
  const accrued = (p, gc) => p.pts * Math.max(0, Math.min(1, (gc - p.g0) / (p.g1 - p.g0)));
  const fantAt = (s, gc) => T[s].ps.reduce((a, p) => a + accrued(p, gc), 0);
  const localPts = (p, gc, back = 480, fwd = 240) => Math.max(0, accrued(p, gc + fwd) - accrued(p, gc - back));

  // final score
  const target = { A: footballScore(T.A.fant, input.scale), B: footballScore(T.B.fant, input.scale) };
  const W = T.A.fant === T.B.fant ? null : (T.A.fant > T.B.fant ? 'A' : 'B');
  if (W && target[W] <= target[O[W]]) target[W] = target[O[W]] + 1;
  if (!W) target.B = target.A; // a true fantasy tie stays tied
  const pieces = { A: decompose(target.A), B: decompose(target.B) };

  // when each score happens
  const GRID = []; for (let g = 0; g <= GAME_LEN; g += 6) GRID.push(g);
  const curve = {};
  for (const s of ['A', 'B']) { const k = T[s].fant > 0 ? target[s] / T[s].fant : 0; curve[s] = GRID.map(g => fantAt(s, g) * k); }
  const cross = (s, level) => { for (let j = 0; j < GRID.length; j++) if (curve[s][j] >= level) return GRID[j]; return GAME_LEN; };
  const VAL = { td: 7, two: 8, miss: 6, fg: 3, sf: 2 };
  let sched = [];
  for (const s of ['A', 'B']) {
    const units = []; for (const k of ['td', 'two', 'miss', 'fg', 'sf']) for (let j = 0; j < pieces[s][k]; j++) units.push(k);
    let c = 0;
    while (units.length) {
      const big = units.filter(u => u === 'td' || u === 'two' || u === 'miss'), small = units.filter(u => u === 'fg' || u === 'sf');
      const tBig = big.length ? cross(s, c + .55 * 7) : 1e9, tSmall = small.length ? cross(s, c + .55 * 3) : 1e9;
      const u = (small.length && (!big.length || tBig - tSmall > 330)) ? small[0] : (big.includes('td') ? 'td' : big[0]);
      units.splice(units.indexOf(u), 1);
      sched.push({ team: s, unit: u, gc: Math.min(cross(s, c + .55 * VAL[u]), 3570) });
      c += VAL[u];
    }
  }
  sched.sort((a, b) => a.gc - b.gc);
  for (const x of sched) { if (x.gc < 150) x.gc = 150; if (x.gc > 1800 && x.gc < 1950) x.gc = 1950; }
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let j = 1; j < sched.length; j++) { const a = sched[j - 1], b = sched[j], gap = a.team === b.team ? 240 : 150; if (b.gc - a.gc < gap) { b.gc = Math.min(3585, a.gc + gap); moved = true; } }
    if (!moved) break;
  }
  for (let j = sched.length - 2; j >= 0; j--) if (sched[j + 1].gc - sched[j].gc < 150) sched[j].gc = Math.max(20, sched[j + 1].gc - 150);
  sched.sort((a, b) => a.gc - b.gc);

  // possessions
  const bounds = sched.map(x => ({ gc: x.gc, score: x }));
  bounds.push({ gc: 1800, half: true }, { gc: GAME_LEN, final: true });
  bounds.sort((a, b) => a.gc - b.gc || (a.score ? -1 : 1));
  const first = rng() < .5 ? 'A' : 'B';
  let poss = first, t0 = 0; const drives = [];
  for (const b of bounds) {
    const dur = Math.max(30, b.gc - t0), X = b.score ? b.score.team : null;
    let n = Math.max(1, Math.round(dur / 235));
    if (X && ((n % 2 === 1) !== (poss === X))) n++;
    const w = Array(n).fill(1); if (X) w[n - 1] = 1.5; const ws = w.reduce((a, c) => a + c, 0);
    let ts = t0, who = poss;
    for (let j = 0; j < n; j++) {
      const dd = dur * w[j] / ws;
      drives.push({ team: who, start: ts, end: ts + dd, score: X && j === n - 1 ? b.score : null, half: !!(b.half && j === n - 1), final: !!(b.final && j === n - 1) });
      ts += dd; who = O[who];
    }
    t0 = b.gc;
    poss = b.half ? O[first] : X ? O[X] : O[drives[drives.length - 1].team];
  }
  // defense: sacks and takeaways scale with D/ST points
  for (const s of ['A', 'B']) {
    const dp = T[s].defs.reduce((a, p) => a + p.pts, 0);
    const takeaways = Math.max(0, Math.min(3, Math.round((dp - 3) / 5))), sacks = Math.max(0, Math.min(5, Math.round(dp / 3.5)));
    const empties = drives.filter(d => d.team === O[s] && !d.score && !d.final && !d.half).sort(() => rng() - .5);
    for (let k = 0; k < takeaways && k < empties.length; k++) empties[k].to = [rng() < .55 ? 'int' : 'fum', s];
    const all = drives.filter(d => d.team === O[s] && !d.final);
    for (let k = 0; k < sacks && all.length; k++) (all[(k * 3 + 1) % all.length].sacks ||= []).push(s);
  }

  // player usage
  const NOW = { gc: 0 };
  const style = p => {
    const r = styles[p.id];
    if (r && (r[0] + r[2] + r[4]) > 0) return { car: r[0], ry: r[1], rec: r[2], rey: r[3] };
    return { RB: { car: 14, ry: 60, rec: 3, rey: 20 }, WR: { car: .3, ry: 2, rec: 5, rey: 65 }, TE: { car: 0, ry: 0, rec: 4, rey: 40 }, QB: { car: 4, ry: 18, rec: 0, rey: 0 } }[p.pos] || { car: 2, ry: 8, rec: 2, rey: 20 };
  };
  const weights = (s, kind) => T[s].skill.map(p => {
    const st = style(p), base = (.45 * p.pts + .55 * 4 * localPts(p, NOW.gc));
    let share = kind === 'run' ? (st.car + .5) / (st.car + st.rec + 1) : (st.rec + .5) / (st.car + st.rec + 1);
    if (kind === 'run' && st.car < .5 && p.pos !== 'QB') share = 0;
    if (kind === 'pass' && st.rec < .5) share = .02;
    return [p, (Math.pow(Math.max(0, base), 1.35) + .6) * share];
  }).filter(x => x[1] > 0);
  const passRate = {};
  for (const s of ['A', 'B']) {
    const r = weights(s, 'run').reduce((a, x) => a + x[1], 0), c = weights(s, 'pass').reduce((a, x) => a + x[1], 0);
    passRate[s] = T[s].qb ? Math.min(.65, Math.max(.42, c / ((r + c) || 1))) : .2;
  }
  const gain = (p, kind) => {
    const st = style(p); const n = kind === 'run' ? st.car : st.rec, y = kind === 'run' ? st.ry : st.rey;
    let avg = n > 0 ? y / n : (kind === 'run' ? 4 : 9); avg = Math.max(1.5, Math.min(18, avg)) * (.8 + .4 * Math.min(1.5, p.pts / 15));
    let g = rng.logn(Math.log(Math.max(1, avg)) - .18, .6);
    if (kind === 'run' && rng() < .15) g = rng.pick([-2, -1, 0, 1]);
    return Math.max(-3, Math.min(65, Math.round(g)));
  };
  // touchdowns: shares by fantasy points, handed out by who was hot at that moment
  const alloc = {};
  for (const s of ['A', 'B']) {
    const n = pieces[s].td + pieces[s].two + pieces[s].miss, cands = T[s].skill.length ? T[s].skill : (T[s].qb ? [T[s].qb] : []);
    const w = cands.map(p => Math.pow(Math.max(.1, p.pts), 1.3)), tot = w.reduce((a, b) => a + b, 0) || 1;
    const raw = w.map(x => n * x / tot), a = raw.map(Math.floor);
    raw.map((x, j) => [x - a[j], j]).sort((x, y) => y[0] - x[0]).slice(0, n - a.reduce((x, y) => x + y, 0)).forEach(([, j]) => a[j]++);
    alloc[s] = []; cands.forEach((p, j) => { for (let k = 0; k < a[j]; k++) alloc[s].push(p); });
  }
  const tdScorer = s => {
    if (!alloc[s].length) return T[s].skill.slice().sort((a, b) => b.pts - a.pts)[0] || T[s].qb;
    const uniq = [...new Set(alloc[s])];
    const p = uniq.sort((a, b) => (localPts(b, NOW.gc, 900, 300) + .05 * b.pts) - (localPts(a, NOW.gc, 900, 300) + .05 * a.pts))[0];
    alloc[s].splice(alloc[s].indexOf(p), 1); return p;
  };
  const QBN = s => T[s].qb ? last(T[s].qb.name) : 'The quarterback';
  const KN = s => T[s].kicker ? last(T[s].kicker.name) : 'The kicker';
  const DN = s => T[s].defs[0] ? (T[s].defs[0].pos === 'DEF' ? `${T[s].defs[0].team || T[s].defs[0].name} D/ST` : last(T[s].defs[0].name)) : `${T[s].abbr} defense`;

  // ---------- snaps
  const snaps = [], score = { A: 0, B: 0 };
  const clk = gc => { gc = Math.min(gc, 3599.9); const q = Math.floor(gc / 900) + 1, rem = 900 - (gc - (q - 1) * 900); return [q, `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}`]; };
  const ppAt = gc => ({ A: T.A.ps.map(p => +accrued(p, gc).toFixed(1)), B: T.B.ps.map(p => +accrued(p, gc).toFixed(1)) });
  const push = (gc, off, kind, text, s0, s1, down = null, togo = null, st = [], big = false, who = null) => {
    const [q, c] = clk(gc);
    snaps.push({ gc: +gc.toFixed(1), q, clk: c, off, kind, text, s0: +s0.toFixed(1), s1: +s1.toFixed(1), down, togo, sc: { ...score },
      fa: +fantAt('A', gc).toFixed(2), fb: +fantAt('B', gc).toFixed(2), real: clock.toReal(gc), st, big, who });
  };
  let spotNext = 25, kickNext = true;
  drives.forEach((d, di) => {
    const s = d.team, dur = d.end - d.start; NOW.gc = (d.start + d.end) / 2;
    let spot;
    if (di === 0 || kickNext || Math.abs(d.start - 1800) < 1) { push(d.start, s, 'kickoff', `${KN(O[s])} kicks off. Touchback, ${T[s].name} ball at the 25.`, 25, 25, 1, 10); spot = 25; }
    else spot = spotNext;
    const unit = d.score ? d.score.unit : null;
    const scoring = unit === 'td' || unit === 'two' || unit === 'miss';
    const goal = scoring ? 100 : unit === 'fg' ? (spot < 76 ? Math.max(spot + 4, rng.int(64, 80)) : spot + 3) : null;
    const plays = []; let down = 1, togo = 10, np = 0;
    const sacks = [...(d.sacks || [])], to = d.to, maxPlays = unit ? 40 : rng.int(3, 6), toAt = rng.int(1, 3);
    while (unit !== 'sf') {
      if (goal != null && spot >= goal) break;
      if (goal == null && (down === 4 || (np >= maxPlays && down >= 3))) break;
      if (to && np >= toAt) break;
      np++;
      NOW.gc = d.start + dur * np / (np + 3);
      if (sacks.length && np >= 2 && rng() < .5 && T[s].qb) {
        const by = sacks.pop(), y = -rng.int(4, 9); plays.push({ s0: spot, down, togo, kind: 'sack', y, by }); spot += y; down = Math.min(4, down + 1); togo -= y; continue;
      }
      let kind = rng() < passRate[s] ? 'pass' : 'run';
      if (!T[s].qb) kind = 'run';
      if (kind === 'pass' && rng() < (goal != null ? .24 : .4)) { plays.push({ s0: spot, down, togo, kind: 'inc', y: 0 }); down++; continue; }
      const ws = weights(s, kind); if (!ws.length) { plays.push({ s0: spot, down, togo, kind: 'inc', y: 0 }); down++; continue; }
      const p = rng.weighted(ws); let y = gain(p, kind);
      if (goal != null) {
        const room = goal - spot;
        if (y >= room) y = room;
        if (down >= 3 && y < togo && y < room) y = Math.min(room, togo + rng.int(0, 4));
      } else {
        y = Math.min(y, Math.max(0, 72 - spot));
        if (down >= 3 && y >= togo && rng() < .65) y = Math.max(0, togo - rng.int(1, 3));
      }
      plays.push({ s0: spot, down, togo, kind, p, y }); spot += y;
      if (y >= togo) { down = 1; togo = Math.min(10, 100 - spot); } else { down = Math.min(4, down + 1); togo -= y; }
      if (np > 30) break;
    }
    const n = plays.length + 2;
    plays.forEach((pl_, j) => {
      const gc = d.start + dur * (j + 1) / n; NOW.gc = gc;
      const goalToGo = pl_.s0 + pl_.togo >= 100, tg = goalToGo ? null : pl_.togo;
      const lastTd = scoring && j === plays.length - 1;
      if (pl_.kind === 'sack') return push(gc, s, 'sack', `${QBN(s)} sacked by the ${DN(pl_.by)}, loss of ${-pl_.y}`, pl_.s0, pl_.s0 + pl_.y, pl_.down, tg, [[pl_.by, 'def', 'sack', 0, 0]]);
      if (pl_.kind === 'inc') return push(gc, s, 'play', rng.pick([`${QBN(s)} pass incomplete`, `${QBN(s)} pass broken up`, `${QBN(s)} throws it away`]), pl_.s0, pl_.s0, pl_.down, tg, T[s].qb ? [[s, T[s].qb.i, 'inc', 0, 0]] : []);
      let p = pl_.p, kind = pl_.kind;
      if (lastTd) { p = tdScorer(s); const st = style(p); kind = p === T[s].qb ? 'run' : (st.car > st.rec * 1.2 && rng() < .75) ? 'run' : (st.car < .5 ? 'pass' : (rng() < .5 ? 'run' : 'pass')); if (!T[s].qb) kind = 'run'; }
      const nm = last(p.name); let txt, st;
      if (kind === 'run') { txt = p === T[s].qb ? `${QBN(s)} scrambles for ${pl(pl_.y)}` : `${nm} runs for ${pl(pl_.y)}`; st = [[s, p.i, 'rush', pl_.y, +lastTd]]; }
      else { txt = `${QBN(s)} to ${nm}, ${pl(pl_.y)}`; st = [[s, T[s].qb.i, 'pass', pl_.y, +lastTd], [s, p.i, 'rec', pl_.y, +lastTd]]; }
      if (lastTd) txt += ' — TOUCHDOWN';
      push(gc, s, lastTd ? 'td' : 'play', txt, pl_.s0, Math.min(100, pl_.s0 + pl_.y), pl_.down, tg, st, lastTd || pl_.y >= 20, p.i);
    });
    const endgc = d.end - 2, lg = snaps.length ? snaps[snaps.length - 1].gc : 0;
    if (scoring) {
      score[s] += 6; push(lg, s, 'td_score', `Touchdown, ${T[s].name}!`, 100, 100);
      if (unit === 'two') { NOW.gc = lg; const p = tdScorer(s) || T[s].skill[0]; score[s] += 2; push(lg, s, 'two', `Two-point try: ${QBN(s)} to ${last(p.name)} — GOOD`, 98, 100, null, null, [], false, p.i); }
      else if (unit === 'miss') push(lg, s, 'pat', `${KN(s)} extra point is NO GOOD`, 98, 98, null, null, T[s].kicker ? [[s, T[s].kicker.i, 'xpmiss', 0, 0]] : []);
      else { score[s] += 1; push(lg, s, 'pat', `${KN(s)} extra point is good`, 98, 98, null, null, T[s].kicker ? [[s, T[s].kicker.i, 'xp', 0, 0]] : []); }
      kickNext = true;
    } else if (unit === 'fg') {
      const dist = 100 - spot + 17; score[s] += 3;
      push(endgc, s, 'fg', `${KN(s)} ${dist}-yard field goal is GOOD`, spot, spot, null, null, T[s].kicker ? [[s, T[s].kicker.i, 'fg', dist, 0]] : [], true); kickNext = true;
    } else if (unit === 'sf') {
      score[s] += 2; const v = O[s];
      push(endgc, v, 'sack', `${QBN(v)} sacked in the end zone by the ${DN(s)} — SAFETY`, 3, -1, 3, 10, [[s, 'def', 'sack', 0, 0]], true); kickNext = true;
    } else if (d.final) {
      const lead = score[s] - score[O[s]];
      if (lead > 0) push(endgc, s, 'play', `${QBN(s)} takes a knee`, spot, spot);
      else push(endgc, s, 'play', `${QBN(s)} heaves it deep… incomplete`, spot, spot, down, togo, [], true);
      kickNext = false;
    } else if (d.half) { push(endgc, s, 'play', `${QBN(s)} takes a knee`, spot, spot); kickNext = true; }
    else if (to) {
      const [k, by] = to;
      push(endgc, s, 'turnover', k === 'int' ? `${QBN(s)} intercepted by the ${DN(by)}!` : `Fumble! Recovered by the ${DN(by)}`, spot, spot, down, togo, [[by, 'def', k, 0, 0]], true);
      spotNext = Math.max(5, 100 - spot); kickNext = false;
    } else {
      const lg2 = snaps[snaps.length - 1].gc, k = 4 - down;
      for (let j = 0; j < Math.max(0, k); j++) { push(lg2 + (endgc - lg2) * (j + 1) / (k + 1), s, 'play', rng.pick([`${QBN(s)} pass incomplete`, `${QBN(s)} pass broken up`]), spot, spot, down, togo, T[s].qb ? [[s, T[s].qb.i, 'inc', 0, 0]] : []); down++; }
      const net = rng.int(38, 49), land = spot + net;
      if (land >= 92) { push(endgc, s, 'punt', `Punt, ${100 - spot} yards into the end zone. Touchback.`, spot, 100, 4, togo); spotNext = 20; }
      else { push(endgc, s, 'punt', `Punt, ${net} yards. Fair catch.`, spot, land, 4, togo); spotNext = 100 - land; }
      kickNext = false;
    }
  });
  const hs = snaps.findIndex(x => x.gc >= 1800);
  if (hs > 0) { const h = snaps[hs - 1]; snaps.splice(hs, 0, { gc: 1800, q: 2, clk: '0:00', off: null, kind: 'half', text: 'Halftime', s0: 50, s1: 50, down: null, togo: null, sc: { ...h.sc }, fa: +fantAt('A', 1800).toFixed(2), fb: +fantAt('B', 1800).toFixed(2), real: clock.toReal(1800), st: [], big: false }); }
  snaps.push({ gc: GAME_LEN, q: 4, clk: '0:00', off: null, kind: 'final', text: 'FINAL', s0: 50, s1: 50, down: null, togo: null, sc: { ...score }, fa: +T.A.fant.toFixed(2), fb: +T.B.fant.toFixed(2), real: clock.toReal(GAME_LEN), st: [], big: true });
  for (const x of snaps) x.pp = ppAt(x.gc);

  const story = storylines(T, input, curve, GRID, W, fantAt, clock);
  const highlights = cutHighlights(snaps);
  const calls = commentary(snaps, T, story, rng);
  return {
    target, final: score, winner: W, story, highlights, calls,
    slots: clock.slots.map(s => ({ label: s.label, g0: s.g0, g1: s.g1 })),
    teams: { A: teamOut(T.A), B: teamOut(T.B) }, snaps,
  };
}
function abbrev(name) { const w = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return (w.length > 1 ? w.slice(0, 3).map(x => x[0]).join('') : (w[0] || 'TM').slice(0, 3)).toUpperCase(); }
function teamOut(t) { return { name: t.name, owner: t.owner, avatar: t.avatar || null, fant: +t.fant.toFixed(2), abbr: t.abbr, players: t.ps.map(p => ({ id: p.id, name: p.name, pos: p.pos, team: p.team, num: p.num || '', pts: p.pts, slot: p.slot || p.pos })), bench: (t.bench || []).map(p => ({ name: p.name, pos: p.pos, pts: p.pts })) }; }

// ---------- what was this matchup about?
function storylines(T, input, curve, GRID, W, fantAt, clock) {
  const out = [];
  const all = ['A', 'B'].flatMap(s => T[s].ps.map(p => ({ ...p, s })));
  const mvp = all.slice().sort((a, b) => b.pts - a.pts)[0];
  if (mvp && mvp.pts > 0) out.push({ type: 'mvp', team: mvp.s, player: mvp.name, pts: mvp.pts, text: `${mvp.name} led everyone with ${mvp.pts.toFixed(1)}.` });
  // comeback: biggest fantasy deficit the winner overcame
  // comeback: winner trailed by at least half a league standard deviation once the Sunday early games were over
  if (W) {
    const early = (clock.slots || []).find(s => s.label === 'Sunday early');
    const from = early ? early.g1 : GAME_LEN / 2;
    const sc = input.scale, sd = sc && sc.sd > 0 ? sc.sd : (sc && sc.mu > 0 ? sc.mu : 110) * .27;
    let worst = 0, at = 0;
    for (let g = from; g <= GAME_LEN; g += 30) { const d = fantAt(O[W], g) - fantAt(W, g); if (d > worst) { worst = d; at = g; } }
    if (worst >= sd / 2) out.push({ type: 'comeback', team: W, deficit: +worst.toFixed(1), gc: at, text: `${T[W].name} came back from ${worst.toFixed(1)} down after Sunday's early games.` });
  }
  const m = Math.abs(T.A.fant - T.B.fant);
  const sc2 = input.scale, lsd = sc2 && sc2.sd > 0 ? sc2.sd : (sc2 && sc2.mu > 0 ? sc2.mu : 110) * .27;
  // nail-biter: final margin under 0.2 league SD; blowout: over 1.5 league SD
  if (W && m < .2 * lsd) out.push({ type: 'close', margin: +m.toFixed(2), text: `Decided by ${m.toFixed(2)} points.` });
  if (W && m > 1.5 * lsd) out.push({ type: 'blowout', team: W, margin: +m.toFixed(1), text: `${T[W].name} won by ${m.toFixed(1)}.` });
  for (const s of ['A', 'B']) {
    const dud = T[s].ps.filter(p => SKILL.has(p.pos)).sort((a, b) => a.pts - b.pts)[0];
    if (dud && dud.pts < 5) out.push({ type: 'dud', team: s, player: dud.name, pts: dud.pts, text: `${dud.name} managed ${dud.pts.toFixed(1)}.` });
    const bench = (T[s].bench || []).filter(b => b.pts > 0).sort((a, b) => b.pts - a.pts);
    for (const b of bench) {
      const swap = T[s].ps.filter(p => p.pos === b.pos || (['RB', 'WR', 'TE'].includes(b.pos) && /FLEX/.test(p.slot || '') && ['RB', 'WR', 'TE'].includes(p.pos))).sort((x, y) => x.pts - y.pts)[0];
      if (swap && b.pts - swap.pts >= 5) {
        const flips = W && s !== W && (b.pts - swap.pts) > m;
        out.push({ type: 'bench', team: s, player: b.name, pts: b.pts, over: swap.name, overPts: swap.pts, flips, text: `${b.name} scored ${b.pts.toFixed(1)} on the bench${flips ? ' — enough to win it' : ''}.` });
        break;
      }
    }
  }
  return out;
}

// ---------- highlight cut: each scoring drive's last plays, every turnover, halftime and the final
function cutHighlights(snaps) {
  const keep = new Set([0]);
  snaps.forEach((x, i) => {
    if (x.kind === 'td' || x.kind === 'fg') {
      if (i > 0 && snaps[i - 1].kind === 'play' && snaps[i - 1].big) keep.add(i - 1);
      keep.add(i);
      for (let j = i + 1; j < Math.min(snaps.length, i + 3); j++) if (['td_score', 'two'].includes(snaps[j].kind) || (snaps[j].kind === 'pat' && /NO GOOD/.test(snaps[j].text))) keep.add(j);
    }
    if (['turnover', 'half', 'final'].includes(x.kind) || (x.kind === 'sack' && /SAFETY/.test(x.text))) keep.add(i);
  });
  return [...keep].sort((a, b) => a - b);
}

// ---------- broadcast lines
function commentary(snaps, T, story, rng) {
  const mvp = story.find(x => x.type === 'mvp'), bench = story.filter(x => x.type === 'bench'), dud = story.filter(x => x.type === 'dud'), cb = story.find(x => x.type === 'comeback');
  const calls = {};
  const lead = (sc) => sc.A === sc.B ? null : sc.A > sc.B ? 'A' : 'B';
  let prevLead = null, mvpTDs = 0;
  snaps.forEach((x, i) => {
    const s = x.off, nm = s && x.who != null ? T[s].ps[x.who]?.name : null;
    let line = null;
    if (x.kind === 'td') {
      const isMvp = mvp && nm === mvp.player;
      if (isMvp) mvpTDs++;
      line = isMvp ? rng.pick([`${last(nm)} again! ${mvp.pts.toFixed(1)}-point days look like this.`, `You can't cover ${last(nm)} today.`, `${last(nm)} is putting this team on his back.`])
        : rng.pick([`${last(nm)} finds the end zone!`, `Six for ${T[s].name}!`, `${last(nm)} takes it in!`, `Touchdown ${T[s].name}, and ${last(nm)} gets the credit.`]);
    } else if (x.kind === 'pat' || x.kind === 'two' || x.kind === 'fg') {
      const L = lead(x.sc);
      if (L && L !== prevLead && prevLead) line = `And that's a lead change. ${T[L].name} in front, ${Math.max(x.sc.A, x.sc.B)}–${Math.min(x.sc.A, x.sc.B)}.`;
      else if (!L) line = `All square at ${x.sc.A}.`;
      if (x.kind === 'fg' && !line) line = rng.pick([`${T[s].name} settle for three.`, `Points are points. ${T[s].name} take the field goal.`]);
      prevLead = L || prevLead;
    } else if (x.kind === 'turnover') {
      line = rng.pick([`Big defensive play! That changes the field.`, `Turnover! The ${x.text.split('the ').pop().replace('!', '')} come up big.`]);
      const d = dud.find(y => y.team === s);
      if (d && rng() < .6) line += ` Rough day for this offense — ${last(d.player)} has ${d.pts.toFixed(1)} to show for it.`;
    } else if (x.kind === 'half') {
      line = `Halftime: ${T.A.name} ${x.sc.A}, ${T.B.name} ${x.sc.B}. In the real world, that's through ${new Date(x.real).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}.`;
    } else if (x.kind === 'final') {
      const L = lead(x.sc);
      line = L ? `Final: ${T[L].name} ${Math.max(x.sc.A, x.sc.B)}, ${T[O[L]].name} ${Math.min(x.sc.A, x.sc.B)}.` : `It ends tied at ${x.sc.A}.`;
      if (cb && cb.team === L) line += ` What a comeback — down ${cb.deficit} in fantasy after Sunday's early games.`;
      const b = bench.find(y => y.team !== L) || bench[0];
      if (b) line += ` And somewhere on the ${T[b.team].name} bench, ${b.player}'s ${b.pts.toFixed(1)} points watched the whole thing${b.flips ? '. That would have won it' : ''}.`;
    } else if (x.kind === 'kickoff' && i === 0) {
      line = `Welcome to Gridiron Replay! ${T.A.name} against ${T.B.name}. ${mvp ? `Keep an eye on ${mvp.player}.` : ''}`;
    }
    if (line) calls[i] = line;
  });
  return calls;
}
