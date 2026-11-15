import { W, H, C, GW, GH, IW, IC, T_WATER, T_BUILD, T_BRIDGE, clamp, inPlay } from './config';
import { S, M, OWN } from './state';

export const cellOf = (x: number, y: number) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); return (cx < 0 || cy < 0 || cx >= GW || cy >= GH) ? -1 : cy * GW + cx; };
export function unitH(x: number, y: number) { const h = M.hAt(x, y), ci = cellOf(x, y); if (ci < 0) return h; return Math.max(h, M.deck[ci], M.terr[ci] === T_BUILD ? M.bldTop[ci] : -99); }
export const passTerr = (t: number) => t !== T_WATER && t !== T_BUILD;
export function passable(ci: number, veh?: boolean) { if (ci < 0 || !M.play[ci]) return false; if (!passTerr(M.terr[ci])) return false; if (!S.cover) return true; const c = S.cover[ci]; return !(c === 3 || (veh && c === 5)); }
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
