import { W, H, C, GW, GH, IW, IH, IC, DT, BUDGET, COST, T_GROUND, PLATOONS, unitKind, PHASES, PHASE_LEN, HQ_HOLD, K, COV, KIND_NAME, SPY_RADIUS, T_ROAD, T_BRIDGE, T_WOOD, T_BUILD, T_WATER, clamp, grid } from './config';
import { S, M, OWN, VIS0, SEEN0, NET, hooks } from './state';
import { cellOf, unitH, passable, nudge, opRange } from './world';
import { aliveMembers, spentNow, sqName, nextCall, rollPersonalities, initOwn } from './plan';
import { aiPlan } from './ai';
import { BTYPES } from './map/btypes';

let rnd = Math.random;
const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v); };

// team -1 is a message for everyone.
export function log(team: number, msg: string) { S.log.unshift({ t: S.t, team, msg }); if (S.log.length > 400) S.log.pop(); S.logDirty = true; }
export const income = (t: number) => S.teams[t].lost ? 0 : 200 + Math.round((S.terrCount[t] || 0) * 1.2);

export function newBattle() {
  if (M) { M.terr.set(M.terr0); M.deck.set(M.deck0); M.bridges.forEach(b => b.blown = null); M.bldId.set(M.bldId0); M.bldTop.set(M.bldTop0); for (const b of M.B) { b.hp = b.hp0; b.down = null; } }
  Object.assign(S, { phase: 'plan', round: 1, t: 0, units: [], shells: [], bombs: [], fx: [], tracers: [], craters: [], planes: [], cover: null, rec: null, result: null, log: [], stats: [], history: [], callN: [], vis: [], known: [], contactT: [], squads: [], structs: [], supports: [], sel: null, selMany: [] });
  S.bank = S.teams.map(() => BUDGET); SEEN0.fill(0); S.visG = null;
  for (const t of S.teams) { t.lost = false; t.hqHold = 0; t.hqBy = -1; } S.hqKnown = S.teams.map((t: any) => new Set([t.id]));
  rollPersonalities(); initOwn(); countGround(); updateVision();
  for (const t of S.teams) if (!t.human) aiPlan(t.id);
  hooks.ground(); hooks.sync();
}

export function beginRound() {
  if (S.round === 1) {
    Object.assign(S, { t: 0, units: [], shells: [], bombs: [], fx: [], tracers: [], craters: [], planes: [], flow: new Map(), log: [], history: [] });
    rnd = Math.random; S.cover = new Uint8Array(GW * GH); S.stats = S.teams.map(() => ({ kills: 0, lost: 0, start: 0, roundKills: 0 }));
    S.known = S.teams.map(() => new Map()); S.contactT = S.teams.map(() => new Map());
    S.rec = { frames: [], tracers: [], booms: [], shells: [], planes: [], phases: [], moments: [], downs: [], own: [{ t: 0, o: OWN.slice() }], meta: null };
  }
  for (const t of S.teams) S.bank[t.id] -= spentNow(t.id);
  S.phaseStart = S.t; S.flow.clear(); S.rec.phases.push({ round: S.round, t: S.t });
  for (const s of S.structs) if (s.round === S.round) { for (const ci of s.cells) S.cover[ci] = COV[s.type]; s.placedAt = S.t; }
  for (const sq of S.squads) {
    if (!sq.members) { if (sq.round === S.round) spawnSquad(sq); }
    else if (sq.order) { sq.state = sq.order.type; sq.tx = sq.order.x; sq.ty = sq.order.y; sq.dir = sq.order.dir ?? sq.dir; sq.dbridge = sq.order.bridge; sq.dbld = sq.order.bld; sq.planted = null; faceMembers(sq); sq.arrived = -1; sq.contact = S.t; assignSlots(sq); }
  }
  for (const sq of S.squads) if (sq.order) { if (sq.members && sq.order.type === 'attack') log(sq.team, `${sqName(sq)}: moving on ${grid(sq.order.x, sq.order.y)}`); sq.cur = sq.order; sq.order = null; }
  for (const su of S.supports) if (su.round === S.round) su.fired = false;
  for (const st of S.stats) st.roundKills = st.kills;
  S.phase = 'battle'; S.paused = false; log(-1, `Phase ${S.round} begins`);
  updateVision(); recFrame();
  hooks.banner(`PHASE ${S.round}`, S.round === 1 ? 'Plans locked' : 'Reinforcements in'); S.sel = null; S.selMany = []; hooks.sync();
}
// Things bought or ordered during a phase act at once. The cost comes straight off the bank.
export function goLive(it: any) {
  if (!it) return; it.live = true;
  if (it.pos) { S.bank[it.team] -= COST[it.kind]; spawnSquad(it); }
  else if (it.cells) { S.bank[it.team] -= it.cells.length * COST[it.type]; for (const ci of it.cells) S.cover[ci] = COV[it.type]; it.placedAt = S.t; S.flow.clear(); }
  else { S.bank[it.team] -= COST[it.type]; it.t = S.t - S.phaseStart + 3; it.fired = false; }
}
export function applyOrder(sq: any) {
  if (!sq.members || !sq.order) return; const o = sq.order;
  sq.state = o.type; sq.tx = o.x; sq.ty = o.y; sq.dir = o.dir ?? sq.dir; sq.dbridge = o.bridge; sq.dbld = o.bld; sq.planted = null; faceMembers(sq); sq.arrived = -1; sq.contact = S.t; assignSlots(sq); sq.cur = o; sq.order = null;
  if (o.type === 'attack') log(sq.team, `${sqName(sq)}: moving on ${grid(o.x, o.y)}`);
}
const INFANTRY = new Set(['rifle', 'assault', 'engineer', 'medic', 'sniper']);
// Medics: a soldier within 18 of a living medic of his side survives a fatal wound one time in three.
function saved(v: any) {
  if (!INFANTRY.has(v.kind)) return false;
  for (const m of S.units) if (m.alive && m.kind === 'medic' && m.team === v.team && m !== v && Math.abs(m.x - v.x) < 18 && Math.abs(m.y - v.y) < 18 && Math.hypot(m.x - v.x, m.y - v.y) < 18) { if (rnd() < .33) { v.hp = 1; return true; } return false; }
  return false;
}
function faceMembers(sq: any) { if (sq.members && sq.dir != null) for (const i of sq.members) S.units[i].face = sq.dir; }
// A unit with an arc (the sniper) sees and shoots only inside the cone it faces.
export function inArc(u: any, x: number, y: number) {
  const a = K[u.kind] && K[u.kind].arc; if (!a || u.face == null) return true;
  let d = Math.atan2(y - u.y, x - u.x) - u.face; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) <= a / 2;
}
// Engineers walk to the target, set charges, and the target blows 5 seconds later.
function demolishStep(sq: any) {
  const mem = aliveMembers(sq); if (!mem.length) return;
  const near = mem.some((u: any) => Math.hypot(u.x - sq.tx, u.y - sq.ty) < 9);
  if (!near) return;
  if (sq.planted == null) { sq.planted = S.t; log(sq.team, `${sqName(sq)}: charges set at ${grid(sq.tx, sq.ty)}`); return; }
  if (S.t - sq.planted < 5) return;
  if (sq.dbridge != null) blowBridge(sq.dbridge, sq.team);
  else if (sq.dbld != null && M.B[sq.dbld] && M.B[sq.dbld].down == null) { const b = M.B[sq.dbld]; for (let k = 0; k < 4; k++) explode(b.cx + (rnd() - .5) * 4, b.cy + (rnd() - .5) * 4, 6, .9, sq.team); collapse(sq.dbld, sq.team); }
  sq.state = 'defend'; sq.planted = null; sq.dbridge = sq.dbld = undefined; assignSlots(sq);
}
function snapshotHistory() { S.history.push({ round: S.round, terr: S.terrCount.slice(), alive: S.teams.map((t: any) => S.units.filter((u: any) => u.alive && u.team === t.id).length) }); }
function endRound() {
  recFrame(); captureGround(false); snapshotHistory();
  if (S.round >= PHASES) { finish(true); return; }
  for (const t of S.teams) S.bank[t.id] += income(t.id);
  S.round++; S.phase = 'plan'; log(-1, `Phase ${S.round - 1} over`);
  updateVision();
  for (const t of S.teams) if (!t.human && !t.lost) aiPlan(t.id);
  hooks.banner(`PHASE ${S.round - 1} OVER`, 'Briefing: reinforce and give new orders'); S.tool = 'select'; S.sel = null; hooks.sync();
}

function spawnSquad(sq: any, drop?: boolean) {
  sq.members = []; const kind = unitKind(sq.kind);
  for (const p of sq.pos) {
    const k = K[kind];
    const u = { i: S.units.length, x: p[0], y: p[1], team: sq.team, sq: sq.id, kind, hp: k.hp, cd: rnd() * 1.2, scan: rnd() * .4, tgt: -1, sx: p[0], sy: p[1], alive: true, kills: 0, gar: sq.kind === 'garrison', hd: Math.atan2(-(H / 2 - p[1]), W / 2 - p[0]), drop: drop ? 1.2 + rnd() * .6 : 0 };
    sq.members.push(S.units.length); S.units.push(u); S.stats[sq.team].start++;
  }
  const o = sq.order; sq.state = o ? o.type : 'hold'; sq.tx = o ? o.x : sq.x; sq.ty = o ? o.y : sq.y; sq.dir = o && o.dir != null ? o.dir : sq.face; sq.dbridge = o ? o.bridge : undefined; sq.dbld = o ? o.bld : undefined; sq.planted = null; faceMembers(sq); sq.contact = S.t; sq.arrived = -1; assignSlots(sq);
}
function assignSlots(sq: any) {
  const mem = aliveMembers(sq); if (!mem.length) return;
  // Facing: the order's direction, else the way from the unit to the target.
  const c0x = mem.reduce((a: number, u: any) => a + u.x, 0) / mem.length, c0y = mem.reduce((a: number, u: any) => a + u.y, 0) / mem.length;
  const face = sq.dir != null ? sq.dir : Math.atan2(sq.ty - c0y, sq.tx - c0x), fx = Math.cos(face), fy = Math.sin(face);
  if (sq.state === 'attack' || sq.state === 'demolish') {
    // A line across the facing direction: eight wide, ranks behind.
    let i = 0; for (const u of mem) { const col = i % 8 - 3.5, row = Math.floor(i / 8); i++; const q = nudge(sq.tx - fy * col * 2.4 - fx * row * 2.6, sq.ty + fx * col * 2.4 - fy * row * 2.6) || [sq.tx, sq.ty]; u.sx = q[0]; u.sy = q[1]; u.hd = Math.atan2(-fy, fx); }
    return;
  }
  const cells: number[][] = [], r = 16, c0 = Math.floor(sq.tx / C), r0 = Math.floor(sq.ty / C), rc = Math.ceil(r / C);
  for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const cx = c0 + dx, cy = r0 + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue; const ci = cy * GW + cx, c = S.cover[ci]; if ((c === 1 || c === 2) && Math.hypot(dx, dy) * C <= r) cells.push([ci, Math.hypot(dx, dy)]); }
  // Cover on the facing side comes first.
  for (const c of cells) { const px = (c[0] % GW) * C + 1 - sq.tx, py = Math.floor(c[0] / GW) * C + 1 - sq.ty; c[1] -= (px * fx + py * fy) / C * .6; }
  cells.sort((a, b) => a[1] - b[1]);
  mem.forEach((u: any, i: number) => {
    if (i < cells.length) { const pick = cells[Math.floor(i * cells.length / mem.length)][0]; u.sx = (pick % GW) * C + 1 + (rnd() - .5) * .6; u.sy = Math.floor(pick / GW) * C + 1 + (rnd() - .5) * .6; }
    else { const a = rnd() * 6.28, d = 2 + rnd() * 8; const q = nudge(sq.tx + Math.cos(a) * d, sq.ty + Math.sin(a) * d) || [u.x, u.y]; u.sx = q[0]; u.sy = q[1]; }
  });
}
// One shared path field per destination (and per vehicle class), reused by every unit going there.
function flowFor(x: number, y: number, veh?: boolean) {
  const t = nudge(x, y); if (!t) return null; const tc = cellOf(t[0], t[1]), key = tc * 2 + (veh ? 1 : 0);
  let f = S.flow.get(key); if (f) return f; if (S.flow.size > 80) S.flow.clear();
  f = new Uint16Array(GW * GH).fill(65535); const q = new Int32Array(GW * GH); let h = 0, tl = 0; f[tc] = 0; q[tl++] = tc;
  while (h < tl) {
    const c = q[h++], cx = c % GW, cy = (c / GW) | 0, d = f[c] + 1;
    if (cx > 0) { const n = c - 1; if (f[n] === 65535 && passable(n, veh)) { f[n] = d; q[tl++] = n; } }
    if (cx < GW - 1) { const n = c + 1; if (f[n] === 65535 && passable(n, veh)) { f[n] = d; q[tl++] = n; } }
    if (cy > 0) { const n = c - GW; if (f[n] === 65535 && passable(n, veh)) { f[n] = d; q[tl++] = n; } }
    if (cy < GH - 1) { const n = c + GW; if (f[n] === 65535 && passable(n, veh)) { f[n] = d; q[tl++] = n; } }
  }
  S.flow.set(key, f); return f;
}
// Sight is blocked by ground that rises above the line, by buildings taller than the line,
// by walls, and by more than 12 of woods. A unit inside a building sees out of its own building.
export function los(ax: number, ay: number, bx: number, by: number) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 1.5), ha = unitH(ax, ay) + 1.4, hb = unitH(bx, by) + 1.4;
  const ca = cellOf(ax, ay), cb = cellOf(bx, by), ia = ca >= 0 ? M.bldId[ca] : -1, ib = cb >= 0 ? M.bldId[cb] : -1; let wood = 0;
  for (let i = 1; i < n; i++) {
    const f = i / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, ci = cellOf(x, y); if (ci < 0) continue;
    const lh = ha + (hb - ha) * f, t = M.terr[ci], g = M.hAt(x, y);
    if (t === T_BUILD) { const id = M.bldId[ci]; if (id >= 0 && (id === ia || id === ib)) continue; if (M.bldTop[ci] > lh) return false; continue; }
    if (S.cover && S.cover[ci] === 3 && lh < g + 2.6) return false;
    if (g > lh + .2) return false;
    if (t === T_WOOD && lh < g + 5) { wood += 1.5; if (wood > 12) return false; }
  }
  return true;
}
function coverAt(u: any) { if (u.gar) { const b = M.B[M.bldId[cellOf(u.x, u.y)]]; return (b && BTYPES[b.btype || 'house'].cover) || .85; } const ci = cellOf(u.x, u.y); if (ci < 0) return 0; const c = S.cover[ci]; if (c === 2) return .7; if (c === 1) return .5; if (M.terr[ci] === T_WOOD) return .35; const t = M.terr; if ((ci % GW > 0 && t[ci - 1] === T_BUILD) || (ci % GW < GW - 1 && t[ci + 1] === T_BUILD) || t[ci - GW] === T_BUILD || t[ci + GW] === T_BUILD) return .3; return 0; }
// AT guns shoot only tanks, small arms ignore tanks, tanks shoot anything. Woods make targets harder to see.
function findTarget(u: any, range: number) {
  let best = -1, bd = range * range; const U = S.units, wantTank = u.kind === 'at', any = u.kind === 'tank';
  for (let j = 0; j < U.length; j++) {
    const e = U[j]; if (!e.alive || e.team === u.team || e.drop > 0) continue; const isT = e.kind === 'tank';
    if (wantTank ? !isT : (!any && isT)) continue;
    const dx = e.x - u.x, dy = e.y - u.y; let d = dx * dx + dy * dy; const ce = cellOf(e.x, e.y); if (ce >= 0 && M.terr[ce] === T_WOOD && !isT) d *= 2.8;
    if (d < bd && inArc(u, e.x, e.y) && los(u.x, u.y, e.x, e.y)) { bd = d; best = j; }
  }
  return best;
}
function kill(v: any, team: number) {
  if (!v.alive) return; v.alive = false; S.stats[v.team].lost++; if (team !== v.team && team >= 0) S.stats[team].kills++;
  // Teams that see the unit fall learn it is gone; the others still think it is there.
  S.teams.forEach((t: any) => { if (S.vis[t.id] && S.vis[t.id][v.i] && S.known[t.id]) S.known[t.id].delete(v.i); });
  if (['mg', 'mortar', 'tank', 'at', 'op', 'sniper'].includes(v.kind)) log(v.team, `${S.teams[v.team].name} ${KIND_NAME[v.kind] || v.kind} lost at ${grid(v.x, v.y)}`);
  const sq = S.squads.find((s: any) => s.id === v.sq);
  if (sq && PLATOONS.includes(sq.kind)) { const alive = aliveMembers(sq).length; if (!sq.halfLogged && alive <= sq.members.length / 2 && alive > 0) { sq.halfLogged = true; log(v.team, `${sqName(sq)}: taking heavy losses at ${grid(v.x, v.y)}`); } if (alive === 0) log(v.team, `${sqName(sq)}: no reply`); }
}
function contact(sq: any) { if (sq) sq.contact = S.t; }
function tankFire(u: any, e: any, k: any) {
  const d = Math.hypot(e.x - u.x, e.y - u.y), hit = rnd() < k.acc * (1 - .5 * d / k.range), x = hit ? e.x : e.x + gauss() * 4, y = hit ? e.y : e.y + gauss() * 4;
  S.tracers.push({ x0: u.x, y0: u.y, x1: x, y1: y, life: .15, team: u.team, u: u.i }); S.rec.tracers.push([S.t, u.x, u.y, x, y, u.team, u.i]);
  if (hit && e.kind === 'tank') { e.hp -= 3; if (e.hp <= 0) { kill(e, u.team); u.kills++; } } else explode(x, y, 3.5, .75, u.team);
  contact(S.squads.find((s: any) => s.id === u.sq));
}
function shoot(u: any, e: any, k: any) {
  u.hd = Math.atan2(-(e.y - u.y), e.x - u.x); if (u.kind === 'tank') { tankFire(u, e, k); return; }
  const tr = { x0: u.x, y0: u.y, x1: e.x + (rnd() - .5) * 2, y1: e.y + (rnd() - .5) * 2, life: .09, team: u.team, u: u.i };
  S.tracers.push(tr); if (S.rec.tracers.length < 150000) S.rec.tracers.push([S.t, tr.x0, tr.y0, tr.x1, tr.y1, u.team, u.i]);
  const d = Math.hypot(e.x - u.x, e.y - u.y), hb = clamp((unitH(u.x, u.y) - unitH(e.x, e.y)) * .02, 0, .15), p = (k.acc + hb) * (1 - coverAt(e)) * (1 - .5 * d / k.range);
  if (rnd() < p) { e.hp -= u.kind === 'at' ? 4 : 1; if (e.hp <= 0 && !saved(e)) { kill(e, u.team); u.kills++; } }
  contact(S.squads.find((s: any) => s.id === u.sq));
}
// A building brought down: its cells become rubble (open ground with light cover), and anyone inside dies.
// The guest calls this too when the host reports a collapse, with kills turned off.
export function collapse(id: number, team: number, kills = true) {
  const b = M.B[id]; if (!b || b.down != null) return; b.down = S.t;
  for (const ci of b.cells) { M.terr[ci] = T_GROUND; M.bldTop[ci] = 0; M.bldId[ci] = -1; if (S.cover) S.cover[ci] = 1; }
  if (kills) for (const u of S.units) if (u.alive && u.gar && b.cells.includes(cellOf(u.x, u.y))) kill(u, team);
  S.flow.clear(); if (S.rec) S.rec.downs.push([S.t, id]);
  if (kills && (b.name || b.btype && b.btype !== 'house' || S.squads.some((s: any) => s.bld === id))) log(-1, `${b.name || BTYPES[b.btype || 'house'].label} at ${grid(b.cx, b.cy)} destroyed`);
}
function damageBuildings(x: number, y: number, r: number, power: number, team: number) {
  const hit = new Map<number, number>(), c0 = Math.floor(x / C), r0 = Math.floor(y / C), rc = Math.ceil(r / C);
  for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
    const cx = c0 + dx, cy = r0 + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue; const id = M.bldId[cy * GW + cx]; if (id < 0) continue;
    const d = Math.hypot(dx, dy) * C; if (d <= r && (!hit.has(id) || d < hit.get(id))) hit.set(id, d);
  }
  hit.forEach((d, id) => { const b = M.B[id]; b.hp -= power * 8 * (1 - d / r * .7); if (b.hp <= 0) collapse(id, team); });
}
function explode(x: number, y: number, r: number, power: number, team: number) {
  damageBuildings(x, y, r, power, team);
  S.fx.push({ x, y, r, life: .6, max: .6 }); S.craters.push({ x, y, r: r * .55 }); if (S.craters.length > 600) S.craters.shift(); S.rec.booms.push([S.t, x, y, r]);
  for (const v of S.units) {
    if (!v.alive || v.drop > 0) continue; const d = Math.hypot(v.x - x, v.y - y); if (d > r) continue;
    if (v.kind === 'tank') { if (d < r * .5 && rnd() < power) { v.hp -= 3; if (v.hp <= 0) kill(v, team); } continue; }
    const ci = cellOf(v.x, v.y), cov = v.gar ? .5 : ci >= 0 && S.cover[ci] === 2 ? .55 : ci >= 0 && S.cover[ci] === 1 ? .3 : 0;
    if (rnd() < power * (1 - d / r * .6) * (1 - cov)) { v.hp -= 2; if (v.hp <= 0 && !saved(v)) kill(v, team); }
  }
}
function addShell(s: any) { S.shells.push(s); S.rec.shells.push([S.t - s.t, s.x0, s.y0, s.x1, s.y1, s.dur]); }
// Mortars fire only at enemies their side can see now.
function mortarTarget(u: any) {
  let best = -1, bd = 1e9; const U = S.units, k = K.mortar, vis = S.vis[u.team];
  for (let j = 0; j < U.length; j++) {
    const e = U[j]; if (!e.alive || e.team === u.team || e.drop > 0 || !vis || !vis[j]) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y); if (d < k.min || d > k.range || d >= bd) continue; bd = d; best = j;
  }
  return best;
}
function moveUnit(u: any, k: any, sq: any) {
  const dx = u.sx - u.x, dy = u.sy - u.y, ds = Math.hypot(dx, dy); if (ds < .5) return;
  const ci = cellOf(u.x, u.y), cov = ci >= 0 ? S.cover[ci] : 0, tt = ci >= 0 ? M.terr[ci] : 0;
  let sp = k.speed * DT * (k.veh ? (tt === T_ROAD || tt === T_BRIDGE ? 1.5 : tt === T_WOOD ? .5 : cov === 2 ? .7 : 1) : (cov === 2 ? .6 : cov === 4 ? .33 : tt === T_WOOD ? .85 : 1));
  let tx = u.sx, ty = u.sy;
  const f = ds > 10 ? flowFor(sq.tx, sq.ty, k.veh) : null;
  if (f && ci >= 0 && f[ci] !== 65535 && f[ci] > 3) {
    let best = f[ci], bc = -1; const cx = ci % GW, cy = (ci / GW) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue; const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (f[n] < best && (ox === 0 || oy === 0 || (passable(cy * GW + nx, k.veh) && passable(ny * GW + cx, k.veh)))) { best = f[n]; bc = n; }
    }
    if (bc >= 0) { tx = (bc % GW) * C + 1 + ((u.sx * 7.3) % 1 - .5) * 1.2; ty = ((bc / GW) | 0) * C + 1 + ((u.sy * 5.1) % 1 - .5) * 1.2; }
  }
  const mx = tx - u.x, my = ty - u.y, ml = Math.hypot(mx, my) || 1; sp = Math.min(sp, ml);
  const nx = u.x + mx / ml * sp, ny = u.y + my / ml * sp;
  if (passable(cellOf(nx, ny), k.veh) || !passable(ci, k.veh)) { u.hd = Math.atan2(-(ny - u.y), nx - u.x); u.x = nx; u.y = ny; }
  else { u.x += (rnd() - .5) * .4; u.y += (rnd() - .5) * .4; }
}
function updateSquads() {
  for (const sq of S.squads) {
    if (sq.members && sq.state === 'demolish') demolishStep(sq);
    if (!sq.members || sq.state !== 'attack') continue; const mem = aliveMembers(sq); if (!mem.length) continue;
    const near = mem.filter((u: any) => Math.hypot(u.x - sq.tx, u.y - sq.ty) < 12).length;
    if (near >= mem.length * .5) { sq.state = 'defend'; sq.arrived = S.t; log(sq.team, `${sqName(sq)}: objective ${grid(sq.tx, sq.ty)} reached, digging in`); assignSlots(sq); }
  }
}
function launchSupport(su: any) {
  const T = S.teams[su.team], z = T.zone;
  if (su.type === 'barrage') {
    const sc = S.units.some((f: any) => f.alive && f.team === su.team && f.kind === 'op' && Math.hypot(f.x - su.a.x, f.y - su.a.y) < opRange(f)) ? 4.5 : 8;
    for (let i = 0; i < 12; i++) addShell({ x0: z.x, y0: z.y, x1: su.a.x + gauss() * sc, y1: su.a.y + gauss() * sc, t: -i * .45, dur: 2.2, team: su.team, r: 7, power: .9 });
    log(su.team, `${T.name} artillery: shot, over, on ${grid(su.a.x, su.a.y)}`);
  } else if (su.type === 'demo') { if (su.bld != null) { const b = M.B[su.bld]; for (let k = 0; k < 4; k++) explode(b.cx + (rnd() - .5) * 4, b.cy + (rnd() - .5) * 4, 6, .9, su.team); collapse(su.bld, su.team); } else blowBridge(su.bridge, su.team); }
  else {
    const line = su.type === 'air' || su.type === 'spy';
    const tx = line ? su.b.x : su.a.x, ty = line ? su.b.y : su.a.y, ax = line ? su.a.x : z.x, ay = line ? su.a.y : z.y;
    let ux = tx - ax, uy = ty - ay; const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
    const speed = su.type === 'air' ? 95 : su.type === 'spy' ? 110 : 70;
    const p = { kind: su.type, team: su.team, ax, ay, ux, uy, len, s: su.type === 'para' ? -40 : -70, next: 0, tx: su.a.x, ty: su.a.y, speed, seen: new Set() };
    S.planes.push(p); S.rec.planes.push({ t0: S.t, s0: p.s, ax, ay, ux, uy, len, speed, kind: su.type, team: su.team });
    log(su.team, `${T.name} ${su.type === 'air' ? 'air strike' : su.type === 'spy' ? 'spy plane' : 'paradrop'} inbound to ${grid(tx, ty)}`);
  }
}
function blowBridge(i: number, team: number) {
  const br = M.bridges[i]; if (!br || br.blown != null) return; br.blown = S.t;
  for (const ci of br.cells) { M.terr[ci] = T_WATER; M.deck[ci] = -99; } S.flow.clear();
  for (let k = 0; k < br.cells.length; k += 3) { const c = br.cells[k]; explode((c % GW) * C + 1, Math.floor(c / GW) * C + 1, 6, .9, team); }
  for (const u of S.units) if (u.alive && M.terr[cellOf(u.x, u.y)] === T_WATER) kill(u, team);
  log(team, `${S.teams[team].name} engineers: bridge at ${grid(br.cx, br.cy)} blown`); S.rec.moments.push({ t: S.t, x: br.cx, y: br.cy, big: false });
}
function dropPara(pl: any) {
  const pos: number[][] = []; for (let i = 0; i < 16; i++) { const a = rnd() * 6.28, d = rnd() * 9; const q = nudge(pl.tx + Math.cos(a) * d, pl.ty + Math.sin(a) * d); if (q) pos.push(q); }
  if (!pos.length) return;
  const sq: any = { id: S.nextId++, team: pl.team, kind: 'rifles', x: pl.tx, y: pl.ty, pos, order: { type: 'defend', x: pl.tx, y: pl.ty }, temp: true, round: S.round, call: nextCall(pl.team) };
  S.squads.push(sq); spawnSquad(sq, true); sq.cur = sq.order; sq.order = null;
}
function recFrame() {
  const U = S.units, n = U.length, xy = new Float32Array(n * 2), al = new Uint8Array(n), v0 = S.vis[0];
  for (let i = 0; i < n; i++) { const u = U[i]; xy[i * 2] = u.x; xy[i * 2 + 1] = u.y; al[i] = (u.alive ? (u.drop > 0 ? 2 : 1) : 0) | (v0 && v0[i] ? 4 : 0); }
  S.rec.frames.push({ t: S.t, n, xy, al, vis0: VIS0.slice() });
}

// Who sees whom. A unit sees an enemy inside its sight range with a clear line of sight.
// Troops in woods are seen only at half range. A spy plane sees everything near its path.
const sightOf = (u: any) => { if (u.kind === 'op') return opRange(u); let s = K[u.kind].sight; if (u.gar) { const b = M.B[M.bldId[cellOf(u.x, u.y)]]; s += 15 + ((b && BTYPES[b.btype || 'house'].sight) || 0); } return s; };
function spyPos(p: any) { return p.kind === 'spy' && p.s > -10 && p.s < p.len + 10 ? [p.ax + p.ux * p.s, p.ay + p.uy * p.s] : null; }
export function updateVision() {
  const U = S.units, N = S.teams.length, newContacts = S.teams.map(() => new Map<string, number>()), contactAt: string[] = S.teams.map(() => '');
  for (let t = 0; t < N; t++) {
    const vis = new Uint8Array(U.length), own = U.filter((u: any) => u.alive && u.team === t && !(u.drop > 0));
    const spies = S.planes.filter((p: any) => p.team === t).map((p: any) => [p, spyPos(p)]).filter((q: any) => q[1]);
    if (!S.known[t]) S.known[t] = new Map(); if (!S.contactT[t]) S.contactT[t] = new Map();
    for (let j = 0; j < U.length; j++) {
      const e = U[j]; if (!e.alive || e.team === t || e.drop > 0) continue;
      let seen = false;
      for (const [p, sp] of spies) if (Math.hypot(e.x - sp[0], e.y - sp[1]) < SPY_RADIUS) { seen = true; p.seen.add(j); break; }
      if (!seen) {
        const ce = cellOf(e.x, e.y), hid = ce >= 0 && M.terr[ce] === T_WOOD && e.kind !== 'tank' ? .5 : 1;
        for (const o of own) { const R = sightOf(o) * hid, dx = o.x - e.x, dy = o.y - e.y; if (Math.abs(dx) < R && Math.abs(dy) < R && dx * dx + dy * dy < R * R && inArc(o, e.x, e.y) && los(o.x, o.y, e.x, e.y)) { seen = true; break; } }
      }
      if (!seen) continue;
      vis[j] = 1;
      if (S.teams[t].human && S.phase === 'battle') {
        const sq = S.squads.find((s: any) => s.id === e.sq), last = S.contactT[t].get(e.sq);
        if (sq && (last == null || S.t - last > 30)) { const k = KIND_NAME[sq.kind] || sq.kind; newContacts[t].set(k, (newContacts[t].get(k) || 0) + 1); if (!contactAt[t]) contactAt[t] = grid(e.x, e.y); }
        S.contactT[t].set(e.sq, S.t);
      }
      S.known[t].set(j, { x: e.x, y: e.y, kind: e.kind, team: e.team, t: S.t, i: j });
    }
    S.vis[t] = vis;
  }
  // A team learns where an enemy HQ is when its troops or planes see that spot.
  for (const t of S.teams) for (const o of S.teams) {
    if (o.id === t.id || o.lost || S.hqKnown[t.id].has(o.id)) continue; const hx = o.zone.x, hy = o.zone.y;
    const seen = U.some((u: any) => u.alive && u.team === t.id && !(u.drop > 0) && Math.hypot(u.x - hx, u.y - hy) < sightOf(u) && los(u.x, u.y, hx, hy))
      || S.planes.some((p: any) => { const sp = p.team === t.id && spyPos(p); return sp && Math.hypot(sp[0] - hx, sp[1] - hy) < SPY_RADIUS; });
    if (seen) { S.hqKnown[t.id].add(o.id); if (t.human) log(t.id, `${o.name} HQ found at ${grid(hx, hy)}`); }
  }
  // One radio line per sighting pass: "Contact near G2: 3 Platoon, MG nest".
  newContacts.forEach((m, t) => { if (m.size) log(t, `Contact near ${contactAt[t]}: ${[...m].map(([k, n]) => n > 1 ? `${n} ${k}` : k).join(', ')}`); });
  // The player's view of the ground: what their troops and planes can see, and their own ground.
  // Each team's view of the ground: what its troops and planes see now, plus its own ground.
  if (!S.visG || S.visG.length !== N) { S.visG = S.teams.map(() => new Uint8Array(IW * IH)); S.seenG = S.teams.map(() => new Uint8Array(IW * IH)); }
  for (let t = 0; t < N; t++) {
    const g = S.visG[t], seen = S.seenG[t]; g.fill(0);
    for (let i = 0; i < OWN.length; i++) if (OWN[i] === t) g[i] = 1;
    const mark = (x: number, y: number, R: number, u?: any) => {
      const r = R / IC, cx = x / IC, cy = y / IC;
      for (let gy = Math.max(0, Math.floor(cy - r)); gy <= Math.min(IH - 1, Math.ceil(cy + r)); gy++)
        for (let gx = Math.max(0, Math.floor(cx - r)); gx <= Math.min(IW - 1, Math.ceil(cx + r)); gx++)
          if ((gx + .5 - cx) ** 2 + (gy + .5 - cy) ** 2 <= r * r && (!u || inArc(u, (gx + .5) * IC, (gy + .5) * IC) || (gx + .5 - cx) ** 2 + (gy + .5 - cy) ** 2 < 4)) g[gy * IW + gx] = 1;
    };
    for (const u of U) if (u.alive && u.team === t && !(u.drop > 0)) mark(u.x, u.y, sightOf(u), u);
    for (const p of S.planes) { const sp = p.team === t && spyPos(p); if (sp) mark(sp[0], sp[1], SPY_RADIUS); }
    for (let i = 0; i < g.length; i++) if (g[i]) seen[i] = 1;
  }
  VIS0.set(S.visG[NET.me]); SEEN0.set(S.seenG[NET.me]);
  hooks.vision();
}

export function step() {
  S.t += DT; const U = S.units, pt = S.t - S.phaseStart;
  for (const su of S.supports) if (su.round === S.round && !su.fired && pt >= su.t) { su.fired = true; launchSupport(su); }
  for (let i = 0; i < U.length; i++) {
    const u = U[i]; if (!u.alive) continue; if (u.drop > 0) { u.drop -= DT; continue; }
    const k = K[u.kind]; u.cd -= DT; u.scan -= DT;
    if (u.kind === 'op') continue;
    if (u.kind === 'mortar') {
      if (u.cd <= 0 && u.scan <= 0) { u.scan = .6; const t = mortarTarget(u); if (t >= 0) { const e = U[t], d = Math.hypot(e.x - u.x, e.y - u.y); addShell({ x0: u.x, y0: u.y, x1: e.x + gauss() * 5, y1: e.y + gauss() * 5, t: 0, dur: .8 + d / 60, team: u.team, r: 6.5, power: .8 }); u.cd = k.cd * (.85 + rnd() * .3); } }
      continue;
    }
    if (u.scan <= 0) { u.scan = .35 + rnd() * .25; u.tgt = findTarget(u, k.range); }
    let e = u.tgt >= 0 ? U[u.tgt] : null; if (e && (!e.alive || Math.hypot(e.x - u.x, e.y - u.y) > k.range)) { e = null; u.tgt = -1; }
    if (e && u.cd <= 0) { shoot(u, e, k); u.cd = k.cd * (.7 + rnd() * .6); }
    if (k.speed > 0 && (!e || k.veh) && !u.gar) { const sq = S.squads.find((s: any) => s.id === u.sq); if (sq) moveUnit(u, k, sq); }
  }
  for (const s of S.shells) { s.t += DT; if (s.t >= s.dur && !s.done) { s.done = true; explode(s.x1, s.y1, s.r, s.power, s.team); } } S.shells = S.shells.filter((s: any) => !s.done);
  for (const b of S.bombs) { b.t -= DT; if (b.t <= 0 && !b.done) { b.done = true; explode(b.x, b.y, 9, .95, b.team); } } S.bombs = S.bombs.filter((b: any) => !b.done);
  for (const p of S.planes) {
    p.s += p.speed * DT;
    if (p.kind === 'air') { while (p.s >= p.next && p.next <= p.len) { S.bombs.push({ x: p.ax + p.ux * p.next + gauss() * 1.5, y: p.ay + p.uy * p.next + gauss() * 1.5, t: .45, team: p.team }); p.next += 7; } }
    else if (p.kind === 'para') { if (!p.done && p.s >= p.len) { p.done = true; dropPara(p); } }
    if (p.s > p.len + 90) { p.gone = true; if (p.kind === 'spy') log(p.team, `${S.teams[p.team].name} spy plane: ${p.seen.size} enemy photographed`); }
  }
  S.planes = S.planes.filter((p: any) => !p.gone);
  for (const t of S.tracers) t.life -= DT; S.tracers = S.tracers.filter((t: any) => t.life > 0);
  for (const f of S.fx) f.life -= DT; S.fx = S.fx.filter((f: any) => f.life > 0);
  const tick = Math.round(S.t / DT);
  if (tick % 5 === 0) updateVision();
  if (tick % 4 === 0) recFrame();
  if (tick % 10 === 0) updateSquads();
  if (tick % 10 === 5) captureGround(true);
  if (tick % 20 === 0) checkEnd();
  if (S.phase === 'battle' && pt >= PHASE_LEN - 1e-6) endRound();
}
export function countGround() { const cnt = S.teams.map(() => 0); for (let i = 0; i < OWN.length; i++) if (OWN[i] >= 0) cnt[OWN[i]]++; S.terrCount = cnt; }
// A patch of ground changes hands when one team clearly holds it. It stays theirs until someone else does.
function captureGround(capture: boolean) {
  const N = S.teams.length, a = new Float32Array(IW * IH * N);
  for (const u of S.units) {
    if (!u.alive || u.drop > 0) continue; const cx = u.x / IC, cy = u.y / IC, w = INFANTRY.has(u.kind) ? 1 : u.kind === 'op' ? .5 : 2.5;
    for (let y = Math.max(0, Math.floor(cy - 4)); y <= Math.min(IH - 1, Math.ceil(cy + 4)); y++) for (let x = Math.max(0, Math.floor(cx - 4)); x <= Math.min(IW - 1, Math.ceil(cx + 4)); x++) { const d = Math.hypot(x + .5 - cx, y + .5 - cy); if (d < 4.5) a[(y * IW + x) * N + u.team] += (1 - d / 4.5) * w; }
  }
  let changed = false;
  if (capture) for (let i = 0; i < IW * IH; i++) { let b = -1, bv = 0, sv = 0; for (let t = 0; t < N; t++) { const v = a[i * N + t]; if (v > bv) { sv = bv; bv = v; b = t; } else if (v > sv) sv = v; } if (b >= 0 && bv >= 1.5 && bv > sv * 2 && OWN[i] !== b) { OWN[i] = b; changed = true; } }
  if (changed && S.rec) S.rec.own.push({ t: S.t, o: OWN.slice() });
  countGround(); if (changed) hooks.ground();
  if (capture) checkHQs();
}
// An HQ falls when another team holds its ground for HQ_HOLD seconds. Its troops surrender and its ground goes to the captor.
function checkHQs() {
  for (const t of S.teams) {
    if (t.lost) continue; const o = OWN[Math.floor(t.zone.y / IC) * IW + Math.floor(t.zone.x / IC)];
    if (o >= 0 && o !== t.id) { if (t.hqBy !== o) { t.hqBy = o; t.hqHold = 0; log(-1, `${S.teams[o].name} troops are in the ${t.name} HQ`); S.rec.moments.push({ t: S.t, x: t.zone.x, y: t.zone.y, big: false }); } t.hqHold += .5; } else { t.hqBy = -1; t.hqHold = 0; }
    if (t.hqHold < HQ_HOLD) continue;
    const by = S.teams[t.hqBy]; t.lost = true;
    for (const u of S.units) if (u.alive && u.team === t.id) { u.alive = false; S.stats[t.id].lost++; }
    for (let i = 0; i < OWN.length; i++) if (OWN[i] === t.id) OWN[i] = by.id;
    if (S.rec) S.rec.own.push({ t: S.t, o: OWN.slice() }); countGround(); hooks.ground();
    log(-1, `${by.name} took the ${t.name} HQ. ${t.name} surrenders.`); S.rec.moments.push({ t: S.t, x: t.zone.x, y: t.zone.y, big: true }); hooks.banner(`${t.name} HQ TAKEN`, `${by.name} holds it`);
    const left = S.teams.filter((x: any) => !x.lost);
    if (left.length <= 1 || (t.human && NET.mode === 'solo')) { snapshotHistory(); finish(false, left.length <= 1 ? left[0].id : by.id); return; }
  }
}
function checkEnd() { }
function finish(byTime: boolean, winner = -1) {
  recFrame(); captureGround(false);
  const alive = S.teams.map((t: any) => S.units.filter((u: any) => u.alive && u.team === t.id).length); let w = winner;
  if (byTime) { let bv = -1; S.teams.forEach((t: any, i: number) => { if (!t.lost && S.terrCount[i] > bv) { bv = S.terrCount[i]; w = i; } }); }
  S.phase = 'done'; S.result = { winner: w, alive, terr: S.terrCount.slice(), byTime };
  S.rec.meta = S.units.map((u: any) => ({ team: u.team, kind: u.kind })); S.rec.end = S.t; S.finalOwn = OWN.slice();
  log(-1, byTime ? 'Phase limit reached' : 'Battle over'); hooks.result(); hooks.sync();
}
