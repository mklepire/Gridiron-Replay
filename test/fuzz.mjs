// Stress test: random leagues in unusual formats, through the engine and the renderer.
// Run: node test/fuzz.mjs [count]
import fs from 'node:fs';
import { generateGame } from '../src/engine.js';
import { pairUp, engineInput, leagueScale } from '../src/sleeper.js';

// minimal browser stand-ins for the renderer
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
const ctx = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 20 }) : (k in t ? t[k] : () => {}), set: (t, k, v) => (t[k] = v, true) });
const { Player } = await import('../src/render.js');

const R = p => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const PLAYERS = R('data/players.json'), SCHED = R('data/schedule.json');
const byPos = {}; for (const [id, v] of Object.entries(PLAYERS)) (byPos[v[1]] ||= []).push(id);
let seed = +(process.env.SEED || 7); const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];

const FORMATS = {
  standard: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  superflex: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX'],
  twoQB: ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  noKdef: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX'],
  idp: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DL', 'DL', 'LB', 'LB', 'DB', 'DB', 'IDP_FLEX'],
  tiny: ['QB', 'RB', 'WR'],
  noQB: ['RB', 'WR', 'WR', 'TE', 'FLEX'],
  big: ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'DEF'],
};
const SLOT = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'] };
function lineup(slots, mode) {
  return slots.map(s => {
    if (mode === 'empty' && rnd() < .15) return '0';
    if (mode === 'unknown' && rnd() < .15) return String(900000 + Math.floor(rnd() * 1000));
    const pos = SLOT[s] ? pick(SLOT[s]) : s; return pick(byPos[pos] || byPos.WR);
  });
}
function points(mode) {
  if (mode === 'zero') return 0;
  if (mode === 'neg') return +(rnd() * 12 - 6).toFixed(2);
  if (mode === 'huge') return +(rnd() * 60).toFixed(2);
  return +(rnd() * 28 - 1).toFixed(2);
}
const N = +(process.argv[2] || 300);
let fails = 0; const seen = {};
const fail = (msg, info) => { fails++; if ((seen[msg] = (seen[msg] || 0) + 1) <= 3) console.log('FAIL', msg, info || ''); };
for (let n = 0; n < N; n++) {
  const fmt = pick(Object.keys(FORMATS)), slots = FORMATS[fmt];
  const lmode = pick(['normal', 'normal', 'empty', 'unknown']), pmode = pick(['normal', 'normal', 'zero', 'neg', 'huge']);
  const week = pick(['1', '3', '5', '6', '9', '14', '17', '99']); // 99 = no schedule (old season)
  const tie = rnd() < .08;
  const rows = [];
  for (let r = 1; r <= 4; r++) {
    const starters = lineup(slots, lmode), sp = starters.map(() => points(pmode));
    rows.push({ roster_id: r, matchup_id: Math.ceil(r / 2), starters, starters_points: sp, players: [...starters, ...lineup(['RB', 'WR', 'QB', 'TE'], 'normal')], players_points: {}, points: sp.reduce((a, b) => a + b, 0) });
  }
  if (tie) { rows[1].starters_points = rows[0].starters_points.slice(); rows[1].points = rows[0].points; }
  for (const r of rows) r.starters.forEach((id, i) => r.players_points[id] = r.starters_points[i]);
  rows[0].players.slice(-4).forEach(id => rows[0].players_points[id] = +(rnd() * 30).toFixed(1));
  const L = { league: { roster_positions: [...slots, 'BN', 'BN'] }, users: [{ user_id: 'u1', display_name: 'owner1', metadata: { team_name: pick(['A', '🔥 Emoji Squad 🔥', 'A very very long team name that keeps going and going', 'Team <script>', "O'Brien's"]) } }], rosters: [{ roster_id: 1, owner_id: 'u1' }] };
  const pairs = pairUp(L, rows, PLAYERS);
  const scale = pmode === 'zero' ? null : leagueScale([rows]);
  for (const m of pairs) {
    const info = `${fmt}/${lmode}/${pmode}/wk${week}${tie ? '/tie' : ''}`;
    let g;
    try { g = generateGame(engineInput('fuzz' + n, week, m, SCHED, {}, scale)); } catch (e) { fail('engine threw: ' + e.message, info); continue; }
    if (g.final.A !== g.target.A || g.final.B !== g.target.B) fail('final != target', info + JSON.stringify([g.final, g.target]));
    const fa = m.A.starters.reduce((a, p) => a + p.pts, 0), fb = m.B.starters.reduce((a, p) => a + p.pts, 0);
    if (Math.abs(fa - fb) > 1e-9 && (fa > fb) !== (g.final.A > g.final.B)) fail('winner flipped', info + ` ${fa} ${fb} ${JSON.stringify(g.final)}`);
    if (Math.abs(fa - fb) < 1e-9 && g.final.A !== g.final.B) fail('tie not tied', info);
    let prev = -1;
    for (const x of g.snaps) {
      if (/undefined|NaN|null|\[object/.test(x.text)) fail('bad text: ' + x.text, info);
      if (!Array.isArray(x.st)) fail('st not array', info + ' ' + x.kind);
      if (x.down != null && typeof x.down !== 'number') fail('bad down', info + ' ' + x.kind);
      if (!(x.gc >= prev - 0.5)) fail('clock went backwards', info + ` ${prev} -> ${x.gc} ${x.kind}`);
      prev = x.gc;
      if (isNaN(x.s0) || isNaN(x.s1)) fail('NaN spot', info + ' ' + x.kind);
    }
    for (const k of ['half', 'final']) if (!g.snaps.some(x => x.kind === k)) fail('missing ' + k, info);
    if (!g.highlights.length) fail('no highlights', info);
    if (g.highlights.some(i => i < 0 || i >= g.snaps.length)) fail('highlight out of range', info);
    for (const i of Object.keys(g.calls)) if (/undefined|NaN/.test(g.calls[i])) fail('bad call: ' + g.calls[i], info);
    try {
      const p = new Player({ getContext: () => ctx }, g, {});
      for (let i = 0; i < g.snaps.length; i++) { const sc = p.build(i); for (const t of [0, .3, .6, .95, 1]) { p.draw(sc, t, 1000); if (sc.ball) { const b = sc.ball(t); if (b.some(Number.isNaN)) fail('NaN ball', info + ' ' + g.snaps[i].kind); } } }
    } catch (e) { fail('renderer threw: ' + e.message, info); }
  }
}
console.log(fails ? `${fails} failures` : `all ${N} leagues passed`, Object.keys(seen).length ? seen : '');
process.exit(fails ? 1 : 0);
