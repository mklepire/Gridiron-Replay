// Builds the static data the app needs. Runs daily in GitHub Actions (see .github/workflows/data.yml).
//   data/players.json   Sleeper player id -> [name, position, team, jersey]
//   data/schedule.json  { season, weeks: { "6": [[away, home, kickoffISO], ...] } }
//   data/styles/<week>.json  Sleeper id -> [carries, rushYds, receptions, recYds, passAtt, passYds]
// Sleeper is asked for its player list once per run (they ask apps to call it at most once a day).
import fs from 'node:fs/promises';

const SEASON = Number(process.env.SEASON || new Date().getFullYear());
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const TEAM = { LA: 'LAR', JAC: 'JAX', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
const tm = t => TEAM[t] || t;
// defensive players (IDP leagues) collapse to three groups
const IDP = { DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB' };

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
async function get(url, asText = true) {
  const r = await fetch(url, { headers: { 'user-agent': 'gridiron-replay-data' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return asText ? r.text() : r.json();
}
async function gunzipText(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
  const ds = new DecompressionStream('gzip');
  return new Response(r.body.pipeThrough(ds)).text();
}
// ET wall clock -> UTC ISO
function etToISO(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const asET = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return new Date(guess.getTime() + (guess.getTime() - asET)).toISOString();
}

async function players() {
  const out = {}; const gsis = {};
  try {
    const all = await get('https://api.sleeper.app/v1/players/nfl', false);
    for (const [id, p] of Object.entries(all)) {
      const raw = p.position || (p.fantasy_positions || [])[0];
      const pos = IDP[raw] || raw;
      if (!pos || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FB', 'DL', 'LB', 'DB'].includes(pos)) continue;
      if (!p.team && pos !== 'DEF' && !p.active) continue;
      const name = pos === 'DEF' ? `${p.first_name} ${p.last_name}`.trim() : (p.full_name || `${p.first_name} ${p.last_name}`);
      out[id] = [name, pos === 'FB' ? 'RB' : pos, p.team || '', p.number != null ? String(p.number) : ''];
      if (p.gsis_id) gsis[String(p.gsis_id).trim()] = id;
    }
    console.log('players from Sleeper', Object.keys(out).length);
  } catch (e) {
    console.warn('Sleeper unavailable, using nflverse roster + dynastyprocess ids:', e.message);
    const ids = parseCSV(await get('https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'));
    const g2s = {}; for (const r of ids) if (r.gsis_id && r.sleeper_id && r.sleeper_id !== 'NA') g2s[r.gsis_id] = r.sleeper_id;
    const ros = parseCSV(await get(`${NFLVERSE}/rosters/roster_${SEASON}.csv`));
    for (const r of ros) {
      const id = (r.sleeper_id && r.sleeper_id !== 'NA') ? r.sleeper_id : g2s[r.gsis_id];
      if (!id || !['QB', 'RB', 'WR', 'TE', 'K', 'FB'].includes(r.position)) continue;
      out[id] = [r.full_name, r.position === 'FB' ? 'RB' : r.position, tm(r.team), r.jersey_number === 'NA' ? '' : r.jersey_number];
      if (r.gsis_id) gsis[r.gsis_id] = id;
    }
    const NAMES = { ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders' };
    for (const [ab, n] of Object.entries(NAMES)) out[ab] = [n, 'DEF', ab, ''];
  }
  return { out, gsis };
}

async function schedule() {
  const rows = parseCSV(await get('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'));
  const weeks = {};
  for (const g of rows) {
    if (+g.season !== SEASON || g.game_type !== 'REG') continue;
    (weeks[g.week] ||= []).push([tm(g.away_team), tm(g.home_team), etToISO(g.gameday, g.gametime || '13:00')]);
  }
  return { season: SEASON, weeks };
}

async function styles(gsis) {
  let rows;
  try { rows = parseCSV(await get(`${NFLVERSE}/stats_player/stats_player_week_${SEASON}.csv`)); }
  catch (e) { console.warn('no weekly stats yet', e.message); return {}; }
  const byWeek = {};
  for (const r of rows) {
    if (r.season_type !== 'REG') continue;
    const id = gsis[r.player_id]; if (!id) continue;
    const n = k => Math.round(+r[k] || 0);
    (byWeek[r.week] ||= {})[id] = [n('carries'), n('rushing_yards'), n('receptions'), n('receiving_yards'), n('attempts'), n('passing_yards')];
  }
  return byWeek;
}

// gsis (NFL) id -> Sleeper id, merged from every source we have; Sleeper's own gsis_id field is often blank
async function idMap(fromSleeper) {
  const m = { ...fromSleeper };
  try {
    const ids = parseCSV(await get('https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'));
    for (const r of ids) if (r.gsis_id && r.gsis_id !== 'NA' && r.sleeper_id && r.sleeper_id !== 'NA') m[r.gsis_id] ||= r.sleeper_id;
  } catch (e) { console.warn('dynastyprocess ids unavailable', e.message); }
  try {
    const ros = parseCSV(await get(`${NFLVERSE}/rosters/roster_${SEASON}.csv`));
    for (const r of ros) if (r.gsis_id && r.sleeper_id && r.sleeper_id !== 'NA') m[r.gsis_id] ||= r.sleeper_id;
  } catch (e) { console.warn('nflverse roster unavailable', e.message); }
  return m;
}

await fs.mkdir('data/styles', { recursive: true });
let gsis = {};
if (!process.env.STYLES_ONLY) {
  const r = await players(); gsis = r.gsis;
  await fs.writeFile('data/players.json', JSON.stringify(r.out));
  await fs.writeFile('data/schedule.json', JSON.stringify(await schedule()));
}
const map = await idMap(gsis);
console.log('gsis->sleeper ids', Object.keys(map).length);
const st = await styles(map);
for (const [w, v] of Object.entries(st)) await fs.writeFile(`data/styles/${w}.json`, JSON.stringify(v));
console.log('weeks with styles:', Object.entries(st).map(([w, v]) => `${w}:${Object.keys(v).length}`).join(' '));
