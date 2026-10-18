import { generateGame, DIV } from './engine.js';
import { Player, COLORS } from './render.js';
import { getState, getLeague, getMatchups, getStatic, pairUp, engineInput } from './sleeper.js';

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ord = n => ['', '1ST', '2ND', '3RD', '4TH'][n] || '';
const last = n => String(n).split(' ').slice(-1)[0];
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
let player = null;
let PLAYERS = null, SCHEDULE = null;
const styleCache = {};
async function base() {
  if (!PLAYERS) [PLAYERS, SCHEDULE] = await Promise.all([getStatic('/data/players.json'), getStatic('/data/schedule.json').catch(() => ({ weeks: {} }))]);
}
async function stylesFor(season, week) {
  if (String(season) !== String(SCHEDULE.season)) return {};
  if (!(week in styleCache)) styleCache[week] = await getStatic(`/data/styles/${week}.json`).catch(() => ({}));
  return styleCache[week];
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

// ---------- data loading (real league or the bundled demo)
async function loadLeague(id) {
  await base();
  if (id === 'demo') {
    const d = await getStatic('/data/demo.json'); Object.assign(PLAYERS, d.names || {});
    return { demo: true, L: { league: d.league, users: d.users, rosters: d.rosters }, weeks: Object.keys(d.matchups).map(Number), current: 5, matchups: async w => d.matchups[w] || [] };
  }
  const [L, state] = await Promise.all([getLeague(id), getState().catch(() => null)]);
  const season = L.league.season;
  let current = 17;
  if (state && String(state.season) === String(season)) {
    const w = state.week || 1;
    const games = (SCHEDULE.weeks || {})[w] || [];
    const lastKick = Math.max(0, ...games.map(g => Date.parse(g[2])));
    current = (games.length && Date.now() > lastKick + 3.5 * 3600e3) ? w : Math.max(1, w - 1);
    if (state.season_type === 'pre') current = 1;
  }
  const start = L.league.settings?.start_week || 1;
  const weeks = []; for (let w = start; w <= Math.max(start, current); w++) weeks.push(w);
  return { L, weeks, current, matchups: w => getMatchups(id, w) };
}
async function weekGames(id, ctx, week) {
  const rows = await ctx.matchups(week);
  const pairs = pairUp(ctx.L, rows, PLAYERS);
  const styles = await stylesFor(ctx.L.league.season, week);
  const sched = String(ctx.L.league.season) === String(SCHEDULE.season) ? SCHEDULE : { weeks: {} };
  return pairs.map(m => ({ m, g: generateGame(engineInput(id, week, m, sched, styles)) }));
}

// ---------- router
window.addEventListener('hashchange', route);
route();
async function route() {
  if (player) { player.destroy(); player = null; }
  const h = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (h[0] === 'demo') return location.replace('#/l/demo/w/5');
    if (h[0] === 'l' && h[1]) {
      const id = decodeURIComponent(h[1]), week = h[2] === 'w' ? +h[3] : null, mid = h[4] === 'm' ? +h[5] : null;
      if (mid != null && week) return watch(id, week, mid);
      return league(id, week);
    }
    home();
  } catch (e) { showError(e); }
}
function showError(e) {
  const nf = String(e && e.message) === 'not-found';
  app.innerHTML = `<section class="panel"><h2>${nf ? 'League not found' : 'Something went wrong'}</h2><p>${nf ? 'Check the league ID. It is the long number in your Sleeper league link.' : 'We could not reach Sleeper. Try again in a minute.'}</p><p style="margin-top:12px"><a class="btn" href="#/">Back</a></p></section>`;
}

// ---------- home
function home() {
  document.title = 'Pixel Bowl';
  const recent = store.get('recent', []);
  app.innerHTML = `
  <section class="hero">
    <h1>Your fantasy matchup,<br>played as an 8-bit football game.</h1>
    <p class="lede">Every Sleeper matchup becomes a 90-second highlight reel. The final score follows your fantasy score, your best players make the big plays, and comebacks happen when they really did.</p>
    <form class="join" id="join">
      <div><label for="lid">Sleeper league ID or link</label><input id="lid" inputmode="numeric" autocomplete="off" placeholder="e.g. 1397412708831252480"></div>
      <button class="go" type="submit">Watch my league</button>
    </form>
    <p class="err" id="jerr" hidden></p>
    <p class="muted">No login. Find the ID in the Sleeper app under League → Settings, or copy your league's link from sleeper.com. <a href="#/demo">Or watch a demo league →</a></p>
    ${recent.length ? `<div><label>Your leagues</label><div class="recent">${recent.map(r => `<a class="btn" href="#/l/${esc(r.id)}">${esc(r.name)}</a>`).join('')}</div></div>` : ''}
  </section>
  <section class="how">
    <div class="panel"><span class="n">1 · THE SCORE</span><p>Fantasy points ÷ ${DIV} becomes the final score. 159.7 to 136.7 plays out as 32–27.</p></div>
    <div class="panel"><span class="n">2 · THE STARS</span><p>Touches, yards and touchdowns go to your starters by fantasy points. A 30-point day gets the ball.</p></div>
    <div class="panel"><span class="n">3 · THE TIMING</span><p>Thursday night opens the game and Monday night closes it. If you were down after Sunday's games, you're down in the 3rd quarter.</p></div>
  </section>`;
  document.getElementById('join').onsubmit = e => {
    e.preventDefault();
    const v = document.getElementById('lid').value.trim(), m = v.match(/\d{15,22}/);
    const err = document.getElementById('jerr');
    if (!m) { err.hidden = false; err.textContent = 'That doesn’t look like a Sleeper league ID. It’s a long number, like 1397412708831252480.'; return; }
    location.hash = `#/l/${m[0]}`;
  };
}

// ---------- league / week
function tagsFor(g) {
  const t = [];
  for (const s of g.story) {
    if (s.type === 'comeback') t.push(['Comeback', true]);
    if (s.type === 'close') t.push(['Nail-biter', true]);
    if (s.type === 'blowout') t.push(['Blowout', false]);
    if (s.type === 'bench' && s.flips) t.push(['Bench cost it', true]);
  }
  const mvp = g.story.find(s => s.type === 'mvp'); if (mvp) t.push([`MVP ${last(mvp.player)}`, false]);
  return t;
}
function gotw(list) { // most watchable matchup
  let best = null, bs = -1;
  for (const x of list) { const g = x.g, m = Math.abs(g.teams.A.fant - g.teams.B.fant); let s = 50 - Math.min(50, m); if (g.story.some(s => s.type === 'comeback')) s += 40; if (s > bs) { bs = s; best = x; } }
  return best;
}
async function league(id, week) {
  app.innerHTML = '<p class="loading">Loading league…</p>';
  const ctx = await loadLeague(id);
  if (!week) week = ctx.current;
  if (!ctx.demo) { const r = store.get('recent', []).filter(x => x.id !== id); r.unshift({ id, name: ctx.L.league.name }); store.set('recent', r.slice(0, 5)); }
  const list = await weekGames(id, ctx, week);
  document.title = `${ctx.L.league.name} · Week ${week} · Pixel Bowl`;
  const top = gotw(list);
  const live = !ctx.demo && week === ctx.current && (() => { const g = (SCHEDULE.weeks || {})[week] || []; return g.length && Date.now() < Math.max(...g.map(x => Date.parse(x[2]))) + 3.5 * 3600e3; })();
  const ordered = top ? [top, ...list.filter(x => x !== top)] : list;
  app.innerHTML = `
  <section class="lhead">
    <div class="t"><span class="muted">${ctx.demo ? 'Demo league · ' : ''}${esc(ctx.L.league.season)} season</span><h1>${esc(ctx.L.league.name)}</h1></div>
    <div class="weeksel"><label for="wk" style="margin:0">Week</label><select id="wk">${ctx.weeks.map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
  </section>
  ${live ? '<p class="muted">This week is still being played. Games show the score so far.</p>' : ''}
  ${list.length ? `<section class="cards">${ordered.map(x => card(id, week, x, x === top)).join('')}</section>` : '<section class="panel"><p>No matchups this week.</p></section>'}`;
  document.getElementById('wk').onchange = e => { location.hash = `#/l/${id}/w/${e.target.value}`; };
}
function card(id, week, { m, g }, star) {
  const A = g.final.A, B = g.final.B, w = A === B ? null : A > B ? 'A' : 'B';
  return `<a class="card ${star ? 'gotw' : ''}" href="#/l/${encodeURIComponent(id)}/w/${week}/m/${m.id}">
    ${star ? '<span class="ribbon">GAME OF THE WEEK</span>' : ''}
    <div class="row"><span class="nm A">${esc(m.A.name)}</span><span class="sc ${w === 'A' ? 'win' : 'lose'}">${A}</span></div>
    <div class="row"><span class="nm B">${esc(m.B.name)}</span><span class="sc ${w === 'B' ? 'win' : 'lose'}">${B}</span></div>
    <span class="fp">Fantasy ${g.teams.A.fant.toFixed(2)} – ${g.teams.B.fant.toFixed(2)}</span>
    <div class="tags">${tagsFor(g).map(([t, h]) => `<span class="tagx ${h ? 'hot' : ''}">${esc(t)}</span>`).join('')}</div>
  </a>`;
}

// ---------- watch
async function watch(id, week, mid) {
  app.innerHTML = '<p class="loading">Setting up the field…</p>';
  const ctx = await loadLeague(id);
  const list = await weekGames(id, ctx, week);
  const hit = list.find(x => x.m.id === mid);
  if (!hit) throw new Error('not-found');
  const { g } = hit, T = g.teams, S = g.snaps;
  document.title = `${T.A.name} vs ${T.B.name} · Pixel Bowl`;
  app.innerHTML = `
  <a class="back" href="#/l/${encodeURIComponent(id)}/w/${week}">← ${esc(ctx.L.league.name)} · Week ${week}</a>
  <div class="cab">
    <div class="board">
      <div class="tm a" id="tA"><div class="nm">${esc(T.A.name)}<span class="pb"></span></div><div class="sc" id="sA">0</div><div class="fp" id="fA">FAN 0.00</div></div>
      <div class="ctr"><div class="q" id="qc">1ST 15:00</div><div class="dd" id="dd"></div></div>
      <div class="tm b" id="tB"><div class="nm"><span class="pb"></span>${esc(T.B.name)}</div><div class="sc" id="sB">0</div><div class="fp" id="fB">FAN 0.00</div></div>
    </div>
    <div class="prog"><i id="prog"></i></div>
    <canvas id="cv" width="320" height="180" aria-label="8-bit football field"></canvas>
  </div>
  <div class="dialog"><div class="line" id="line">Press start.<span class="cursor"></span></div><div class="call" id="call"></div><div class="meta" id="meta"></div></div>
  <div class="controls">
    <button class="go" id="play">▶ Start</button>
    <span class="seg" role="group" aria-label="Speed"><button data-s="1" aria-pressed="false">1×</button><button data-s="2" aria-pressed="true">2×</button><button data-s="4" aria-pressed="false">4×</button></span>
    <span class="seg" role="group" aria-label="Mode"><button data-m="highlights" aria-pressed="true">Highlights</button><button data-m="full" aria-pressed="false">Full game</button></span>
    <button id="nexts">Next score</button>
    <button id="snd" aria-pressed="false">Sound off</button>
    <button id="share">Share</button>
  </div>
  <section class="panel"><h2>The story</h2><ul class="story">${g.story.map(s => `<li><span class="k">${esc({ mvp: 'MVP', comeback: 'Comeback', close: 'Nail-biter', blowout: 'Blowout', dud: 'Dud', bench: 'Bench' }[s.type] || s.type)}</span><span>${esc(s.text)}</span></li>`).join('')}</ul></section>
  <div class="grid2"><section class="panel la" id="la"></section><section class="panel lb" id="lb"></section></div>
  <details class="panel"><summary>How this game is made</summary><ol>
    <li>Final score is each team's fantasy total ÷ ${DIV}, rounded. The fantasy winner always wins.</li>
    <li>The NFL week is laid across the game clock: Thursday night opens the 1st quarter, Sunday's games fill the middle, Monday night closes the 4th.</li>
    <li>Each team scores when its fantasy total got there in real life, so comebacks land when they actually happened.</li>
    <li>Touches, yards and touchdowns go to starters by fantasy points, leaning on whoever was producing at that point of the week. Running and catching styles come from each player's real stat line.</li>
    <li>D/ST points turn into sacks and takeaways. Every play is fictional.</li>
  </ol></details>`;
  const $ = i => document.getElementById(i);
  const lineup = s => `<h2>${esc(T[s].name)}<span class="r" id="lt${s}">0.00</span></h2><table><thead><tr><th>No</th><th>Player</th><th style="text-align:right">Fantasy</th></tr></thead><tbody>` +
    T[s].players.map((p, i) => `<tr><td class="num">${p.num ? '#' + esc(p.num) : esc(p.pos)}</td><td>${esc(p.name)} <span class="muted">${esc(p.pos)}${p.team ? ' · ' + esc(p.team) : ''}</span><br><span class="bx" id="bx${s}${i}"></span></td><td class="pts" id="pp${s}${i}">0.0</td></tr>`).join('') + '</tbody></table>';
  $('la').innerHTML = lineup('A'); $('lb').innerHTML = lineup('B');

  const box = upto => {
    const b = { A: T.A.players.map(() => ({})), B: T.B.players.map(() => ({})) }, def = { A: {}, B: {} };
    for (let j = 0; j <= upto; j++) for (const [s, i, k, y, td] of S[j].st) {
      if (i === 'def') { def[s][k] = (def[s][k] || 0) + 1; continue; }
      const o = b[s][i]; if (!o) continue;
      const add = (key, v) => o[key] = (o[key] || 0) + v;
      if (k === 'pass') { add('att', 1); add('cmp', 1); add('py', y); add('ptd', td); } else if (k === 'inc') add('att', 1);
      else if (k === 'rush') { add('ru', 1); add('ry', y); add('rtd', td); } else if (k === 'rec') { add('rec', 1); add('rey', y); add('retd', td); }
      else if (k === 'fg') add('fg', 1); else if (k === 'xp') add('xp', 1);
    }
    return { b, def };
  };
  const line = o => { const out = []; if (o.att) out.push(`${o.cmp || 0}/${o.att}, ${o.py || 0} yds${o.ptd ? `, ${o.ptd} TD` : ''}`); if (o.ru) out.push(`${o.ru} car, ${o.ry} yds${o.rtd ? `, ${o.rtd} TD` : ''}`); if (o.rec) out.push(`${o.rec} rec, ${o.rey} yds${o.retd ? `, ${o.retd} TD` : ''}`); if (o.fg || o.xp) out.push(`${o.fg || 0} FG, ${o.xp || 0} XP`); return out.join(' · '); };
  const dline = d => { const o = []; if (d.sack) o.push(`${d.sack} sack${d.sack > 1 ? 's' : ''}`); const ta = (d.int || 0) + (d.fum || 0); if (ta) o.push(`${ta} takeaway${ta > 1 ? 's' : ''}`); return o.join(' · '); };

  let typer = null;
  const showCall = i => {
    clearInterval(typer); const x = S[i];
    const pre = x.down && ['play', 'td', 'sack'].includes(x.kind) ? `${ord(x.down)} & ${x.togo == null || x.s0 + x.togo >= 100 ? 'GOAL' : x.togo}: ` : '';
    const txt = (x.kind === 'final' ? `FINAL: ${T.A.name} ${x.sc.A}, ${T.B.name} ${x.sc.B}` : x.kind === 'half' ? `HALFTIME: ${T.A.name} ${x.sc.A}, ${T.B.name} ${x.sc.B}` : pre + x.text).toUpperCase();
    const el = $('line'); el.className = 'line ' + (x.off || '');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) el.innerHTML = esc(txt) + '<span class="cursor"></span>';
    else { let n = 0; typer = setInterval(() => { n += 2; el.innerHTML = esc(txt.slice(0, n)) + '<span class="cursor"></span>'; if (n >= txt.length) clearInterval(typer); }, 18); }
    $('call').innerHTML = g.calls[i] ? `<b>BOOTH</b>${esc(g.calls[i])}` : '';
    const d = new Date(x.real); const when = isNaN(d) ? '' : d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    $('meta').textContent = `${when ? `Real-world clock: ${when} · ` : ''}Fantasy ${x.fa.toFixed(1)}–${x.fb.toFixed(1)}`;
  };
  const update = ({ done, next, animated, progress }) => {
    const x = done >= 0 ? S[done] : null, sc = x ? x.sc : { A: 0, B: 0 };
    for (const s of ['A', 'B']) { const el = $('s' + s), v = String(sc[s]); if (el.textContent !== v) { el.textContent = v; if (animated) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } } }
    $('fA').textContent = 'FAN ' + (x ? x.fa : 0).toFixed(2); $('fB').textContent = 'FAN ' + (x ? x.fb : 0).toFixed(2);
    $('ltA').textContent = (x ? x.fa : 0).toFixed(2); $('ltB').textContent = (x ? x.fb : 0).toFixed(2);
    $('qc').textContent = !x ? '1ST 15:00' : x.kind === 'final' ? 'FINAL' : x.kind === 'half' ? 'HALFTIME' : `${ord(x.q)} ${x.clk}`;
    const nx = S[next], showDD = nx && nx.down && ['play', 'td', 'sack'].includes(nx.kind);
    $('dd').textContent = showDD ? `${ord(nx.down)} & ${nx.togo == null || nx.s0 + nx.togo >= 100 ? 'GOAL' : nx.togo}` : '';
    const po = (nx && nx.off) || (x && x.off); $('tA').classList.toggle('has', po === 'A'); $('tB').classList.toggle('has', po === 'B');
    $('prog').style.width = (progress * 100) + '%';
    const pp = x ? x.pp : { A: T.A.players.map(() => 0), B: T.B.players.map(() => 0) }, bx = box(Math.max(-1, done));
    for (const s of ['A', 'B']) T[s].players.forEach((p, i) => { $('pp' + s + i).textContent = (pp[s][i] ?? 0).toFixed(1); $('bx' + s + i).textContent = p.pos === 'DEF' ? dline(bx.def[s]) : line(bx.b[s][i]); });
    if (x && !animated) showCall(done);
  };
  const setPlayBtn = (on, ended) => { $('play').textContent = on ? '❚❚ Pause' : ended ? '↺ Replay' : '▶ Start'; };
  try { await document.fonts?.load('8px "Press Start 2P"'); } catch (e) { }
  player = new Player($('cv'), g, { update, call: i => showCall(i), state: setPlayBtn });
  $('play').onclick = () => player.running ? player.pause() : player.play();
  $('nexts').onclick = () => player.nextScore();
  document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { player.speed = +b.dataset.s; document.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { player.setMode(b.dataset.m); document.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('snd').onclick = () => { const on = !player.sound; player.enableSound(on); $('snd').setAttribute('aria-pressed', on); $('snd').textContent = on ? 'Sound on' : 'Sound off'; };
  $('share').onclick = async () => {
    const url = location.href, text = `${T.A.name} ${g.final.A}, ${T.B.name} ${g.final.B} — watch the Pixel Bowl recap`;
    try { if (navigator.share) { await navigator.share({ title: 'Pixel Bowl', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { prompt('Copy this link:', url); }
  };
}
