// Sleeper data access (browser) and conversion into engine input.
const API = 'https://api.sleeper.app/v1';
const cache = new Map();
async function j(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(r.status === 404 ? 'not-found' : `HTTP ${r.status}`); return r.json(); });
  cache.set(url, p); p.catch(() => cache.delete(url)); return p;
}
export const getState = () => j(`${API}/state/nfl`);
export async function getLeague(id) {
  const [league, users, rosters] = await Promise.all([j(`${API}/league/${id}`), j(`${API}/league/${id}/users`), j(`${API}/league/${id}/rosters`)]);
  if (!league) throw new Error('not-found');
  return { league, users, rosters };
}
export const getMatchups = (id, week) => j(`${API}/league/${id}/matchups/${week}`);
export const getStatic = path => j(path);

// group a week's matchup rows into pairs with team names
export function pairUp(L, rows, players) {
  const byUser = Object.fromEntries((L.users || []).map(u => [u.user_id, u]));
  const owner = Object.fromEntries((L.rosters || []).map(r => [r.roster_id, byUser[r.owner_id]]));
  const slots = (L.league.roster_positions || []).filter(x => x !== 'BN' && x !== 'IR' && x !== 'TAXI');
  const groups = {};
  for (const r of rows || []) { if (r.matchup_id == null) continue; (groups[r.matchup_id] ||= []).push(r); }
  return Object.entries(groups).filter(([, g]) => g.length === 2).map(([mid, g]) => {
    const [a, b] = g.sort((x, y) => x.roster_id - y.roster_id).map(r => team(r));
    return { id: +mid, A: a, B: b };
  }).sort((x, y) => x.id - y.id);
  function team(r) {
    const u = owner[r.roster_id];
    const name = (u && u.metadata && u.metadata.team_name) || (u ? `Team ${u.display_name}` : `Team ${r.roster_id}`);
    const pts = r.players_points || {};
    const starters = (r.starters || []).map((id, i) => {
      const meta = players[id] || (id === '0' ? null : ['Unknown player', slots[i] && /^(QB|RB|WR|TE|K|DEF)$/.test(slots[i]) ? slots[i] : 'WR', '', '']);
      if (!meta) return null; // empty slot
      const p = r.starters_points ? r.starters_points[i] : pts[id];
      return { id, name: meta[0], pos: meta[1], team: meta[2], num: meta[3], pts: +(p ?? pts[id] ?? 0), slot: slots[i] || meta[1] };
    }).filter(Boolean);
    const set = new Set(r.starters || []);
    const bench = (r.players || []).filter(id => !set.has(id) && players[id]).map(id => ({ id, name: players[id][0], pos: players[id][1], team: players[id][2], pts: +(pts[id] || 0) }));
    return { rosterId: r.roster_id, name, owner: u ? u.display_name : '', avatar: u && u.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null, starters, bench, points: +(r.points || 0) };
  }
}
export function engineInput(leagueId, week, m, schedule, styles, scale) {
  return {
    scale,
    seed: `${leagueId}:${week}:${m.id}`,
    schedule: (schedule.weeks || {})[week] || [],
    styles: styles || {},
    teams: { A: m.A, B: m.B },
  };
}

// season-to-date mean / standard deviation of team scores (weeks with games played only)
export function leagueScale(weeksOfRows) {
  const v = [];
  for (const rows of weeksOfRows) for (const r of rows || []) if (r.matchup_id != null && +r.points > 0) v.push(+r.points);
  if (v.length < 4) return null;
  const mu = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length);
  return { mu, sd: Math.max(sd, mu * .12), n: v.length };
}
