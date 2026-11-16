import { NET } from './state';
import { C, GW, GH, COST, PLATOON_SIZE, MOVERS, KIND_NAME, TEAM_COLORS, TEAM_NAMES, CALLSIGNS, PERS, T_BRIDGE, T_BUILD, T_WATER, T_GROUND, T_PARK, T_ROAD, CX, CY, PLAY_R, mulberry32 } from './config';
import { S, M, OWN } from './state';
import { isAllowed } from './campaign';
import { BTYPES } from './map/btypes';
import { cellOf, passTerr, nudge, canDeploy, cellPos, canPlaceUnit, ENG_BUILD, passable } from './world';

// Start areas sit at least this far apart, so they never overlap.
const MIN_GAP = 130;
export function makeTeams() {
  // Start areas: a random turn of the whole ring, then each side moved a little round and in or out.
  // Host and guest share the seed, so both get the same places.
  S.teams = []; const N = S.nTeams, rs = mulberry32(S.spawnSeed ?? 1), a0 = rs() * Math.PI * 2;
  for (let i = 0; i < N; i++) {
    const a = a0 + i * Math.PI * 2 / N + (rs() - .5) * (Math.PI / N) * .8, d = PLAY_R * (.34 + rs() * .16), r = N <= 3 ? 40 : N <= 4 ? 36 : 30;
    let dd = d, x = CX + Math.cos(a) * dd, y = CY + Math.sin(a) * dd;
    for (let k = 0; k < 20 && S.teams.some((o: any) => Math.hypot(o.zone.x - x, o.zone.y - y) < MIN_GAP); k++) { dd += 6; x = CX + Math.cos(a) * dd; y = CY + Math.sin(a) * dd; }
    // Move a start area that is mostly water or buildings in towards the centre.
    for (let k = 0; k < 20; k++) {
      let bad = 0, all = 0;
      for (let dy = -r; dy <= r; dy += 4) for (let dx = -r; dx <= r; dx += 4) { if (dx * dx + dy * dy > r * r) continue; const ci = cellOf(x + dx, y + dy); all++; if (ci < 0 || !M.play[ci] || !passTerr(M.terr[ci])) bad++; }
      if (bad < all * .35) break;
      // Moving in must not bring it too near another side's start area.
      const nx = x + (CX - x) * .12, ny = y + (CY - y) * .12; if (S.teams.some((o: any) => Math.hypot(o.zone.x - nx, o.zone.y - ny) < MIN_GAP)) break;
      x = nx; y = ny;
    }
    // The HQ flag stands on open ground near the start point: fields or grass first, a road if nothing else.
    const open = (pref: number[]) => { for (let rr = 0; rr <= 40; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue; const px = x + dx * C, py = y + dy * C, ci = cellOf(px, py); if (ci < 0 || !M.play[ci] || !pref.includes(M.terr[ci])) continue;
      let clear = true; for (let ey = -2; ey <= 2 && clear; ey++) for (let ex = -2; ex <= 2; ex++) { const n = cellOf(px + ex * C, py + ey * C); if (n < 0 || M.terr[n] === T_BUILD || M.terr[n] === T_WATER || M.terr[n] === T_BRIDGE) { clear = false; break; } }
      if (clear) return [Math.floor(px / C) * C + 1, Math.floor(py / C) * C + 1]; } return null; };
    const spot = open([T_GROUND, T_PARK, T_ROAD]); if (spot) { x = spot[0]; y = spot[1]; }
    const c = i === NET.me ? 0 : i === 0 ? NET.me : i; S.teams.push({ id: i, name: TEAM_NAMES[c], color: TEAM_COLORS[c], human: i === 0 || (NET.mode !== 'solo' && i === (S.coop ? 0 : 1)), zone: { x, y, r } });
  }
}
export function rollPersonalities() { for (const t of S.teams) { t.rng = mulberry32((Math.random() * 1e9) | 0); t.per = t.human ? PERS[1] : PERS[Math.floor(Math.random() * PERS.length)]; } }
export function initOwn() { OWN.fill(-1); for (let i = 0; i < OWN.length; i++) { const [x, y] = cellPos(i); let bd = 1e9; for (const t of S.teams) { const d = Math.hypot(x - t.zone.x, y - t.zone.y); if (d <= t.zone.r && d < bd) { bd = d; OWN[i] = t.id; } } } }

export function nextCall(team: number) { const n = S.callN[team] = (S.callN[team] || 0) + 1; return CALLSIGNS[(n - 1) % CALLSIGNS.length]; }
export function aliveMembers(s: any) { return s.members ? s.members.map((i: number) => S.units[i]).filter((u: any) => u.alive) : []; }
export function centroid(s: any) { let x = 0, y = 0; for (const p of s.pos) { x += p[0]; y += p[1]; } return [x / s.pos.length, y / s.pos.length]; }
export function sqCenter(s: any) { if (!s.members) return centroid(s); const m = aliveMembers(s); if (!m.length) return null; let x = 0, y = 0; for (const u of m) { x += u.x; y += u.y; } return [x / m.length, y / m.length]; }
export function itemCost(it: any) { if (it.cells) return it.cells.length * COST[it.type]; if (it.pos) return COST[it.kind]; return COST[it.type]; }
export function spentNow(team: number) { let c = 0; for (const a of [S.squads, S.structs, S.supports]) for (const it of a) if (it.team === team && !it.temp && it.round === S.round) c += itemCost(it); return c; }
// The bank is charged when a phase begins, so only planning subtracts this phase's purchases.
export const left = (team: number) => S.bank[team] - (S.phase === 'plan' ? spentNow(team) : 0);
export const sqName = (s: any) => s.call ? `${S.teams[s.team].name} ${s.call}` : `${S.teams[s.team].name} ${KIND_NAME[s.kind]}`;

// A point inside the building outline and at least 0.6 from its walls: the point itself, or the point moved toward the middle.
export function insideBld(b: any, x: number, y: number): number[] {
  const p = b.p as number[][];
  const inside = (px: number, py: number) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], q = p[j]; if ((a[1] > py) !== (q[1] > py) && px < (q[0] - a[0]) * (py - a[1]) / (q[1] - a[1]) + a[0]) c = !c; } return c; };
  const edge = (px: number, py: number) => { let d = 1e9; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[j], q = p[i], ex = q[0] - a[0], ey = q[1] - a[1], L = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * ex + (py - a[1]) * ey) / L)); d = Math.min(d, Math.hypot(a[0] + ex * t - px, a[1] + ey * t - py)); } return d; };
  for (let k = 0; k <= 10; k++) { const f = 1 - k / 10, px = b.cx + (x - b.cx) * f, py = b.cy + (y - b.cy) * f; if (inside(px, py) && edge(px, py) >= .6 && M.bldId[cellOf(px, py)] === b.id) return [px, py]; }
  return [x, y];
}
function addGarrison(team: number, x: number, y: number) {
  let id = -1, bd = 1e9; const c0 = Math.floor(x / C), r0 = Math.floor(y / C);
  // Only the building actually clicked (one cell of slack for edges).
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const cx = c0 + dx, cy = r0 + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue; const b = M.bldId[cy * GW + cx]; if (b >= 0 && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; id = b; } }
  if (id >= 0 && BTYPES[M.B[id].btype || 'house'].noGarrison) return null;
  if (id < 0 || S.squads.some((s: any) => s.kind === 'garrison' && s.bld === id && (!s.members || aliveMembers(s).length))) return null;
  const b = M.B[id]; if (!canDeploy(team, b.cx, b.cy)) return null;
  const cells: number[] = []; for (let ci = 0; ci < GW * GH; ci++) if (M.bldId[ci] === id) cells.push(ci);
  if (!cells.length) return null;
  const n = Math.min(10, cells.length), pos: number[][] = [];
  // Each man stands inside the outline, clear of the walls, so none hangs over the edge of the roof.
  for (let i = 0; i < n; i++) { const ci = cells[Math.floor(i * cells.length / n)]; pos.push(insideBld(b, (ci % GW) * C + 1, Math.floor(ci / GW) * C + 1)); }
  const s = { id: S.nextId++, team, kind: 'garrison', x: b.cx, y: b.cy, pos, order: null, round: S.round, call: nextCall(team), bld: id };
  S.squads.push(s); return s;
}
// Units must stand apart when placed: platoons need more room than single guns.
export function spacingOk(team: number, kind: string, x: number, y: number) {
  if (kind === 'garrison') return true;
  for (const o of S.squads) {
    // Deployed platoons and tanks move about; only units standing still need room.
    if (o.team !== team || o.kind === 'garrison' || (o.members && MOVERS.includes(o.kind))) continue; const c = sqCenter(o); if (!c) continue;
    const gap = PLATOON_SIZE[kind] || PLATOON_SIZE[o.kind] ? 6 : 3; if (Math.hypot(c[0] - x, c[1] - y) < gap) return false;
  }
  return true;
}
// Where a new unit goes for a click: the spot itself, or the nearest free spot round it when another unit
// stands there, so a click a little off still places the unit. Null when there is no room close by.
export function placeSpot(team: number, kind: string, x: number, y: number): [number, number] | null {
  const ok = (px: number, py: number) => canPlaceUnit(team, kind, px, py) && spacingOk(team, kind, px, py) && (kind !== 'tank' || passable(cellOf(px, py), true));
  if (kind === 'garrison') return canPlaceUnit(team, kind, x, y) ? [x, y] : null;
  if (!canPlaceUnit(team, kind, x, y)) return null;
  for (let r = 0; r <= 14; r += 1.5) for (let k = 0, n = r ? Math.ceil(r * 2) : 1; k < n; k++) { const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (ok(px, py)) return [px, py]; }
  return null;
}
// Where each man of a new unit stands for a click. The placement preview uses the same layout,
// so what the player sees is where the men go. No man stands in a building, in water or on a bridge.
export function squadLayout(team: number, kind: string, x: number, y: number): { p: number[]; pos: number[][] } | null {
  const ok = (px: number, py: number) => canPlaceUnit(team, kind, px, py) && (kind !== 'tank' || passable(cellOf(px, py), true));
  const spot = placeSpot(team, kind, x, y); if (!spot) return null; const p = nudge(spot[0], spot[1], ok); if (!p) return null;
  const pos: number[][] = [], used = new Set<number>();
  if (PLATOON_SIZE[kind]) {
    const r = mulberry32((S.nextId * 7919) ^ team);
    for (let i = 0; i < PLATOON_SIZE[kind]; i++) {
      const gx = (i % 4 - 1.5) * 2.3 + (r() - .5) * .8, gy = (Math.floor(i / 4) - 1.5) * 2.3 + (r() - .5) * .8, jx = (r() - .5) * .9, jy = (r() - .5) * .9;
      // Two men do not share one cell, so a squad pushed against a wall spreads out and does not pile up.
      const q = nudge(p[0] + gx, p[1] + gy, (px, py) => ok(px, py) && !used.has(cellOf(px, py))) || nudge(p[0] + gx, p[1] + gy, ok);
      if (q) { used.add(cellOf(q[0], q[1])); pos.push([q[0] + jx, q[1] + jy]); }
    }
  } else pos.push(p);
  return pos.length ? { p, pos } : null;
}
// face: the way the unit watches (snipers), in radians.
export function addSquad(team: number, kind: string, x: number, y: number, face?: number): any {
  if (left(team) < COST[kind] || !isAllowed(kind)) return null;
  if (kind === 'garrison') return addGarrison(team, x, y);
  const L = squadLayout(team, kind, x, y); if (!L) return null; const { p, pos } = L;
  // FOBs and heavy weapons take the coming phase to build.
  const s = { id: S.nextId++, team, kind, x: p[0], y: p[1], pos, order: null, round: S.round, face, call: MOVERS.includes(kind) ? nextCall(team) : null, readyRound: kind === 'fob' || ENG_BUILD.includes(kind) ? S.round + 1 : 0 };
  S.squads.push(s); return s;
}
export function lineCells(team: number, a: any, b: any) {
  const out: number[] = [], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / 0.7)), used = new Set<number>();
  S.structs.forEach((s: any) => s.cells.forEach((c: number) => used.add(c)));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n, ci = cellOf(x, y);
    if (ci < 0 || out.includes(ci) || used.has(ci)) continue;
    if (!passTerr(M.terr[ci]) || M.terr[ci] === T_BRIDGE) continue;
    if (!canDeploy(team, x, y)) continue; out.push(ci);
  }
  return out;
}
export function addStruct(team: number, type: string, a: any, b: any) {
  if (!isAllowed(type)) return null;
  const cells = lineCells(team, a, b); if (!cells.length || left(team) < cells.length * COST[type]) return null;
  const s = { id: S.nextId++, team, type, a, b, cells, round: S.round }; S.structs.push(s); return s;
}
// Support (spy planes, artillery, air, paradrops, charges) is ready from phase 2.
export const SUPPORT_ROUND = 2;
export function addSupport(team: number, type: string, a: any, b: any, t: number) { if ((S.round < SUPPORT_ROUND && type !== 'smoke') || left(team) < COST[type] || !isAllowed(type)) return null; const s: any = { id: S.nextId++, team, type, a, b, t, round: S.round }; S.supports.push(s); return s; }
export function clearMine(team: number) {
  const mine = (it: any) => it.team === team && it.round === S.round && !it.members;
  S.squads = S.squads.filter((s: any) => !mine(s)); S.structs = S.structs.filter((s: any) => !mine(s)); S.supports = S.supports.filter((s: any) => !mine(s));
  S.squads.forEach((s: any) => { if (s.team === team) s.order = null; });
}
export const canRemove = (it: any) => S.phase === 'plan' && it.team === NET.me && it.round === S.round && !it.members && !it.live;
export function removeItem(it: any) { for (const k of ['squads', 'structs', 'supports']) { const i = S[k].indexOf(it); if (i >= 0) S[k].splice(i, 1); } }
