import { C, GW, GH, COST, KIND_NAME, TEAM_COLORS, TEAM_NAMES, CALLSIGNS, PERS, T_BRIDGE, CX, CY, PLAY_R, mulberry32 } from './config';
import { S, M, OWN } from './state';
import { cellOf, passTerr, nudge, canDeploy, cellPos } from './world';

export function makeTeams() {
  S.teams = []; const N = S.nTeams;
  for (let i = 0; i < N; i++) {
    const a = 2.356 + i * Math.PI * 2 / N, r = N <= 3 ? 40 : N <= 4 ? 36 : 30;
    let x = CX + Math.cos(a) * PLAY_R * .68, y = CY + Math.sin(a) * PLAY_R * .68;
    // Move a start area that is mostly water or buildings in towards the centre.
    for (let k = 0; k < 20; k++) {
      let bad = 0, all = 0;
      for (let dy = -r; dy <= r; dy += 4) for (let dx = -r; dx <= r; dx += 4) { if (dx * dx + dy * dy > r * r) continue; const ci = cellOf(x + dx, y + dy); all++; if (ci < 0 || !M.play[ci] || !passTerr(M.terr[ci])) bad++; }
      if (bad < all * .35) break;
      x += (CX - x) * .12; y += (CY - y) * .12;
    }
    S.teams.push({ id: i, name: TEAM_NAMES[i], color: TEAM_COLORS[i], ai: i > 0, zone: { x, y, r } });
  }
}
export function rollPersonalities() { for (const t of S.teams) { t.rng = mulberry32((Math.random() * 1e9) | 0); t.per = t.id === 0 ? PERS[1] : PERS[Math.floor(Math.random() * PERS.length)]; } }
export function initOwn() { OWN.fill(-1); for (let i = 0; i < OWN.length; i++) { const [x, y] = cellPos(i); for (const t of S.teams) if (Math.hypot(x - t.zone.x, y - t.zone.y) <= t.zone.r) OWN[i] = t.id; } }

export function nextCall(team: number) { const n = S.callN[team] = (S.callN[team] || 0) + 1; return CALLSIGNS[(n - 1) % CALLSIGNS.length]; }
export function aliveMembers(s: any) { return s.members ? s.members.map((i: number) => S.units[i]).filter((u: any) => u.alive) : []; }
export function centroid(s: any) { let x = 0, y = 0; for (const p of s.pos) { x += p[0]; y += p[1]; } return [x / s.pos.length, y / s.pos.length]; }
export function sqCenter(s: any) { if (!s.members) return centroid(s); const m = aliveMembers(s); if (!m.length) return null; let x = 0, y = 0; for (const u of m) { x += u.x; y += u.y; } return [x / m.length, y / m.length]; }
export function itemCost(it: any) { if (it.cells) return it.cells.length * COST[it.type]; if (it.pos) return COST[it.kind]; return COST[it.type]; }
export function spentNow(team: number) { let c = 0; for (const a of [S.squads, S.structs, S.supports]) for (const it of a) if (it.team === team && !it.temp && it.round === S.round) c += itemCost(it); return c; }
// The bank is charged when a phase begins, so only planning subtracts this phase's purchases.
export const left = (team: number) => S.bank[team] - (S.phase === 'plan' ? spentNow(team) : 0);
export const sqName = (s: any) => s.call ? `${S.teams[s.team].name} ${s.call}` : `${S.teams[s.team].name} ${KIND_NAME[s.kind]}`;

function addGarrison(team: number, x: number, y: number) {
  let id = -1, bd = 1e9; const c0 = Math.floor(x / C), r0 = Math.floor(y / C);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const cx = c0 + dx, cy = r0 + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue; const b = M.bldId[cy * GW + cx]; if (b >= 0 && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; id = b; } }
  if (id < 0 || S.squads.some((s: any) => s.kind === 'garrison' && s.bld === id && (!s.members || aliveMembers(s).length))) return null;
  const b = M.B[id]; if (!canDeploy(team, b.cx, b.cy)) return null;
  const cells: number[] = []; for (let ci = 0; ci < GW * GH; ci++) if (M.bldId[ci] === id) cells.push(ci);
  if (!cells.length) return null;
  const n = Math.min(10, cells.length), pos: number[][] = [];
  for (let i = 0; i < n; i++) { const ci = cells[Math.floor(i * cells.length / n)]; pos.push([(ci % GW) * C + 1, Math.floor(ci / GW) * C + 1]); }
  const s = { id: S.nextId++, team, kind: 'garrison', x: b.cx, y: b.cy, pos, order: null, round: S.round, call: nextCall(team), bld: id };
  S.squads.push(s); return s;
}
export function addSquad(team: number, kind: string, x: number, y: number): any {
  if (kind === 'garrison') return addGarrison(team, x, y);
  const ok = (px: number, py: number) => canDeploy(team, px, py); const p = nudge(x, y, ok); if (!p) return null;
  const pos: number[][] = [];
  if (kind === 'rifles') { const r = mulberry32((S.nextId * 7919) ^ team); for (let i = 0; i < 16; i++) { const gx = (i % 4 - 1.5) * 2.3 + (r() - .5) * .8, gy = (Math.floor(i / 4) - 1.5) * 2.3 + (r() - .5) * .8; const q = nudge(p[0] + gx, p[1] + gy, ok); if (q) pos.push([q[0] + (r() - .5) * .9, q[1] + (r() - .5) * .9]); } }
  else pos.push(p);
  if (!pos.length) return null;
  const s = { id: S.nextId++, team, kind, x: p[0], y: p[1], pos, order: null, round: S.round, call: kind === 'rifles' || kind === 'sniper' || kind === 'tank' ? nextCall(team) : null };
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
  const cells = lineCells(team, a, b); if (!cells.length || left(team) < cells.length * COST[type]) return null;
  const s = { id: S.nextId++, team, type, a, b, cells, round: S.round }; S.structs.push(s); return s;
}
export function addSupport(team: number, type: string, a: any, b: any, t: number) { const s: any = { id: S.nextId++, team, type, a, b, t, round: S.round }; S.supports.push(s); return s; }
export function clearMine(team: number) {
  const mine = (it: any) => it.team === team && it.round === S.round && !it.members;
  S.squads = S.squads.filter((s: any) => !mine(s)); S.structs = S.structs.filter((s: any) => !mine(s)); S.supports = S.supports.filter((s: any) => !mine(s));
  S.squads.forEach((s: any) => { if (s.team === team) s.order = null; });
}
export const canRemove = (it: any) => S.phase === 'plan' && it.team === 0 && it.round === S.round && !it.members;
export function removeItem(it: any) { for (const k of ['squads', 'structs', 'supports']) { const i = S[k].indexOf(it); if (i >= 0) S[k].splice(i, 1); } }
