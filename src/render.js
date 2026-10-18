// 8-bit side-scrolling renderer + playback controller for a generated game.
const W = 320, H = 180, FY0 = 40, FY1 = 176, MID = 108;
const O = { A: 'B', B: 'A' };
const wx = y => 80 + y * 8;
const absY = (off, y) => off === 'B' ? 100 - y : y;
const lerp = (a, b, k) => a + (b - a) * k, cl = k => Math.max(0, Math.min(1, k)), ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const last = n => { const p = String(n).split(' '); return p.length > 1 && /^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(p[p.length - 1]) ? p[p.length - 2] : p[p.length - 1]; };
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export const COLORS = { A: { h: '#f8b800', j: '#f8b800', n: '#fcfcfc', p: '#fcfcfc', dk: '#a87000', ui: '#f8b800' }, B: { h: '#6844fc', j: '#6844fc', n: '#fcfcfc', p: '#bcbcbc', dk: '#4428bc', ui: '#9878f8' } };
const SKIN = ['#fcbcb0', '#e09060', '#a05830', '#6c3818'];
const SPR = ["..HHH...", ".HHHHH..", ".HHHSM..", ".JJJJJ..", "SJJNJJS.", "SJJNJJS.", ".JJJJJ..", ".PPPPP..", ".PP.PP..", ".PP.PP..", ".SS..SS.", "BB....BB"];
const SPR2 = ["..HHH...", ".HHHHH..", ".HHHSM..", ".JJJJJ..", "SJJNJJS.", "SJJNJJS.", ".JJJJJ..", ".PPPPP..", ".PPPP...", "..PPP...", "..SS....", "..BBB..."];
const PIX = '"Press Start 2P", monospace';

export class Player {
  constructor(canvas, game, hooks = {}) {
    this.cv = canvas; this.cx = canvas.getContext('2d'); this.cx.imageSmoothingEnabled = false;
    this.g = game; this.S = game.snaps; this.hooks = hooks;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.speed = 2; this.running = false; this.mode = 'highlights';
    this.order = game.highlights; this.pos = 0; // index into this.order
    this.cam = wx(50); this.sparks = []; this.phase = null; this.sound = false; this.actx = null;
    this.crowd = []; let sd = 12345; const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 1400; i++) this.crowd.push([rnd() * 1000 - 20, 6 + rnd() * 26, ['#f83800', '#fcfcfc', '#f8b800', '#6844fc', '#3cbcfc', '#b8f818', '#d800cc'][Math.floor(rnd() * 7)]]);
    this.roles = {}; for (const s of ['A', 'B']) this.roles[s] = this.pickRoles(s);
    this.seek(0);
    this.raf = requestAnimationFrame(t => this.frame(t));
  }
  destroy() { cancelAnimationFrame(this.raf); this.running = false; }
  pickRoles(s) {
    const ps = this.g.teams[s].players.map((p, i) => ({ ...p, i }));
    const by = pos => ps.filter(p => p.pos === pos).sort((a, b) => b.pts - a.pts);
    const qb = by('QB')[0], rbs = by('RB'), wrs = by('WR'), tes = by('TE'), k = by('K')[0];
    return { qb, rb: rbs[0], wr1: wrs[0], wr2: wrs[1] || tes[1] || rbs[1], te: tes[0] || wrs[2], k, ps };
  }
  // ---------- playback
  setMode(m) { const cur = this.curSnap(); this.mode = m; this.order = m === 'full' ? this.S.map((_, i) => i) : this.g.highlights; let p = this.order.findIndex(i => i >= cur); this.seek(p < 0 ? this.order.length : p); }
  curSnap() { return this.pos < this.order.length ? this.order[this.pos] : this.S.length; }
  seek(p) {
    this.pos = Math.max(0, Math.min(this.order.length, p));
    const i = this.curSnap();
    this.phase = i < this.S.length ? { i, scene: this.build(i), t0: null } : { i, scene: null, hold: Infinity, last: this.build(this.S.length - 1) };
    if (this.running && this.phase.scene) this.phase.pre = performance.now() + 250 / this.speed;
    this.emit(false);
  }
  play() { if (this.pos >= this.order.length) this.seek(0); this.running = true; if (this.phase.scene && this.phase.t0 == null) this.phase.pre = performance.now() + 150; this.hooks.state?.(true); }
  pause() { this.running = false; if (this.phase.scene && this.phase.t0 == null) this.phase.pre = null; this.hooks.state?.(false); }
  nextScore() { const j = this.order.findIndex((i, k) => k >= this.pos && ['td', 'fg'].includes(this.S[i].kind)); if (j >= 0) { this.seek(j); if (!this.running) this.play(); } }
  emit(animated) { // tell the page what has happened so far
    const done = this.pos === 0 ? -1 : this.order[this.pos - 1];
    this.hooks.update?.({ done, next: this.curSnap(), animated, progress: this.pos / this.order.length });
  }
  startSnap() {
    const i = this.curSnap(); this.phase.t0 = performance.now();
    this.hooks.call?.(i);
    const t = this.phase.scene.act.type;
    if (['run', 'pass', 'inc', 'int', 'sack', 'fum', 'knee'].includes(t)) this.tone(880, .07);
    if (['kickoff', 'punt', 'fg', 'pat'].includes(t)) this.tone(220, .12, 0, 'triangle', .1);
  }
  finishSnap() {
    const x = this.S[this.curSnap()], t = this.phase.scene.act.type;
    this.pos++; this.emit(true);
    if (x.kind === 'td') this.sfx('td'); else if (x.kind === 'fg' || (x.kind === 'pat' && !/NO GOOD/.test(x.text))) this.sfx('good'); else if (t === 'int' || t === 'fum') this.sfx('bad'); else if (t === 'sack' || t === 'inc') this.tone(1760, .25, 0, 'sine', .05);
    const hold = ['td', 'fg', 'turnover', 'half'].includes(x.kind) ? 1700 : x.kind === 'td_score' ? 700 : 450;
    this.phase = { scene: null, hold: performance.now() + hold / this.speed, last: this.phase.scene };
    if (this.pos >= this.order.length) { this.running = false; this.hooks.state?.(false, true); }
  }
  frame(now) {
    const ph = this.phase; let sc = null, p = 1;
    if (ph.t0 != null && ph.scene) {
      const t = ph.scene.act.type, dur = 1500 * (t === 'celebrate' ? 1.6 : (t === 'kickoff' || t === 'punt') ? 1.3 : 1) / this.speed;
      p = cl((now - ph.t0) / dur); sc = ph.scene;
      if (p >= 1) { this.finishSnap(); sc = this.phase.last; p = 1; }
    } else if (!ph.scene) {
      sc = ph.last; p = 1;
      if (this.running && now >= ph.hold && this.pos < this.order.length) { const i = this.curSnap(); this.phase = { i, scene: this.build(i), t0: null, pre: now + 220 / this.speed }; }
    } else {
      sc = ph.scene; p = 0;
      if (this.running && ph.pre != null && now >= ph.pre) { ph.pre = null; this.startSnap(); }
    }
    try { this.draw(sc, p, now); } catch (e) { /* never let one bad frame stop the loop */ }
    this.raf = requestAnimationFrame(t => this.frame(t));
  }
  // ---------- audio
  enableSound(on) { this.sound = on; if (on) { try { this.actx = this.actx || new (window.AudioContext || window.webkitAudioContext)(); this.actx.resume?.(); } catch (e) { } this.tone(660, .1); } }
  tone(f, d, when = 0, type = 'square', v = .05) { if (!this.sound || !this.actx) return; try { const a = this.actx, o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(a.destination); const t0 = a.currentTime + when; o.start(t0); g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + d); o.stop(t0 + d + .02); } catch (e) { } }
  sfx(k) { if (k === 'td') [523, 659, 784, 1047, 784, 1047].forEach((f, j) => this.tone(f, .16, j * .13)); if (k === 'good') [659, 880].forEach((f, j) => this.tone(f, .2, j * .15)); if (k === 'bad') [440, 330, 220].forEach((f, j) => this.tone(f, .18, j * .14, 'triangle', .07)); }
  // ---------- understanding a snap
  findP(s, ln) { if (!ln) return null; return this.roles[s].ps.find(p => last(p.name) === ln || p.name.endsWith(ln)) || null; }
  parse(x) {
    const t = x.text, s = x.off; let m;
    const k = x.kind;
    if (k === 'kickoff') return { type: 'kickoff' }; if (k === 'punt') return { type: 'punt' }; if (k === 'fg') return { type: 'fg' };
    if (k === 'pat') return { type: 'pat' }; if (k === 'td_score') return { type: 'celebrate' }; if (k === 'half') return { type: 'half' }; if (k === 'final') return { type: 'final' };
    if (k === 'sack') return { type: 'sack', safety: /SAFETY/.test(t) };
    if (k === 'turnover') return { type: /intercepted/.test(t) ? 'int' : 'fum' };
    if (/knee/.test(t)) return { type: 'knee' };
    if (/incomplete|broken up|throws it away/.test(t)) return { type: 'inc' };
    if ((m = t.match(/ to ([A-Z][\w'’.-]+)/))) return { type: 'pass', who: x.who != null ? this.roles[s].ps[x.who] : this.findP(s, m[1]) };
    if (/scrambles/.test(t)) return { type: 'run', who: this.roles[s].qb, qb: true };
    if ((m = t.match(/^([A-Z][\w'’.-]+) runs/))) return { type: 'run', who: x.who != null ? this.roles[s].ps[x.who] : this.findP(s, m[1]) };
    return { type: 'none' };
  }
  // ---------- scenes
  formation(x) {
    const off = x.off || 'A', dir = off === 'A' ? 1 : -1, los = wx(absY(off, x.s0)), R = this.roles[off];
    const mk = (id, team, bx, by, p) => ({ id, team, bx, by, name: p ? last(p.name) : null, num: p ? p.num : '', skin: SKIN[hash(id + (p ? p.name : '') + team) % 4], face: team === off ? dir : -dir });
    const A = [mk('ol1', off, los - dir * 4, MID - 8), mk('ol2', off, los - dir * 4, MID), mk('ol3', off, los - dir * 4, MID + 8),
      mk('qb', off, los - dir * 14, MID, R.qb), mk('rb', off, los - dir * 28, MID + 2, R.rb), mk('wr1', off, los - dir * 3, FY0 + 14, R.wr1),
      mk('wr2', off, los - dir * 3, FY1 - 14, R.wr2), mk('te', off, los - dir * 4, MID + 18, R.te)];
    const d = O[off];
    A.push(mk('dl1', d, los + dir * 6, MID - 8), mk('dl2', d, los + dir * 6, MID), mk('dl3', d, los + dir * 6, MID + 8), mk('lb1', d, los + dir * 26, MID - 16), mk('lb2', d, los + dir * 26, MID + 16), mk('cb1', d, los + dir * 14, FY0 + 14), mk('cb2', d, los + dir * 14, FY1 - 14), mk('s', d, los + dir * 60, MID));
    for (const a of A) a.f = () => [a.bx, a.by];
    return { off, dir, los, A, by: Object.fromEntries(A.map(a => [a.id, a])) };
  }
  roleFor(off, p, k) { const R = this.roles[off]; if (!p) return k % 2 ? 'wr2' : 'wr1'; if (p === R.rb || p.pos === 'RB') return 'rb'; if (p === R.te || p.pos === 'TE') return 'te'; if (p === R.wr2) return 'wr2'; if (p.pos === 'QB') return 'qb'; return 'wr1'; }
  build(i) {
    const x = this.S[i], act = this.parse(x), F = this.formation(x), { off, dir, los, A, by } = F;
    const end = wx(absY(off, Math.max(-5, Math.min(103, x.kind === 'td' ? 103 : x.s1))));
    const sc = { x, act, A, labels: [], noField: false };
    const setName = (a, p) => { if (p) { a.name = last(p.name); a.num = p.num; } };
    const chase = (a, target, lag = 0, spd = 1) => { a.f = p => { const k = ease(cl((p - .12 - lag) / .8 * spd)); const [tx, ty] = target(Math.min(1, p + .05)); return [lerp(a.bx, tx + dir * 5, k), lerp(a.by, ty + (hash(a.id) % 3 - 1) * 6, k)]; }; };
    for (const k of ['ol1', 'ol2', 'ol3']) { const a = by[k]; a.f = p => [a.bx + dir * lerp(0, 8, ease(cl((p - .1) / .6))), a.by]; }
    const t = act.type;
    if (t === 'run') {
      const role = act.qb ? 'qb' : 'rb', c = by[role]; setName(c, act.who);
      const hand = [by.qb.bx, MID], jit = hash(x.text) % 20 - 10;
      c.f = p => { if (role === 'rb' && p < .25) { const k = ease(p / .25); return [lerp(c.bx, hand[0], k), lerp(c.by, hand[1], k)]; } const k = ease(cl((p - .25) / .7)); return [lerp(role === 'rb' ? hand[0] : c.bx, end, k), MID + Math.sin(k * 7) * 10 * (1 - k) + jit * k]; };
      if (role === 'rb') by.qb.f = p => [by.qb.bx - dir * lerp(0, 4, cl(p / .3)), by.qb.by];
      ['dl1', 'dl2', 'dl3', 'lb1', 'lb2', 's', 'cb1', 'cb2'].forEach((k, j) => chase(by[k], c.f, j * .02));
      by.wr1.f = p => [by.wr1.bx + dir * lerp(0, 30, ease(cl(p))), by.wr1.by]; by.wr2.f = p => [by.wr2.bx + dir * lerp(0, 26, ease(cl(p))), by.wr2.by];
      sc.ball = p => { const [bx, b2] = c.f(p); return [bx + dir * 3, b2 - 7, 0]; }; sc.carrier = c; sc.labels = [c]; if (x.kind === 'td') sc.td = true;
    } else if (t === 'pass' || t === 'inc' || t === 'int') {
      const role = t === 'pass' ? this.roleFor(off, act.who, i) : (i % 2 ? 'wr2' : 'wr1'), r = by[role]; if (t === 'pass') setName(r, act.who);
      const qb = by.qb, drop = qb.bx - dir * 14; qb.f = p => [lerp(qb.bx, drop, ease(cl(p / .3))), qb.by];
      const catchX = t === 'pass' ? end - dir * Math.min(24, Math.abs(end - los) * .4) : los + dir * (70 + hash(x.text) % 60);
      const routeY = r.by < MID ? Math.max(FY0 + 12, r.by + 10) : r.by > MID ? Math.min(FY1 - 10, r.by - 10) : MID + (hash(x.text) % 30 - 15);
      r.f = p => { if (p < .55) { const k = ease(p / .55); return [lerp(r.bx, catchX, k), lerp(r.by, routeY, k)]; } if (t !== 'pass') return [catchX, routeY]; const k = ease(cl((p - .55) / .4)); return [lerp(catchX, end, k), lerp(routeY, MID + (routeY - MID) * .5, k)]; };
      ['wr1', 'wr2', 'te', 'rb'].filter(k => k !== role).forEach(k => { const a = by[k]; a.f = p => [a.bx + dir * lerp(0, k === 'rb' ? 6 : 40, ease(cl(p))), a.by + (k === 'rb' ? -6 * cl(p) : 0)]; });
      ['dl1', 'dl2', 'dl3'].forEach(k => chase(by[k], qb.f, 0, .7));
      const cb = role === 'wr2' ? by.cb2 : by.cb1; chase(cb, r.f, .02); chase(by.s, r.f, .08); chase(by.lb1, r.f, .15); chase(by.lb2, r.f, .2);
      const q0 = [drop + dir * 2, MID - 9];
      if (t === 'int') { const back = catchX - dir * 40; cb.f = p => { if (p < .55) { const k = ease(p / .55); return [lerp(cb.bx, catchX + dir * 4, k), lerp(cb.by, routeY, k)]; } const k = ease(cl((p - .55) / .4)); return [lerp(catchX + dir * 4, back, k), routeY]; }; }
      sc.ball = p => {
        if (p < .32) { const [a, b] = qb.f(p); return [a + dir * 2, b - 9, 0]; }
        if (p < .55) { const k = (p - .32) / .23; return [lerp(q0[0], catchX, k), lerp(q0[1], routeY - 9, k), Math.sin(Math.PI * k) * 28]; }
        if (t === 'inc') { const k = cl((p - .55) / .2); return [catchX + dir * 6 * k, routeY - 9 + 9 * k, Math.sin(Math.PI * k) * 4]; }
        if (t === 'int') { const [a, b] = cb.f(p); return [a, b - 9, 0]; }
        const [a, b] = r.f(p); return [a + dir * 3, b - 7, 0];
      };
      if (t === 'int') { sc.fx = 'INTERCEPTED!'; sc.labels = [qb]; } else if (t === 'inc') { sc.fx = 'INCOMPLETE'; sc.labels = [qb]; } else { sc.labels = [qb, r]; sc.carrier = r; if (x.kind === 'td') sc.td = true; if (x.kind === 'two') sc.fx = 'GOOD!'; }
    } else if (t === 'sack') {
      const qb = by.qb; qb.f = p => [lerp(qb.bx, end, ease(cl(p / .6))), qb.by];
      ['dl1', 'dl2', 'dl3', 'lb1'].forEach((k, j) => chase(by[k], qb.f, j * .03, 1.1));
      sc.ball = p => { const [a, b] = qb.f(p); return [a + dir * 2, b - 8, 0]; }; sc.down = p => p > .75 ? ['qb'] : []; sc.fx = act.safety ? 'SAFETY!' : 'SACK!'; sc.labels = [qb];
    } else if (t === 'fum') {
      const c = by.rb; c.f = p => { const k = ease(cl((p - .15) / .6)); return [lerp(c.bx, los + dir * 10, k), MID + Math.sin(k * 6) * 6]; };
      ['dl1', 'dl2', 'dl3', 'lb1', 'lb2'].forEach((k, j) => chase(by[k], c.f, j * .02));
      sc.ball = p => { if (p < .75) { const [a, b] = c.f(p); return [a + dir * 3, b - 7, 0]; } const k = cl((p - .75) / .2), [a, b] = c.f(.75); return [a + dir * 14 * k, b - 7 + 5 * k, Math.sin(Math.PI * k) * 14]; };
      sc.down = p => p > .8 ? ['rb', 'lb1'] : []; sc.fx = 'FUMBLE!'; sc.labels = [c];
    } else if (t === 'knee') { const qb = by.qb; sc.ball = () => [qb.bx + dir * 2, qb.by - 6, 0]; sc.down = p => p > .3 ? ['qb'] : []; sc.labels = [qb]; }
    else if (['punt', 'fg', 'pat', 'kickoff'].includes(t)) {
      const kt = t === 'kickoff' ? O[off] : off, kdir = kt === 'A' ? 1 : -1, KP = this.roles[kt].k;
      let kx, target, h;
      if (t === 'kickoff') { kx = wx(absY(kt, 35)); target = wx(absY(off, -5)); h = 70; }
      else if (t === 'punt') { kx = los - dir * 40; target = wx(absY(off, Math.min(105, x.s1))); h = 60; }
      else { kx = los - dir * 56; target = dir > 0 ? 956 : 4; h = 50; }
      const k = by.rb; k.team = kt; k.bx = kx - kdir * 16; k.by = MID; k.face = kdir; setName(k, KP);
      k.f = p => [lerp(k.bx, kx, ease(cl(p / .3))), MID];
      by.qb.f = () => [t === 'kickoff' ? -999 : kx + kdir * 4, MID + 8];
      if (t === 'kickoff') A.forEach(a => { if (a.id !== 'rb' && a.id !== 'qb') { const isK = a.team === kt; a.bx = isK ? kx - kdir * 4 : target + kdir * 40; a.f = p => [isK ? lerp(a.bx, a.bx + kdir * 120, ease(cl((p - .2) / .8))) : a.bx, a.by]; } });
      const kick = t === 'fg' || t === 'pat';
      sc.ball = p => { if (p < .3) return [kx + kdir * 3, MID - 2, 0]; const q = cl((p - .3) / .6); return [lerp(kx, target, q), lerp(MID - 2, MID - (kick ? 18 : 0), q), Math.sin(Math.PI * Math.min(1, q * (kick ? .8 : 1))) * h]; };
      sc.fx = t === 'kickoff' ? 'TOUCHBACK' : t === 'punt' ? (x.text.includes('Touchback') ? 'TOUCHBACK' : 'FAIR CATCH') : /NO GOOD/.test(x.text) ? 'NO GOOD!' : "IT'S GOOD!";
      sc.labels = [k]; sc.camBall = true;
    } else if (t === 'celebrate') {
      const prev = this.S[i - 1], pv = prev ? this.parse(prev) : {}, c = by.rb;
      c.bx = wx(absY(off, 104)); c.by = MID; c.f = p => [c.bx, c.by - (Math.floor(p * 8) % 2 ? 6 : 0)]; setName(c, pv.who || this.roles[off].rb);
      A.forEach(a => { if (a.id !== 'rb') { a.bx = a.team === off ? c.bx - dir * (20 + hash(a.id) % 40) : c.bx - dir * (60 + hash(a.id) % 60); a.f = () => [a.bx, a.by]; } });
      sc.ball = p => [c.bx, c.by - 22 - (Math.floor(p * 8) % 2 ? 6 : 0), 0]; sc.fx = 'TOUCHDOWN!'; sc.cheer = true; sc.labels = [c]; sc.fireworks = true;
    } else if (t === 'half' || t === 'final') sc.noField = true;
    else { sc.ball = () => [by.qb.bx, MID - 8, 0]; }
    return sc;
  }
  // ---------- drawing
  guy(x, y, team, skin, face, frame, down) {
    const cx = this.cx; x = Math.round(x); y = Math.round(y); const c = COLORS[team], pat = frame ? SPR2 : SPR;
    cx.fillStyle = 'rgba(0,0,0,.35)'; cx.fillRect(x - 4, y, 9, 2);
    for (let r = 0; r < 12; r++) for (let k = 0; k < 8; k++) {
      const ch = pat[r][k]; if (ch === '.') continue;
      cx.fillStyle = ch === 'H' ? c.h : ch === 'M' ? '#bcbcbc' : ch === 'S' ? skin : ch === 'J' ? c.j : ch === 'N' ? c.n : ch === 'P' ? c.p : '#101010';
      const kk = face > 0 ? k : 7 - k;
      if (down) cx.fillRect(x - 6 + (face > 0 ? r : 11 - r), y - 8 + k, 1, 1); else cx.fillRect(x - 4 + kk, y - 12 + r, 1, 1);
    }
  }
  tag(txt, x, y, col) { const cx = this.cx; cx.font = `8px ${PIX}`; const w = Math.ceil(cx.measureText(txt).width) + 4; x = Math.max(1, Math.min(W - w - 1, Math.round(x - w / 2))); y = Math.max(10, Math.round(y)); cx.fillStyle = '#000'; cx.fillRect(x, y - 9, w, 10); cx.fillStyle = col; cx.fillText(txt, x + 2, y); }
  field(cam, now, cheer) {
    const cx = this.cx, ox = Math.round(cam - W / 2), T = this.g.teams;
    cx.fillStyle = '#202048'; cx.fillRect(0, 0, W, FY0);
    for (const [x, y, c] of this.crowd) { const sx = Math.round(x - ox * .6); if (sx < 0 || sx >= W) continue; const bob = cheer ? ((Math.floor(now / 120 + x) % 2) ? -1 : 0) : 0; cx.fillStyle = c; cx.fillRect(sx, Math.round(y) + bob, 2, 2); }
    cx.fillStyle = '#505050'; cx.fillRect(0, FY0 - 6, W, 6); cx.fillStyle = '#fcfcfc'; cx.fillRect(0, FY0 - 6, W, 1);
    for (let yd = -10; yd < 110; yd += 5) { const x0 = wx(yd) - ox, x1 = wx(yd + 5) - ox; if (x1 < 0 || x0 > W) continue; cx.fillStyle = yd < 0 ? COLORS.A.dk : yd >= 100 ? COLORS.B.dk : (Math.floor(yd / 5) % 2 ? '#00a800' : '#00b800'); cx.fillRect(x0, FY0, x1 - x0, FY1 - FY0); }
    cx.fillStyle = '#00a800'; cx.fillRect(0, FY1, W, H - FY1); cx.fillStyle = '#fcfcfc';
    for (let yd = 0; yd <= 100; yd += 5) { const x = wx(yd) - ox; if (x < -2 || x > W + 2) continue; cx.fillRect(x, FY0, yd % 50 === 0 ? 2 : 1, FY1 - FY0); }
    for (let yd = 1; yd < 100; yd++) { if (yd % 5 === 0) continue; const x = wx(yd) - ox; if (x < 0 || x > W) continue; cx.fillRect(x, MID - 22, 1, 3); cx.fillRect(x, MID + 22, 1, 3); }
    cx.font = `8px ${PIX}`;
    for (let yd = 10; yd < 100; yd += 10) { const x = wx(yd) - ox; if (x < -20 || x > W + 20) continue; const n = String(yd <= 50 ? yd : 100 - yd), w = cx.measureText(n).width; cx.fillText(n, Math.round(x - w / 2), FY0 + 16); cx.fillText(n, Math.round(x - w / 2), FY1 - 6); }
    const ez = (x0, txt) => { cx.save(); cx.translate(x0 - ox, MID); cx.rotate(-Math.PI / 2); cx.font = `8px ${PIX}`; const t = txt.length > 16 ? txt.slice(0, 15) + '…' : txt; const w = cx.measureText(t).width; cx.fillStyle = 'rgba(252,252,252,.85)'; cx.fillText(t, -w / 2, 4); cx.restore(); };
    ez(40, T.A.name.toUpperCase()); ez(920, T.B.name.toUpperCase());
    for (const gx of [4, 956]) { const x = gx - ox; if (x < -20 || x > W + 20) continue; cx.fillStyle = '#fcd800'; cx.fillRect(x, MID - 20, 2, 28); cx.fillRect(x - 1, MID - 22, 4, 2); cx.fillRect(x - 1, MID - 34, 1, 14); cx.fillRect(x + 2, MID - 34, 1, 14); }
    return ox;
  }
  draw(sc, p, now) {
    const cx = this.cx, T = this.g.teams;
    if (sc && sc.noField) {
      cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H); const x = sc.x, t = x.kind === 'final' ? 'FINAL' : 'HALFTIME';
      cx.font = `16px ${PIX}`; cx.fillStyle = '#f8b800'; let w = cx.measureText(t).width; cx.fillText(t, (W - w) / 2, 52);
      [['A', x.sc.A], ['B', x.sc.B]].forEach(([s, v], j) => { cx.font = `8px ${PIX}`; cx.fillStyle = COLORS[s].ui; const n = T[s].name.toUpperCase(); cx.fillText(n.length > 22 ? n.slice(0, 21) + '…' : n, 24, 92 + j * 24); cx.font = `16px ${PIX}`; const vs = String(v); cx.fillText(vs, W - 24 - cx.measureText(vs).width, 96 + j * 24); });
      cx.font = `8px ${PIX}`; cx.fillStyle = '#a4a4d8'; const f = `FANTASY ${x.fa.toFixed(2)} - ${x.fb.toFixed(2)}`; w = cx.measureText(f).width; cx.fillText(f, (W - w) / 2, 156); return;
    }
    const ball = sc && sc.ball ? sc.ball(p) : [wx(50), MID - 6, 0];
    const target = sc && sc.camBall ? ball[0] : (sc && sc.carrier ? sc.carrier.f(p)[0] : ball[0]);
    this.cam = lerp(this.cam, Math.max(W / 2, Math.min(960 - W / 2, target)), this.reduce ? 1 : .12);
    const ox = this.field(this.cam, now, sc && sc.cheer);
    if (!sc) return;
    const x = sc.x;
    if (p === 0 && x.down && ['play', 'td', 'sack'].includes(x.kind)) {
      cx.fillStyle = '#3cbcfc'; cx.fillRect(wx(absY(x.off, x.s0)) - ox, FY0, 2, FY1 - FY0);
      if (x.togo != null && x.s0 + x.togo < 100) { cx.fillStyle = '#fcd800'; cx.fillRect(wx(absY(x.off, x.s0 + x.togo)) - ox, FY0, 2, FY1 - FY0); }
    }
    const downs = sc.down ? sc.down(p) : [], run = Math.floor(now / 110) % 2;
    sc.A.map(a => { const [px, py] = a.f(p); return { a, px, py }; }).filter(o => o.px > -500).sort((m, n) => m.py - n.py)
      .forEach(o => this.guy(o.px - ox, o.py, o.a.team, o.a.skin, o.a.face, p > 0 && p < 1 ? run : 0, downs.includes(o.a.id)));
    const [bx, by, bh] = ball;
    cx.fillStyle = 'rgba(0,0,0,.35)'; if (bh > 2) cx.fillRect(Math.round(bx - ox - 1), Math.round(by + 8), 3, 1);
    cx.fillStyle = '#a85000'; cx.fillRect(Math.round(bx - ox - 2), Math.round(by - bh), 4, 3); cx.fillStyle = '#fcfcfc'; cx.fillRect(Math.round(bx - ox - 1), Math.round(by - bh + 1), 2, 1);
    for (const a of sc.labels || []) { if (!a.name) continue; const [lx, ly] = a.f(p); this.tag(`${a.num ? '#' + a.num + ' ' : ''}${a.name.toUpperCase()}`, lx - ox, ly - 16, COLORS[a.team].ui); }
    const big = sc.fx || (sc.td && p > .92 ? 'TOUCHDOWN!' : null);
    if (big && (p > .8 || sc.act.type === 'celebrate')) {
      const blink = Math.floor(now / 180) % 2 || this.reduce; cx.font = `16px ${PIX}`; const w = cx.measureText(big).width;
      const good = /^(TOUCH|IT'S|GOOD|FAIR)/.test(big);
      cx.fillStyle = '#000'; cx.fillRect((W - w) / 2 - 6, 58, w + 12, 26); cx.fillStyle = blink ? (good ? '#fcd800' : '#f83800') : '#fcfcfc'; cx.fillText(big, (W - w) / 2, 78);
    }
    if (sc.fireworks && !this.reduce) {
      if (Math.random() < .15) this.sparks.push({ x: 20 + Math.random() * 280, y: 20 + Math.random() * 60, t: now, c: ['#f83800', '#fcd800', '#3cbcfc', '#fcfcfc'][Math.floor(Math.random() * 4)] });
      this.sparks = this.sparks.filter(s => now - s.t < 700);
      for (const s of this.sparks) { const r = (now - s.t) / 700 * 18; cx.fillStyle = s.c; for (let j = 0; j < 8; j++) { const an = j * Math.PI / 4; cx.fillRect(Math.round(s.x + Math.cos(an) * r), Math.round(s.y + Math.sin(an) * r), 2, 2); } }
    }
  }
}
