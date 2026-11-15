import { W, H, C, GW, GH, IW, IH, IC, DT, BUDGET, COST, T_GROUND, PLATOONS, unitKind, PHASES, PHASE_LEN, HQ_HOLD, K, COV, KIND_NAME, SPY_RADIUS, T_ROAD, T_BRIDGE, T_WOOD, T_BUILD, T_WATER, clamp, grid } from './config';
import { S, M, OWN, VIS0, SEEN0, NET, hooks } from './state';
import { cellOf, unitH, passable, nudge, opRange } from './world';
import { aliveMembers, spentNow, sqName, nextCall, rollPersonalities, initOwn } from './plan';
import { aiPlan } from './ai';
import { BTYPES } from './map/btypes';

let rnd = Math.random;
const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v); };

// team -1 is a message for everyone.
// Sound events for the speakers here and, on the host, for the guest's.
function snd(k: string, x: number, y: number, size = 0) {
  if (!S.snd) S.snd = []; if (S.snd.length < 200) S.snd.push([k, x, y, size]);
  if (NET.mode === 'host') { if (!S.sndNet) S.sndNet = []; if (S.sndNet.length < 200) S.sndNet.push([k, Math.round(x), Math.round(y), size]); }
}
export function log(team: number, msg: string) {
  S.teams.forEach((t: any) => { msg = msg.split(t.name).join(`{T${t.id}}`); }); S.log.unshift({ t: S.t, team, msg }); if (S.log.length > 400) S.log.pop(); S.logDirty = true; }
// Supply each phase: a small base, plus more for ground held. Kept low so every purchase is a choice.
export const income = (t: number) => S.teams[t].lost ? 0 : Math.round((60 + (S.terrCount[t] || 0) * .2) * (S.teams[t].human ? 1 : (S.aiMult || 1)));

export function newBattle() {
  if (M) { M.terr.set(M.terr0); M.deck.set(M.deck0); M.bridges.forEach(b => b.blown = null); M.bldId.set(M.bldId0); M.bldTop.set(M.bldTop0); for (const b of M.B) { b.hp = b.hp0; b.down = null; } }
  Object.assign(S, { phase: 'plan', round: 1, t: 0, smokes: [], reports: null, units: [], shells: [], bombs: [], fx: [], tracers: [], craters: [], planes: [], cover: null, rec: null, result: null, log: [], stats: [], history: [], callN: [], vis: [], known: [], contactT: [], squads: [], structs: [], supports: [], sel: null, selMany: [] });
  S.bank = S.teams.map((t: any) => Math.round(BUDGET * (t.human ? 1 : (S.aiMult || 1)))); SEEN0.fill(0); S.visG = null;
  for (const t of S.teams) { t.lost = false; t.hqHold = 0; t.hqBy = -1; } S.hqKnown = S.teams.map((t: any) => new Set([t.id]));
  rollPersonalities(); initOwn(); countGround(); updateVision();
  for (const t of S.teams) if (!t.human) aiPlan(t.id);
  hooks.ground(); hooks.sync();
}

export function beginRound() {
  if (S.round === 1) {
    Object.assign(S, { t: 0, smokes: [], units: [], shells: [], bombs: [], fx: [], tracers: [], craters: [], planes: [], flow: new Map(), log: [], history: [] });
    rnd = Math.random; S.cover = new Uint8Array(GW * GH); S.stats = S.teams.map(() => ({ kills: 0, lost: 0, start: 0, roundKills: 0 }));
    S.known = S.teams.map(() => new Map()); S.contactT = S.teams.map(() => new Map());
    S.rec = { frames: [], tracers: [], booms: [], shells: [], planes: [], phases: [], moments: [], downs: [], smokes: [], own: [{ t: 0, o: OWN.slice() }], meta: null };
  }
  for (const t of S.teams) S.bank[t.id] -= spentNow(t.id);
  S.phaseStart = S.t; S.flow.clear(); S.rec.phases.push({ round: S.round, t: S.t });
  for (const s of S.structs) if (s.round === S.round) { for (const ci of s.cells) S.cover[ci] = COV[s.type]; s.placedAt = S.t; }
  for (const sq of S.squads) {
    if (!sq.members) { if (sq.round === S.round) spawnSquad(sq); }
    else if (sq.order && sq.broken) { sq.order = null; }
    else if (sq.order) { sq.state = sq.order.type; sq.tx = sq.order.x; sq.ty = sq.order.y; useVia(sq, sq.order); sq.dir = sq.order.dir ?? sq.dir; sq.dbridge = sq.order.bridge; sq.dbld = sq.order.bld; sq.planted = null; faceMembers(sq); sq.arrived = -1; setPace(sq); sq.contact = S.t; assignSlots(sq); }
  }
  for (const sq of S.squads) if (sq.order) { if (sq.members && sq.order.type === 'attack') log(sq.team, `${sqName(sq)}: moving on ${grid(sq.order.x, sq.order.y)}`); sq.cur = sq.order; sq.order = null; }
  for (const su of S.supports) if (su.round === S.round) su.fired = false;
  for (const st of S.stats) st.roundKills = st.kills;
  S.base = S.teams.map((t: any) => ({ lost: S.stats[t.id].lost, kills: S.stats[t.id].kills, terr: S.terrCount[t.id] || 0 }));
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
  sq.state = o.type; sq.tx = o.x; sq.ty = o.y; useVia(sq, o); sq.dir = o.dir ?? sq.dir; sq.dbridge = o.bridge; sq.dbld = o.bld; sq.planted = null; faceMembers(sq); sq.arrived = -1; setPace(sq); sq.contact = S.t; assignSlots(sq); sq.cur = o; sq.order = null;
  if (o.type === 'attack') log(sq.team, `${sqName(sq)}: moving on ${grid(o.x, o.y)}`);
}
// Pace: a unit walks only as fast as it needs to reach its objective near the end of the phase,
// so a phase is movement and fighting all the way through, not a dash and a long wait.
function setPace(sq: any) {
  const mem = aliveMembers(sq); if (!mem.length) { sq.pace = 1; return; }
  let cx = 0, cy = 0; for (const u of mem) { cx += u.x; cy += u.y; } cx /= mem.length; cy /= mem.length;
  const k = K[mem[0].kind], d = Math.hypot(sq.tx - cx, sq.ty - cy) * 1.25, time = Math.max(10, (PHASE_LEN - (S.t - S.phaseStart)) * .85);
  sq.pace = k && k.speed ? clamp(d / time / k.speed, .4, 1) : 1;
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
// A short report for each side after a phase: losses, kills, ground, what was seen, and the main events.
const NOTE = / lost at |heavy losses|no reply|destroyed|blown|HQ|falling back|pinned down|objective|broke|rallied/;
function makeReports() {
  S.reports = S.teams.map((t: any) => {
    const b = (S.base && S.base[t.id]) || { lost: 0, kills: 0, terr: 0 }, st = S.stats[t.id], seen = new Map<string, number>();
    if (S.known[t.id]) for (const e of S.known[t.id].values()) if (e.t >= S.phaseStart) { const k = ['rifle', 'assault', 'engineer', 'medic', 'sniper'].includes(e.kind) ? 'infantry' : (KIND_NAME[e.kind] || e.kind); seen.set(k, (seen.get(k) || 0) + 1); }
    const notes = S.log.filter((l: any) => l.t >= S.phaseStart && (l.team === t.id || l.team === -1) && NOTE.test(l.msg)).slice(0, 6).map((l: any) => l.msg);
    return { round: S.round, lost: st.lost - b.lost, kills: st.kills - b.kills, terr: (S.terrCount[t.id] || 0) - b.terr, seen: [...seen].map(([k, n]) => `${n} ${k}`), notes };
  });
}
export const phaseLimit = () => S.maxPhases || PHASES;
function endRound() {
  recFrame(); captureGround(false); snapshotHistory();
  makeReports();
  // Overtime: while an HQ is under attack at the last phase, play on (three more phases at most).
  const contested = S.teams.some((t: any) => !t.lost && t.hqHold > 0);
  const LIM = phaseLimit(), ot = S.goal === 'hold' ? 0 : 3;
  // Ground goal: twice the enemy's ground wins at once.
  if (S.goal === 'ground' && S.round >= 3) { const a = S.terrCount[0] || 0, b = Math.max(...S.teams.filter((t: any) => t.id !== 0 && !t.lost).map((t: any) => S.terrCount[t.id] || 0)); if (a >= b * 2 && a > 300) { finish(false, 0); return; } if (b >= a * 2 && b > 300) { finish(false, S.teams.find((t: any) => t.id !== 0 && !t.lost).id); return; } }
  if (S.round >= LIM + ot || (S.round >= LIM && !contested)) { finish(true); return; }
  if (S.round >= LIM) log(-1, 'Overtime: an HQ is under attack');
  for (const sq of S.squads) if (sq.members) sq.morale = Math.min(1, (sq.morale ?? 1) + .15); // a rest between phases
  for (const t of S.teams) S.bank[t.id] += income(t.id);
  S.round++; S.phase = 'plan'; log(-1, `Phase ${S.round - 1} over`);
  updateVision();
  for (const t of S.teams) if (!t.human && !t.lost) aiPlan(t.id);
  hooks.banner(`PHASE ${S.round - 1} OVER`, 'Briefing: reinforce and give new orders'); S.tool = 'select'; S.sel = null; hooks.sync();
}

// An order may go by one waypoint first (for a flank). The unit heads for it, then for the goal.
function useVia(sq: any, o: any) { sq.goal = { x: o.x, y: o.y }; sq.via = o.via || null; sq.followId = o.type === 'follow' ? o.follow : null; sq.fellBack = false; sq.sprung = false; if (sq.via) { sq.tx = sq.via.x; sq.ty = sq.via.y; } }
function spawnSquad(sq: any, drop?: boolean) {
  sq.members = []; const kind = unitKind(sq.kind);
  for (const p of sq.pos) {
    const k = K[kind];
    const u = { i: S.units.length, x: p[0], y: p[1], team: sq.team, sq: sq.id, kind, hp: k.hp, cd: rnd() * 1.2, scan: rnd() * .4, tgt: -1, sx: p[0], sy: p[1], alive: true, kills: 0, gar: sq.kind === 'garrison', hd: Math.atan2(-(H / 2 - p[1]), W / 2 - p[0]), drop: drop ? 1.2 + rnd() * .6 : 0, ready: sq.readyRound || 0, sup: 0, sqo: sq };
    sq.members.push(S.units.length); S.units.push(u); S.stats[sq.team].start++;
  }
  const o = sq.order; sq.state = o ? o.type : 'hold'; sq.tx = o ? o.x : sq.x; sq.ty = o ? o.y : sq.y; if (o) useVia(sq, o); sq.dir = o && o.dir != null ? o.dir : sq.face; sq.dbridge = o ? o.bridge : undefined; sq.dbld = o ? o.bld : undefined; sq.planted = null; faceMembers(sq); sq.contact = S.t; sq.arrived = -1; assignSlots(sq); setPace(sq);
}
function assignSlots(sq: any) {
  const mem = aliveMembers(sq); if (!mem.length) return;
  // Suppressing fire is given from where the unit stands.
  if (sq.state === 'suppress') { for (const u of mem) { u.sx = u.x; u.sy = u.y; } return; }
  // Tanks need a spot with room round it.
  const vok = mem[0].kind === 'tank' ? (x: number, y: number) => passable(cellOf(x, y), true) : undefined;
  // Facing: the order's direction, else the way from the unit to the target.
  const c0x = mem.reduce((a: number, u: any) => a + u.x, 0) / mem.length, c0y = mem.reduce((a: number, u: any) => a + u.y, 0) / mem.length;
  const face = sq.dir != null ? sq.dir : Math.atan2(sq.ty - c0y, sq.tx - c0x), fx = Math.cos(face), fy = Math.sin(face);
  if (sq.state === 'attack' || sq.state === 'demolish' || sq.state === 'follow') {
    // A line across the facing direction: eight wide, ranks behind.
    // Spread out as real sections do: about 10 m between men, so one shell does not take a whole platoon.
    let i = 0; for (const u of mem) { const col = i % 6 - 2.5, row = Math.floor(i / 6); i++; const q = nudge(sq.tx - fy * col * 4.5 - fx * row * 5 + (rnd() - .5) * 1.5, sq.ty + fx * col * 4.5 - fy * row * 5 + (rnd() - .5) * 1.5, vok) || [sq.tx, sq.ty]; u.sx = q[0]; u.sy = q[1]; if (!vok) u.hd = Math.atan2(-fy, fx); }
    return;
  }
  const cells: number[][] = [], r = 16, c0 = Math.floor(sq.tx / C), r0 = Math.floor(sq.ty / C), rc = Math.ceil(r / C);
  for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const cx = c0 + dx, cy = r0 + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue; const ci = cy * GW + cx, c = S.cover[ci]; if ((c === 1 || c === 2) && Math.hypot(dx, dy) * C <= r) cells.push([ci, Math.hypot(dx, dy)]); }
  // Cover on the facing side comes first.
  for (const c of cells) { const px = (c[0] % GW) * C + 1 - sq.tx, py = Math.floor(c[0] / GW) * C + 1 - sq.ty; c[1] -= (px * fx + py * fy) / C * .6; }
  cells.sort((a, b) => a[1] - b[1]);
  mem.forEach((u: any, i: number) => {
    if (i < cells.length) { const pick = cells[Math.floor(i * cells.length / mem.length)][0]; u.sx = (pick % GW) * C + 1 + (rnd() - .5) * .6; u.sy = Math.floor(pick / GW) * C + 1 + (rnd() - .5) * .6; }
    else { const a = rnd() * 6.28, d = 4 + rnd() * 12; const q = nudge(sq.tx + Math.cos(a) * d, sq.ty + Math.sin(a) * d, vok) || [u.x, u.y]; u.sx = q[0]; u.sy = q[1]; }
  });
}
function clearLine(ax: number, ay: number, bx: number, by: number, veh?: boolean) {
  // Step cell by cell. A diagonal step needs both side cells open, so a line cannot slip between two wall cells that touch at a corner.
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / .5); let prev = cellOf(ax, ay);
  for (let i = 1; i <= n; i++) {
    const c = cellOf(ax + (bx - ax) * i / n, ay + (by - ay) * i / n); if (c === prev) continue; if (!passable(c, veh)) return false;
    const px = prev % GW, py = (prev / GW) | 0, cx = c % GW, cy = (c / GW) | 0;
    if (px !== cx && py !== cy && (!passable(py * GW + cx, veh) || !passable(cy * GW + px, veh))) return false;
    prev = c;
  }
  return true;
}
// The way troops will walk from a to b, as a few straight legs round buildings and water. Used to draw orders.
const routes = new Map<string, { f: Uint16Array; pts: number[][] }>();
export function route(ax: number, ay: number, bx: number, by: number, veh?: boolean): number[][] {
  const s0 = cellOf(ax, ay), t = nudge(bx, by); if (s0 < 0 || !t) return [[ax, ay], [bx, by]];
  const key = s0 + ',' + cellOf(t[0], t[1]) + (veh ? 'v' : ''); const hit = routes.get(key); if (hit && S.flow && S.flow.get(cellOf(t[0], t[1]) * 2 + (veh ? 1 : 0)) === hit.f) return hit.pts;
  if (!S.flow) S.flow = new Map(); const f = flowFor(bx, by, veh); if (!f || f[s0] === 65535) return [[ax, ay], [bx, by]];
  const pts: number[][] = [[ax, ay]]; let c = s0;
  for (let k = 0; k < 3000 && f[c] > 0; k++) {
    let best = f[c], bc = -1; const cx = c % GW, cy = (c / GW) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue; const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx; if (f[n] < best && (ox === 0 || oy === 0 || (passable(cy * GW + nx, veh) && passable(ny * GW + cx, veh)))) { best = f[n]; bc = n; }
    }
    if (bc < 0) break; c = bc; pts.push([(c % GW) * C + 1, ((c / GW) | 0) * C + 1]);
  }
  pts.push([bx, by]);
  // Keep only the corners: from each point, jump to the furthest point still in a clear straight line.
  const out = [pts[0]]; let i = 0;
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !clearLine(pts[i][0], pts[i][1], pts[j][0], pts[j][1], veh)) j--; out.push(pts[j]); i = j; }
  if (routes.size > 300) routes.clear(); routes.set(key, { f, pts: out }); return out;
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
// Smoke clouds grow for 3 s, hold, and thin out in their last 6 s.
export function smokeR(m: any, t: number) { const a = t - m.t0; return a < 0 || a > m.life ? 0 : m.r * Math.min(1, .3 + a / 3) * Math.min(1, (m.life - a) / 6 + .2); }
export function inSmoke(x: number, y: number) { for (const m of S.smokes) { const r = smokeR(m, S.t); if ((x - m.x) ** 2 + (y - m.y) ** 2 < r * r) return true; } return false; }
export function los(ax: number, ay: number, bx: number, by: number) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 1.5), ha = unitH(ax, ay) + 1.4, hb = unitH(bx, by) + 1.4;
  const ca = cellOf(ax, ay), cb = cellOf(bx, by), ia = ca >= 0 ? M.bldId[ca] : -1, ib = cb >= 0 ? M.bldId[cb] : -1; let wood = 0, smoke = 0;
  for (let i = 1; i < n; i++) {
    const f = i / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, ci = cellOf(x, y); if (ci < 0) continue;
    const lh = ha + (hb - ha) * f, t = M.terr[ci], g = M.hAt(x, y);
    if (t === T_BUILD) { const id = M.bldId[ci]; if (id >= 0 && (id === ia || id === ib)) continue; if (M.bldTop[ci] > lh) return false; continue; }
    if (S.cover && S.cover[ci] === 3 && lh < g + 2.6) return false;
    if (g > lh + .2) return false;
    if (t === T_WOOD && lh < g + 5) { wood += 1.5; if (wood > 12) return false; }
    if (S.smokes && S.smokes.length && lh < g + 10 && inSmoke(x, y)) { smoke += 1.5; if (smoke > 4) return false; }
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
const MORALE_KINDS = new Set(['rifles', 'assault', 'engineers', 'medics', 'sniper']);
function kill(v: any, team: number) {
  if (!v.alive) return; v.alive = false; S.stats[v.team].lost++;
  // Losses shake the unit: half its men gone costs about half its morale.
  if (v.sqo && v.sqo.members && MORALE_KINDS.has(v.sqo.kind)) v.sqo.morale = Math.max(0, (v.sqo.morale ?? 1) - .95 / v.sqo.members.length); if (team !== v.team && team >= 0) S.stats[team].kills++;
  // Teams that see the unit fall learn it is gone; the others still think it is there.
  S.teams.forEach((t: any) => { if (S.vis[t.id] && S.vis[t.id][v.i] && S.known[t.id]) S.known[t.id].delete(v.i); });
  if (['mg', 'mortar', 'tank', 'at', 'op', 'sniper', 'fob'].includes(v.kind)) log(v.team, `${S.teams[v.team].name} ${KIND_NAME[v.kind] || v.kind} lost at ${grid(v.x, v.y)}`);
  const sq = S.squads.find((s: any) => s.id === v.sq);
  if (sq && PLATOONS.includes(sq.kind)) { const alive = aliveMembers(sq).length; if (!sq.halfLogged && alive <= sq.members.length / 2 && alive > 0) { sq.halfLogged = true; log(v.team, `${sqName(sq)}: taking heavy losses at ${grid(v.x, v.y)}`); } if (alive === 0) log(v.team, `${sqName(sq)}: no reply`); }
}
function contact(sq: any) { if (sq) sq.contact = S.t; }
function tankFire(u: any, e: any, k: any) {
  const d = Math.hypot(e.x - u.x, e.y - u.y), hit = rnd() < k.acc * (1 - .5 * d / k.range), x = hit ? e.x : e.x + gauss() * 4, y = hit ? e.y : e.y + gauss() * 4;
  S.tracers.push({ x0: u.x, y0: u.y, x1: x, y1: y, life: .15, team: u.team, u: u.i }); S.rec.tracers.push([S.t, u.x, u.y, x, y, u.team, u.i]); snd('gun', u.x, u.y);
  u.fired = S.t;
  if (hit && e.kind === 'tank') { e.hp -= 3; if (e.hp <= 0) { kill(e, u.team); u.kills++; } } else explode(x, y, 3.5, .75, u.team);
  contact(S.squads.find((s: any) => s.id === u.sq));
}
// Suppression: fire landing on or near men makes them keep their heads down. It builds with each shot,
// more from MGs and blasts, less in cover, and wears off in a few seconds. Tanks and FOBs do not care.
function suppress(v: any, a: number) {
  if (!v.alive || v.kind === 'tank' || v.kind === 'fob') return; const sq = v.sqo;
  v.sup = Math.min(1.6, (v.sup || 0) + a * (1 - coverAt(v) * .5) * (sq && sq.stance === 'careful' ? .7 : 1));
  // Surprise: a unit that was not in a fight when the first shots land is shaken. Its men go to ground
  // and take a moment before they fire back. Careful units are surprised less.
  if (sq && sq.members && (!sq.shotAt || S.t - sq.shotAt > 15) && !(sq.contact && S.t - sq.contact < 6 && sq.state !== 'hold')) {
    const k = sq.stance === 'careful' ? .5 : 1;
    for (const i of sq.members) { const m = S.units[i]; if (!m.alive) continue; m.sup = Math.min(1.6, (m.sup || 0) + .5 * k); m.cd = Math.max(m.cd, (1.2 + rnd() * 1.4) * k); }
    if (sq.call) log(sq.team, `${sqName(sq)}: surprised, under fire at ${grid(v.x, v.y)}`);
  }
  if (sq) sq.shotAt = S.t;
}
const pinAt = (sq: any) => sq && sq.stance === 'rush' ? 1.2 : sq && sq.stance === 'careful' ? .5 : .75;
function shoot(u: any, e: any, k: any) {
  u.hd = Math.atan2(-(e.y - u.y), e.x - u.x); if (u.kind === 'tank') { tankFire(u, e, k); return; }
  const tr = { x0: u.x, y0: u.y, x1: e.x + (rnd() - .5) * 2, y1: e.y + (rnd() - .5) * 2, life: .09, team: u.team, u: u.i };
  snd(u.kind === 'mg' ? 'mg' : u.kind === 'sniper' ? 'snipe' : u.kind === 'at' ? 'gun' : 'shot', u.x, u.y);
  S.tracers.push(tr); if (S.rec.tracers.length < 150000) S.rec.tracers.push([S.t, tr.x0, tr.y0, tr.x1, tr.y1, u.team, u.i]);
  const d = Math.hypot(e.x - u.x, e.y - u.y), hb = clamp((unitH(u.x, u.y) - unitH(e.x, e.y)) * .02, 0, .15), rushing = u.sqo && u.sqo.stance === 'rush' && u.moving;
  // Suppressed men shoot badly; men rushing and firing on the move too.
  const p = (k.acc + hb) * (1 - coverAt(e)) * (1 - .5 * d / k.range) * (1 - .6 * Math.min(1, u.sup || 0)) * (rushing ? .6 : 1) * (u.sqo && (u.sqo.morale ?? 1) < .35 ? .7 : 1);
  u.fired = S.t; suppress(e, u.kind === 'mg' ? .16 : u.kind === 'sniper' ? .25 : u.kind === 'at' ? .1 : u.kind === 'assault' ? .12 : .14);
  // Near misses keep the men beside the target down too: MG fire sweeps a whole section.
  if (u.kind === 'mg' && rnd() < .5) for (const i of (e.sqo && e.sqo.members) || []) { const v = S.units[i]; if (v !== e && v.alive && Math.abs(v.x - e.x) < 7 && Math.abs(v.y - e.y) < 7) suppress(v, .07); }
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
  damageBuildings(x, y, r, power, team); snd('boom', x, y, r);
  S.fx.push({ x, y, r, life: .6, max: .6 }); S.craters.push({ x, y, r: r * .55 }); if (S.craters.length > 600) S.craters.shift(); S.rec.booms.push([S.t, x, y, r]);
  for (const v of S.units) {
    if (!v.alive || v.drop > 0) continue; const d = Math.hypot(v.x - x, v.y - y); if (d < r * 1.8) suppress(v, .7 * (1 - d / (r * 1.8))); if (d > r) continue;
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
// How fast ground is to cross, times the unit's speed: roads speed tanks up; trenches, wire and woods slow men down.
export function moveFactor(ci: number, veh?: boolean) {
  if (ci < 0) return 1; const cov = S.cover ? S.cover[ci] : 0, tt = M.terr[ci];
  return veh ? (tt === T_ROAD || tt === T_BRIDGE ? 1.5 : cov === 2 ? .7 : 1) : (cov === 2 ? .6 : cov === 4 ? .33 : tt === T_WOOD ? .85 : 1);
}
const TURN = 1.1; // tank turn speed, radians a second
function moveUnit(u: any, k: any, sq: any) {
  const dx = u.sx - u.x, dy = u.sy - u.y, ds = Math.hypot(dx, dy); if (ds < .5) return;
  const ci = cellOf(u.x, u.y), cov = ci >= 0 ? S.cover[ci] : 0, tt = ci >= 0 ? M.terr[ci] : 0;
  let sp = k.speed * (sq.pace || 1) * DT * moveFactor(ci, k.veh) * (sq.stance === 'careful' ? .65 : sq.stance === 'rush' ? 1.35 : 1);
  let tx = u.sx, ty = u.sy;
  // Go straight when the way is clear; otherwise follow the path field round buildings and water.
  const f = ds > 16 || !clearLine(u.x, u.y, u.sx, u.sy, k.veh) ? flowFor(sq.tx, sq.ty, k.veh) : null;
  if (f && ci >= 0 && f[ci] !== 65535 && f[ci] > 0) {
    // Steer at a point some cells ahead on the path, the furthest one in a clear straight line,
    // and keep it for a moment: smooth walking, not a zigzag from cell to cell.
    if (!u.wp || S.t > u.wpT || Math.hypot(u.wp[0] - u.x, u.wp[1] - u.y) < 1) {
      let c = ci, pick = -1;
      for (let s = 0; s < 12; s++) {
        let best = f[c], bc = -1; const cx = c % GW, cy = (c / GW) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue; const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const n = ny * GW + nx; if (f[n] < best && (ox === 0 || oy === 0 || (passable(cy * GW + nx, k.veh) && passable(ny * GW + cx, k.veh)))) { best = f[n]; bc = n; }
        }
        if (bc < 0) break; c = bc;
        if (pick < 0 || clearLine(u.x, u.y, (c % GW) * C + 1, ((c / GW) | 0) * C + 1, k.veh)) pick = c; else break;
      }
      u.wp = pick >= 0 ? [(pick % GW) * C + 1, ((pick / GW) | 0) * C + 1] : null; u.wpT = S.t + .8;
    }
    if (u.wp) { tx = u.wp[0]; ty = u.wp[1]; }
  } else u.wp = null;
  const mx = tx - u.x, my = ty - u.y, ml = Math.hypot(mx, my) || 1; sp = Math.min(sp, ml);
  const nx = u.x + mx / ml * sp, ny = u.y + my / ml * sp;
  if (k.veh) {
    // Tanks turn on the spot towards the way they go, and move only when roughly lined up.
    const want = Math.atan2(-(ny - u.y), nx - u.x), d = Math.atan2(Math.sin(want - u.hd), Math.cos(want - u.hd));
    u.hd += clamp(d, -TURN * DT, TURN * DT); if (Math.abs(d) > .5) return;
  }
  // The next spot must be open, and a step across a cell corner needs both side cells open (no slipping through walls).
  const cn = cellOf(nx, ny), diag = ci >= 0 && cn >= 0 && cn !== ci && cn % GW !== ci % GW && ((cn / GW) | 0) !== ((ci / GW) | 0), cornerOk = !diag || (passable(((ci / GW) | 0) * GW + cn % GW, k.veh) && passable(((cn / GW) | 0) * GW + ci % GW, k.veh));
  if ((passable(cn, k.veh) && cornerOk) || !passable(ci, k.veh)) { if (!k.veh) u.hd = Math.atan2(-(ny - u.y), nx - u.x); u.x = nx; u.y = ny; }
  // Blocked: slide along the wall on one axis before a small random step.
  else if (passable(cellOf(nx, u.y), k.veh)) u.x = nx;
  else if (passable(cellOf(u.x, ny), k.veh)) u.y = ny;
  else { u.wp = null; u.x += (rnd() - .5) * .15; u.y += (rnd() - .5) * .15; }
}
function updateSquads() {
  const tick = Math.floor(S.t * 2) !== Math.floor((S.t - DT) * 2);
  for (const sq of S.squads) {
    if (sq.members && tick) squadStatus(sq);
    if (sq.members && sq.state === 'follow' && tick) {
      // Follow: stay about 12 behind the leader, on the side this unit came from.
      const lead = S.squads.find((q: any) => q.id === sq.followId), lm = lead && lead.members ? aliveMembers(lead) : [], m = aliveMembers(sq);
      if (!lm.length) { if (m.length) { sq.state = 'defend'; sq.tx = m[0].x; sq.ty = m[0].y; assignSlots(sq); } continue; }
      if (!m.length) continue;
      const lx = lm.reduce((a: number, u: any) => a + u.x, 0) / lm.length, ly = lm.reduce((a: number, u: any) => a + u.y, 0) / lm.length, cx = m.reduce((a: number, u: any) => a + u.x, 0) / m.length, cy = m.reduce((a: number, u: any) => a + u.y, 0) / m.length;
      const d = Math.hypot(cx - lx, cy - ly) || 1, q = nudge(lx + (cx - lx) / d * 12, ly + (cy - ly) / d * 12);
      if (q && Math.hypot(q[0] - sq.tx, q[1] - sq.ty) > 5) { sq.tx = q[0]; sq.ty = q[1]; sq.dir = Math.atan2(ly - cy, lx - cx); sq.pace = 1; sq.stance = lead.stance; assignSlots(sq); }
      continue;
    }
    if (sq.members && sq.via) {
      // Waypoint reached: go on to the goal.
      const m = aliveMembers(sq); if (m.length) { const cx = m.reduce((a: number, u: any) => a + u.x, 0) / m.length, cy = m.reduce((a: number, u: any) => a + u.y, 0) / m.length;
        if (Math.hypot(cx - sq.via.x, cy - sq.via.y) < 12) { sq.via = null; sq.tx = sq.goal.x; sq.ty = sq.goal.y; setPace(sq); assignSlots(sq); log(sq.team, `${sqName(sq)}: waypoint reached, moving on ${grid(sq.tx, sq.ty)}`); } }
      continue;
    }
    if (sq.members && sq.fallback && !sq.fellBack && MOVERS_SET.has(sq.kind)) {
      // Fall back when badly hurt: pull back towards home and hold.
      const m = aliveMembers(sq);
      if (m.length && m.length < sq.members.length * .45) {
        const cx = m.reduce((a: number, u: any) => a + u.x, 0) / m.length, cy = m.reduce((a: number, u: any) => a + u.y, 0) / m.length, z = S.teams[sq.team].zone, d = Math.hypot(z.x - cx, z.y - cy) || 1, back = Math.min(d, 60);
        const q = nudge(cx + (z.x - cx) / d * back, cy + (z.y - cy) / d * back);
        if (q) { sq.fellBack = true; sq.state = 'defend'; sq.tx = q[0]; sq.ty = q[1]; sq.stance = 'rush'; sq.pace = 1; assignSlots(sq); log(sq.team, `${sqName(sq)}: falling back to ${grid(q[0], q[1])}`); continue; }
      }
    }
    if (sq.members && sq.state === 'demolish') demolishStep(sq);
    if (!sq.members || sq.state !== 'attack') continue; const mem = aliveMembers(sq); if (!mem.length) continue; const cx = mem.reduce((a: number, u: any) => a + u.x, 0) / mem.length, cy = mem.reduce((a: number, u: any) => a + u.y, 0) / mem.length;
    const near = mem.filter((u: any) => Math.hypot(u.x - sq.tx, u.y - sq.ty) < 12).length;
    if (near >= mem.length * .5) {
      // Objective taken. With time left in the phase, push on to the nearest enemy this side knows about; otherwise dig in.
      const left = PHASE_LEN - (S.t - S.phaseStart), k = S.known[sq.team]; let tgt: any = null, bd = 75;
      if (left > 12 && k) for (const e of k.values()) { const d = Math.hypot(e.x - sq.tx, e.y - sq.ty); if (d < bd) { bd = d; tgt = e; } }
      if (tgt) { const q = nudge(tgt.x, tgt.y); if (q) { sq.tx = q[0]; sq.ty = q[1]; sq.dir = Math.atan2(q[1] - cy, q[0] - cx); setPace(sq); assignSlots(sq); log(sq.team, `${sqName(sq)}: objective taken, pushing on to ${grid(q[0], q[1])}`); continue; } }
      sq.state = 'defend'; sq.arrived = S.t; sq.pace = 1; log(sq.team, `${sqName(sq)}: objective ${grid(sq.tx, sq.ty)} reached, digging in`); assignSlots(sq);
    }
  }
}
// What a unit is doing now, for its tag on the map: pinned, engaging, moving, holding.
const MOVERS_SET = new Set(['rifles', 'assault', 'engineers', 'medics', 'sniper', 'tank']);
function squadStatus(sq: any) {
  const m = aliveMembers(sq); sq.alive = m.length; if (!m.length) { sq.status = 'LOST'; return; }
  // Pinned: a third or more of the men are down under fire.
  const sup = m.filter((u: any) => (u.sup || 0) > pinAt(sq)).length >= m.length / 3 ? 9 : 0, firing = m.some((u: any) => u.fired && S.t - u.fired < 2);
  const was = sq.status;
  // Morale: falls while pinned, comes back out of the fight, faster near the HQ. Below .35 the unit is shaken
  // (will not advance, shoots worse); below .15 it breaks and runs for home until it rallies.
  if (MORALE_KINDS.has(sq.kind)) {
    const z = S.teams[sq.team].zone, quiet = !sq.shotAt || S.t - sq.shotAt > 8, home = Math.hypot(m[0].x - z.x, m[0].y - z.y) < 35;
    sq.morale = clamp((sq.morale ?? 1) + (sup ? -.02 : quiet ? (home ? .03 : .012) : 0), 0, 1);
    if (!sq.broken && sq.morale < .15) {
      const cx = m.reduce((a: number, u: any) => a + u.x, 0) / m.length, cy = m.reduce((a: number, u: any) => a + u.y, 0) / m.length, d = Math.hypot(z.x - cx, z.y - cy) || 1, q = nudge(cx + (z.x - cx) / d * Math.min(d, 70), cy + (z.y - cy) / d * Math.min(d, 70));
      sq.broken = true; sq.via = null; sq.state = 'defend'; if (q) { sq.tx = q[0]; sq.ty = q[1]; } sq.keepStance = sq.stance; sq.stance = 'rush'; sq.pace = 1; assignSlots(sq); if (sq.call) log(sq.team, `${sqName(sq)}: broke and is running`);
    } else if (sq.broken && sq.morale > .45) { sq.broken = false; sq.stance = sq.keepStance; if (sq.call) log(sq.team, `${sqName(sq)}: rallied at ${grid(m[0].x, m[0].y)}`); }
  }
  sq.status = sq.readyRound > S.round ? 'BUILDING' : sq.broken ? 'BROKEN' : sq.fellBack && sq.state === 'defend' && m.some((u: any) => u.moving) ? 'FALLING BACK'
    : sup > pinAt(sq) ? 'PINNED' : MORALE_KINDS.has(sq.kind) && (sq.morale ?? 1) < .35 ? 'SHAKEN' : firing ? (sq.state === 'suppress' ? 'SUPPRESSING' : 'ENGAGING') : sq.state === 'follow' ? 'FOLLOWING' : sq.state === 'demolish' ? 'DEMOLISHING'
    : m.some((u: any) => u.moving) ? (sq.via ? 'FLANKING' : 'MOVING') : sq.state === 'defend' ? 'HOLDING' : sq.state === 'attack' ? 'MOVING' : 'IDLE';
  if (sq.status === 'PINNED' && was !== 'PINNED' && sq.call) log(sq.team, `${sqName(sq)}: pinned down at ${grid(m[0].x, m[0].y)}`);
}
function launchSupport(su: any) {
  const T = S.teams[su.team], z = T.zone;
  if (su.type === 'smoke') {
    // Smoke: six rounds make a screen about 40 wide that blocks sight for half a minute.
    for (let i = 0; i < 6; i++) addShell({ x0: z.x, y0: z.y, x1: su.a.x + gauss() * 7, y1: su.a.y + gauss() * 7, t: -i * .3, dur: 1.8, team: su.team, r: 0, power: 0, smoke: true });
    log(su.team, `${T.name} smoke on ${grid(su.a.x, su.a.y)}`); return;
  }
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
function viewshed(g: Uint8Array, u: any, R: number) {
  const ha = unitH(u.x, u.y) + 1.6, c0 = cellOf(u.x, u.y), own = c0 >= 0 ? M.bldId[c0] : -1, rays = Math.min(120, Math.max(32, Math.ceil(R * 6.283 / IC)));
  const mark = (x: number, y: number) => { const gx = Math.floor(x / IC), gy = Math.floor(y / IC); if (gx >= 0 && gy >= 0 && gx < IW && gy < IH) g[gy * IW + gx] = 1; };
  mark(u.x, u.y);
  for (let k = 0; k < rays; k++) {
    const a = k / rays * 6.283, dx = Math.cos(a), dy = Math.sin(a); if (!inArc(u, u.x + dx * 10, u.y + dy * 10)) { for (let d = 1; d < 6; d += 1) mark(u.x + dx * d, u.y + dy * d); continue; }
    let maxS = -1e9, wood = 0, smoke = 0;
    for (let d = 1; d <= R; d += 1) {
      const x = u.x + dx * d, y = u.y + dy * d, ci = cellOf(x, y); if (ci < 0) break;
      const gr = M.hAt(x, y), t = M.terr[ci];
      if ((gr + 1.4 - ha) / d >= maxS) mark(x, y); else if (t !== T_BUILD) continue;
      // What this spot hides behind it.
      let top = gr;
      if (t === T_BUILD) { const id = M.bldId[ci]; if (id >= 0 && id !== own) top = M.bldTop[ci]; }
      else if (t === T_WOOD) { wood += 1; if (wood > 12) break; }
      if (S.smokes && S.smokes.length && inSmoke(x, y)) { smoke += 1; if (smoke > 3) break; }
      if (S.cover && S.cover[ci] === 3) top = Math.max(top, gr + 2.6);
      maxS = Math.max(maxS, (top - ha) / d);
    }
  }
}
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
        const ce = cellOf(e.x, e.y), sqE = e.sqo; let hid = ce >= 0 && M.terr[ce] === T_WOOD && e.kind !== 'tank' ? .5 : 1;
        if (sqE && sqE.stance === 'ambush' && !sqE.sprung && !e.moving) hid *= .5; // men lying in wait are hard to spot
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
    // Troops clear the fog only where they can see: rays stop at buildings, rising ground and deep woods.
    // Soldiers standing close together share one set of rays.
    const done = new Set<number>();
    for (const u of U) {
      if (!u.alive || u.team !== t || u.drop > 0) continue; const R = sightOf(u), key = (Math.floor(u.y / 3) * 400 + Math.floor(u.x / 3)) * 64 + Math.round(R / 4) + (K[u.kind].arc ? 32 : 0);
      if (done.has(key)) continue; done.add(key); viewshed(g, u, R);
    }
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
    const k = K[u.kind]; u.cd -= DT; u.scan -= DT; if (u.sup) u.sup = Math.max(0, u.sup - DT * .11);
    // Under construction this phase (FOBs and heavy weapons): no fire and no movement yet.
    if (u.ready > S.round) continue;
    if (u.kind === 'op' || u.kind === 'fob') continue;
    if (u.kind === 'mortar') {
      if (u.cd <= 0 && u.scan <= 0) { u.scan = .6; const t = mortarTarget(u); if (t >= 0) { const e = U[t], d = Math.hypot(e.x - u.x, e.y - u.y); snd('launch', u.x, u.y); addShell({ x0: u.x, y0: u.y, x1: e.x + gauss() * 5, y1: e.y + gauss() * 5, t: 0, dur: .8 + d / 60, team: u.team, r: 6.5, power: .8 }); u.rounds = (u.rounds ?? k.salvo) - 1; if (u.rounds <= 0) { u.rounds = k.salvo; u.cd = k.reload * (.9 + rnd() * .2); u.reloading = true; } else { u.cd = k.cd * (.85 + rnd() * .3); u.reloading = false; } } }
      continue;
    }
    if (u.scan <= 0) { u.scan = .35 + rnd() * .25; u.tgt = findTarget(u, k.range); }
    let e = u.tgt >= 0 ? U[u.tgt] : null; if (e && (!e.alive || Math.hypot(e.x - u.x, e.y - u.y) > k.range)) { e = null; u.tgt = -1; }
    const sq = u.sqo;
    // Ambush: hold fire until the enemy is close or the unit is shot at; then everyone opens up.
    if (e && sq && sq.stance === 'ambush' && !sq.sprung) { if (Math.hypot(e.x - u.x, e.y - u.y) < k.range * .55 || sq.shotAt) sq.sprung = true; else e = null; }
    // Pinned men stop and keep their heads down; badly pinned men do not fire at all.
    const pinned = !k.veh && ((u.sup || 0) > pinAt(sq) || (sq && !sq.broken && (sq.morale ?? 1) < .35 && sq.state === 'attack')), headsDown = !k.veh && (u.sup || 0) > 1.15;
    if (headsDown) e = null;
    // Suppressing fire: with no enemy in sight, fire at the ordered spot to keep heads down there.
    if (!e && !headsDown && sq && sq.state === 'suppress' && u.cd <= 0 && !k.veh) {
      const d = Math.hypot(sq.ty - u.y, sq.tx - u.x);
      if (d <= k.range * 1.15 && los(u.x, u.y, sq.tx, sq.ty)) {
        const tx = sq.tx + gauss() * 3, ty = sq.ty + gauss() * 3; u.hd = Math.atan2(-(ty - u.y), tx - u.x); u.fired = S.t; u.cd = k.cd * (.8 + rnd() * .6);
        S.tracers.push({ x0: u.x, y0: u.y, x1: tx, y1: ty, life: .09, team: u.team, u: u.i }); if (S.rec.tracers.length < 150000) S.rec.tracers.push([S.t, u.x, u.y, tx, ty, u.team, u.i]); snd('shot', u.x, u.y);
        for (const v of U) { if (!v.alive || v.team === u.team || v.drop > 0) continue; const dv = Math.hypot(v.x - tx, v.y - ty); if (dv > 7) continue; suppress(v, .1); if (dv < 2.5 && v.kind !== 'tank' && rnd() < k.acc * .35 * (1 - coverAt(v))) { v.hp -= 1; if (v.hp <= 0 && !saved(v)) { kill(v, u.team); u.kills++; } } }
      }
    }
    if (e && k.veh) {
      // A tank stops, turns its hull onto the target, and fires only when it is lined up.
      const want = Math.atan2(-(e.y - u.y), e.x - u.x), d = Math.atan2(Math.sin(want - u.hd), Math.cos(want - u.hd));
      u.hd += clamp(d, -TURN * DT, TURN * DT);
      if (Math.abs(d) < .12 && u.cd <= 0) { shoot(u, e, k); u.cd = k.cd * (.8 + rnd() * .4); }
    } else if (e && u.cd <= 0) { shoot(u, e, k); u.cd = k.cd * (.7 + rnd() * .6); }
    u.moving = false;
    if (k.speed > 0 && !u.gar && !pinned && (!e || (!k.veh && sq && sq.stance === 'rush')) && sq) { const x0 = u.x, y0 = u.y; moveUnit(u, k, sq); u.moving = u.x !== x0 || u.y !== y0; }
  }
  for (const s of S.shells) { s.t += DT; if (s.t >= s.dur && !s.done) { s.done = true; if (s.smoke) { S.smokes.push({ x: s.x1, y: s.y1, r: 9, t0: S.t, life: 32 }); S.rec.smokes.push([S.t, s.x1, s.y1]); snd('launch', s.x1, s.y1); } else explode(s.x1, s.y1, s.r, s.power, s.team); } }
  if (S.smokes.length) S.smokes = S.smokes.filter((m: any) => S.t - m.t0 < m.life); S.shells = S.shells.filter((s: any) => !s.done);
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
    // Troops control the ground about 70 m round them.
    for (let y = Math.max(0, Math.floor(cy - 7)); y <= Math.min(IH - 1, Math.ceil(cy + 7)); y++) for (let x = Math.max(0, Math.floor(cx - 7)); x <= Math.min(IW - 1, Math.ceil(cx + 7)); x++) { const d = Math.hypot(x + .5 - cx, y + .5 - cy); if (d < 7) a[(y * IW + x) * N + u.team] += (1 - d / 7) * w; }
  }
  let changed = false;
  if (capture) for (let i = 0; i < IW * IH; i++) { let b = -1, bv = 0, sv = 0; for (let t = 0; t < N; t++) { const v = a[i * N + t]; if (v > bv) { sv = bv; bv = v; b = t; } else if (v > sv) sv = v; } if (b >= 0 && bv >= 1.5 && bv > sv * 2 && OWN[i] !== b) { OWN[i] = b; changed = true; } }
  if (changed && S.rec) S.rec.own.push({ t: S.t, o: OWN.slice() });
  countGround(); if (changed) hooks.ground();
  if (capture) checkHQs();
}
// An HQ falls when another team holds its ground for HQ_HOLD seconds (a full phase). Driven off, the count runs back down at twice the speed. Its troops surrender and its ground goes to the captor.
function checkHQs() {
  for (const t of S.teams) {
    if (t.lost) continue; const o = OWN[Math.floor(t.zone.y / IC) * IW + Math.floor(t.zone.x / IC)];
    if (o >= 0 && o !== t.id) { if (t.hqBy !== o) { t.hqBy = o; t.hqHold = 0; log(-1, `${S.teams[o].name} troops are in the ${t.name} HQ`); S.rec.moments.push({ t: S.t, x: t.zone.x, y: t.zone.y, big: false }); } t.hqHold += .5; } else if (t.hqHold > 0) { t.hqHold = Math.max(0, t.hqHold - 1); if (!t.hqHold) t.hqBy = -1; } else t.hqBy = -1;
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
  if (byTime) { let bv = -1; S.teams.forEach((t: any, i: number) => { if (!t.lost && S.terrCount[i] > bv) { bv = S.terrCount[i]; w = i; } });
    // Campaign goals: holding out wins for the defender; a failed assault loses.
    if (S.goal === 'hold' && !S.teams[0].lost) w = 0; if (S.goal === 'assault') w = S.teams.find((t: any) => t.id !== 0 && !t.lost)?.id ?? w; }
  S.phase = 'done'; S.result = { winner: w, alive, terr: S.terrCount.slice(), byTime };
  S.rec.meta = S.units.map((u: any) => ({ team: u.team, kind: u.kind })); S.rec.end = S.t; S.finalOwn = OWN.slice();
  log(-1, byTime ? 'Phase limit reached' : 'Battle over'); hooks.result(); hooks.sync();
}
