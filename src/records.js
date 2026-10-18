// Season record book: totals every replayed game in the season.
// Stats belong to the fantasy team that started the player that week.

// fictional fantasy-style score for one player's game line (used for MVP and Player of the Week)
export const gameValue = b => (b.py || 0) * .04 + (b.ptd || 0) * 4 + ((b.ry || 0) + (b.rey || 0)) * .1 + ((b.rtd || 0) + (b.retd || 0)) * 6 + (b.rec || 0) * .5 + (b.fg || 0) * 3 + (b.xp || 0) + (b.sack || 0) * 1 + (b.to || 0) * 2;

// one game's box score: { A: [line per starter], B: [...] }; defensive plays credit the D/ST (or best IDP)
export function boxScore(g) {
  const out = { A: g.teams.A.players.map(() => ({})), B: g.teams.B.players.map(() => ({})) };
  const defIdx = s => { const ps = g.teams[s].players; let j = ps.findIndex(p => p.pos === 'DEF'); if (j < 0) { let best = -1; ps.forEach((p, i) => { if (['DL', 'LB', 'DB'].includes(p.pos) && (best < 0 || p.pts > ps[best].pts)) best = i; }); j = best; } return j; };
  const di = { A: defIdx('A'), B: defIdx('B') };
  for (const x of g.snaps) for (const [s, i0, k, y, td] of x.st) {
    const i = i0 === 'def' ? di[s] : i0; const o = out[s][i]; if (!o) continue;
    const add = (key, v) => o[key] = (o[key] || 0) + v;
    const long = v => { if (v > (o.long || 0)) o.long = v; };
    if (k === 'pass') { add('att', 1); add('cmp', 1); add('py', y); add('ptd', td); }
    else if (k === 'inc') add('att', 1);
    else if (k === 'rush') { add('ru', 1); add('ry', y); add('rtd', td); long(y); }
    else if (k === 'rec') { add('rec', 1); add('rey', y); add('retd', td); long(y); }
    else if (k === 'fg') { add('fg', 1); if (y > (o.fglong || 0)) o.fglong = y; }
    else if (k === 'xp') add('xp', 1);
    else if (k === 'sack') add('sack', 1);
    else if (k === 'int' || k === 'fum') add('to', 1);
  }
  return out;
}

// games: [{ week, m, g }] for every completed week
export function buildRecords(games) {
  const players = {}, teams = {}, weekly = {}, single = [], gameRecs = [];
  const tkey = t => String(t.rosterId);
  for (const { week, m, g } of games) {
    const box = boxScore(g);
    for (const s of ['A', 'B']) {
      const src = m[s], o = s === 'A' ? 'B' : 'A';
      const tk = tkey(src);
      const T = teams[tk] ||= { key: tk, name: src.name, owner: src.owner, w: 0, l: 0, t: 0, pf: 0, pa: 0, comebacks: 0, close: 0, games: 0 };
      T.name = src.name; T.games++;
      T.pf += g.final[s]; T.pa += g.final[o];
      if (g.final[s] > g.final[o]) T.w++; else if (g.final[s] < g.final[o]) T.l++; else T.t++;
      if (g.story.some(x => x.type === 'comeback' && x.team === s)) T.comebacks++;
      if (g.story.some(x => x.type === 'close') && g.final[s] > g.final[o]) T.close++;
      g.teams[s].players.forEach((p, i) => {
        const b = box[s][i]; if (!b) return;
        const key = `${p.id}|${tk}`;
        const P = players[key] ||= { key, name: p.name, pos: p.pos, num: p.num, team: src.name, teamKey: tk, gp: 0, wins: 0, value: 0 };
        P.gp++; if (g.final[s] > g.final[o]) P.wins++;
        for (const [k, v] of Object.entries(b)) { if (k === 'long' || k === 'fglong') P[k] = Math.max(P[k] || 0, v); else P[k] = (P[k] || 0) + v; }
        const val = gameValue(b); P.value += val;
        const line = { week, name: p.name, pos: p.pos, team: src.name, b, val, m: m.id };
        single.push(line);
        if (!weekly[week] || val > weekly[week].val) weekly[week] = line;
      });
    }
    const margin = Math.abs(g.final.A - g.final.B), w = g.final.A >= g.final.B ? 'A' : 'B', l = w === 'A' ? 'B' : 'A';
    const cb = g.story.find(x => x.type === 'comeback');
    gameRecs.push({ week, m: m.id, margin, total: g.final.A + g.final.B, win: m[w].name, lose: m[l].name, ws: g.final[w], ls: g.final[l], comeback: cb ? cb.deficit : 0, cbTeam: cb ? m[cb.team].name : null });
  }
  const P = Object.values(players);
  const top = (key, n = 5, f = x => x[key] || 0) => P.filter(x => f(x) > 0).sort((a, b) => f(b) - f(a)).slice(0, n);
  const leaders = {
    passing: top('py'), rushing: top('ry'), receiving: top('rey'),
    touchdowns: top('td', 5, x => (x.ptd || 0) + (x.rtd || 0) + (x.retd || 0)),
    longest: top('long', 5), defense: top('def', 5, x => (x.sack || 0) + 2 * (x.to || 0)), kicking: top('fg'),
  };
  // MVP race: season production, plus a bonus for winning
  const mvp = P.filter(x => x.pos !== 'K' && x.pos !== 'DEF').map(x => ({ ...x, mvp: x.value + x.wins * 4 })).sort((a, b) => b.mvp - a.mvp).slice(0, 5);
  const best = (f, n = 1) => single.slice().sort((a, b) => f(b) - f(a)).filter(x => f(x) > 0).slice(0, n);
  const singleRecs = [
    { label: 'Passing yards', unit: 'yds', rows: best(x => x.b.py || 0), f: x => x.b.py },
    { label: 'Rushing yards', unit: 'yds', rows: best(x => x.b.ry || 0), f: x => x.b.ry },
    { label: 'Receiving yards', unit: 'yds', rows: best(x => x.b.rey || 0), f: x => x.b.rey },
    { label: 'Touchdowns', unit: 'TD', rows: best(x => (x.b.ptd || 0) + (x.b.rtd || 0) + (x.b.retd || 0)), f: x => (x.b.ptd || 0) + (x.b.rtd || 0) + (x.b.retd || 0) },
    { label: 'Longest play', unit: 'yds', rows: best(x => x.b.long || 0), f: x => x.b.long },
  ].filter(r => r.rows.length);
  const g = (f, desc = true) => gameRecs.slice().sort((a, b) => desc ? f(b) - f(a) : f(a) - f(b))[0];
  const gameRecords = gameRecs.length ? [
    { label: 'Biggest blowout', r: g(x => x.margin) },
    { label: 'Closest game', r: g(x => x.margin, false) },
    { label: 'Highest-scoring game', r: g(x => x.total) },
    ...(gameRecs.some(x => x.comeback) ? [{ label: 'Biggest comeback', r: g(x => x.comeback), comeback: true }] : []),
  ] : [];
  const standings = Object.values(teams).sort((a, b) => (b.w + b.t / 2) / b.games - (a.w + a.t / 2) / a.games || (b.pf - b.pa) - (a.pf - a.pa));
  return { leaders, mvp, singleRecs, gameRecords, standings, potw: weekly, weeks: [...new Set(games.map(x => x.week))].sort((a, b) => a - b) };
}
