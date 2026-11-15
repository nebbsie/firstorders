import { W, H, C, GW, GH, IW, IC, T_WATER, T_BUILD, T_BRIDGE, T_WOOD, T_ROAD, clamp, inPlay } from './config';
import { S, M, OWN } from './state';

export const cellOf = (x: number, y: number) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); return (cx < 0 || cy < 0 || cx >= GW || cy >= GH) ? -1 : cy * GW + cx; };
export function unitH(x: number, y: number) { const h = M.hAt(x, y), ci = cellOf(x, y); if (ci < 0) return h; return Math.max(h, M.deck[ci], M.terr[ci] === T_BUILD ? M.bldTop[ci] : -99); }
export const passTerr = (t: number) => t !== T_WATER && t !== T_BUILD;
// Tanks cannot go into woods.
function open1(ci: number, veh?: boolean) { if (ci < 0 || !M.play[ci]) return false; if (!passTerr(M.terr[ci])) return false; if (veh && M.terr[ci] === T_WOOD) return false; if (!S.cover) return true; const c = S.cover[ci]; return !(c === 3 || (veh && c === 5)); }
// Tanks need room: off roads and bridges, every cell next to them must be open too, so they go the long way
// round instead of squeezing between houses, trees or walls.
export function passable(ci: number, veh?: boolean) {
  if (!open1(ci, veh)) return false; if (!veh) return true;
  const t = M.terr[ci]; if (t === T_ROAD || t === T_BRIDGE) return true;
  const x = ci % GW, y = (ci / GW) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || !open1(ny * GW + nx, true)) return false; }
  return true;
}
export function wallAt(ci: number) { for (const s of S.structs) if (s.type === 'wall' && s.cells.includes(ci)) return true; return false; }
export function nudge(x: number, y: number, check?: (x: number, y: number) => boolean): [number, number] | null {
  const c0 = Math.floor(x / C), r0 = Math.floor(y / C);
  for (let r = 0; r <= 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const cx = c0 + dx, cy = r0 + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue;
    const ci = cy * GW + cx; if (!M.play[ci] || !passTerr(M.terr[ci]) || wallAt(ci)) continue;
    const px = cx * C + 1, py = cy * C + 1; if (check && !check(px, py)) continue; return [px, py];
  }
  return null;
}
export const ownerAt = (x: number, y: number) => OWN[Math.floor(clamp(y, 0, H - .01) / IC) * IW + Math.floor(clamp(x, 0, W - .01) / IC)];
export const canDeploy = (t: number, x: number, y: number) => inPlay(x, y, 2) && ownerAt(x, y) === t;
// New units arrive at the start area. Engineers can also build mortars, MG nests and posts near where they stand.
// Heavy weapons go in the start area or round a finished FOB. Engineers build FOBs near where they stand.
export const ENG_BUILD = ['mortar', 'mg', 'op', 'at'], ENG_R = 30, FOB_R = 36;
export const inSpawn = (t: number, x: number, y: number) => { const z = S.teams[t].zone; return Math.hypot(x - z.x, y - z.y) <= z.r && canDeploy(t, x, y); };
export function nearEngineers(t: number, x: number, y: number) {
  for (const s of S.squads) if (s.team === t && s.kind === 'engineers' && s.members) for (const i of s.members) { const u = S.units[i]; if (u.alive && Math.hypot(u.x - x, u.y - y) <= ENG_R) return true; }
  return false;
}
export function nearFob(t: number, x: number, y: number) {
  for (const s of S.squads) if (s.team === t && s.kind === 'fob' && s.members && (s.readyRound || 0) <= S.round) { const u = S.units[s.members[0]]; if (u && u.alive && Math.hypot(u.x - x, u.y - y) <= FOB_R) return true; }
  return false;
}
export const canPlaceUnit = (t: number, kind: string, x: number, y: number) => kind === 'garrison' ? canDeploy(t, x, y) : kind === 'fob' ? inPlay(x, y, 2) && nearEngineers(t, x, y) : inSpawn(t, x, y) || (ENG_BUILD.includes(kind) && inPlay(x, y, 2) && nearFob(t, x, y));
export const cellPos = (i: number) => [(i % IW) * IC + 2, Math.floor(i / IW) * IC + 2];
export function bldNear(x: number, y: number) { let n = 0; const c0 = Math.floor(x / C), r0 = Math.floor(y / C); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const cx = c0 + dx, cy = r0 + dy; if (cx >= 0 && cy >= 0 && cx < GW && cy < GH && M.terr[cy * GW + cx] === T_BUILD) n++; } return n; }
export function waterBetween(ax: number, ay: number, bx: number, by: number) { let n = 0; for (let k = 1; k < 40; k++) { const ci = cellOf(ax + (bx - ax) * k / 40, ay + (by - ay) * k / 40); if (ci >= 0 && (M.terr[ci] === T_WATER || M.terr[ci] === T_BRIDGE)) n++; } return n >= 2; }
export function bridgeNear(x: number, y: number) {
  let best = -1, bd = 7;
  M.bridges.forEach((br, i) => { if (br.blown != null) return; for (const c of br.cells) { const d = Math.hypot((c % GW) * C + 1 - x, Math.floor(c / GW) * C + 1 - y); if (d < bd) { bd = d; best = i; } } });
  return best;
}
export const bridgeTouches = (i: number, team: number) => M.bridges[i].ends.some(c => ownerAt((c % GW) * C + 1, Math.floor(c / GW) * C + 1) === team);
// An observation post sees further from high ground.
export const opRange = (f: { x: number; y: number }) => 90 + Math.max(0, M.hAt(f.x, f.y) - 6) * 3;
