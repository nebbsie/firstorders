// Walls from the map data. A wall is a line in the data. In the game it becomes a thin building with straight sides:
// nothing walks through it, men behind it have cover, and it can be shot down. Castle and town walls are tall,
// with battlements; garden and field walls are low.
import { C, GW, GH, M_PER_UNIT } from '../config';
import { BTYPES } from './btypes';
import type { Building } from './types';

// The least thickness a wall is drawn with, in map units. Real walls can be under a metre thick, which looks like paper
// at the size of the game, so walls are drawn thicker than they are.
export const WALL_MIN = { rampart: 1.7, wall: .7 };
// Push a closed outline out by d on every side. Corners are mitred, with a limit so a sharp point does not make a spike.
// A thin band (a wall mapped as an area) becomes 2d thicker.
export function grow(p: number[][], d: number) {
  let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  const sg = a > 0 ? 1 : -1, n = p.length;
  const nrm = (q: number[], r: number[]) => { const dx = r[0] - q[0], dy = r[1] - q[1], l = Math.hypot(dx, dy) || 1; return [dy / l * sg, -dx / l * sg]; };
  return p.map((q, i) => {
    const n0 = nrm(p[(i - 1 + n) % n], q), n1 = nrm(q, p[(i + 1) % n]);
    let mx = n0[0] + n1[0], my = n0[1] + n1[1]; const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1[0]; my = n1[1]; } else { mx /= ml; my /= ml; }
    const k = d / Math.max(.5, mx * n1[0] + my * n1[1]);
    return [q[0] + mx * k, q[1] + my * k];
  });
}
// Remove points that lie on a nearly straight run, so each side of the wall is one clean face.
function straighten(pts: number[][], tol: number) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], p = pts[i], b = pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) < tol) continue;
    if (L > 1e-6 && Math.abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / L < tol) continue;
    out.push(p);
  }
  out.push(pts[pts.length - 1]); return out;
}
// The outline of a wall of width w along a line: one side forward, the other side back.
// Corners are mitred, with a limit so a sharp turn does not make a long spike.
function band(pts: number[][], w: number) {
  const n = pts.length, L: number[][] = [], R: number[][] = [], hw = w / 2;
  const nrm = (a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  for (let i = 0; i < n; i++) {
    const n0 = i > 0 ? nrm(pts[i - 1], pts[i]) : nrm(pts[0], pts[1]), n1 = i < n - 1 ? nrm(pts[i], pts[i + 1]) : n0;
    let mx = n0[0] + n1[0], my = n0[1] + n1[1]; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const k = hw / Math.max(.5, mx * n1[0] + my * n1[1]);
    L.push([pts[i][0] + mx * k, pts[i][1] + my * k]); R.push([pts[i][0] - mx * k, pts[i][1] - my * k]);
  }
  return L.concat(R.reverse());
}
// The length of one wall piece, in map units.
const PIECE = 9;
// Cut a line into pieces of about len each. The pieces share their end points, so the wall has no gaps.
function chop(pts: number[][], len: number) {
  let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const n = Math.max(1, Math.round(total / len)), each = total / n, out: number[][][] = []; let cur = [pts[0]], acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (out.length < n - 1 && acc + seg >= each) {
      const f = (each - acc) / seg, c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      cur.push(c); out.push(cur); cur = [c]; seg -= each - acc; acc = 0; a = c;
    }
    acc += seg; cur.push(b);
  }
  if (cur.length >= 2) out.push(cur);
  return out.filter(p => p.length >= 2 && Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]) > .05);
}
// blocked(ci): a cell the wall must leave open (a road, water, a bridge).
export function wallBuildings(lines: { pts: number[][]; city: boolean }[], gates: number[][], blocked: (ci: number) => boolean): Building[] {
  const out: Building[] = [], step = .4, gateR = C * 1.3;
  for (const ln of lines) {
    const BT = BTYPES[ln.city ? 'rampart' : 'wall'];
    // Real sizes, but never so small that the wall cannot be seen.
    const w = ln.city ? Math.max(WALL_MIN.rampart, 4 / M_PER_UNIT) : Math.max(WALL_MIN.wall, 1 / M_PER_UNIT);
    const h = ln.city ? Math.max(2.4, (BT.minH || 7) / M_PER_UNIT) : Math.max(.5, 1.8 / M_PER_UNIT);
    // Walk along the line in short steps and keep the runs that are clear of roads, water and gates.
    const runs: number[][][] = []; let run: number[][] = [];
    const open = (x: number, y: number) => {
      const cx = Math.floor(x / C), cy = Math.floor(y / C);
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || blocked(cy * GW + cx)) return false;
      for (const g of gates) if (Math.hypot(g[0] - x, g[1] - y) < gateR) return false;
      return true;
    };
    for (let i = 0; i < ln.pts.length - 1; i++) {
      const a = ln.pts[i], b = ln.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / step));
      for (let j = i ? 1 : 0; j <= k; j++) {
        const x = a[0] + (b[0] - a[0]) * j / k, y = a[1] + (b[1] - a[1]) * j / k;
        // Keep the real corner points, so a straight side stays straight.
        if (open(x, y)) run.push(j === k ? b : j === 0 ? a : [x, y]);
        else if (run.length) { runs.push(run); run = []; }
      }
    }
    if (run.length) runs.push(run);
    for (const r of runs) {
      const s = straighten(r, .15); let len = 0; for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      if (s.length < 2 || len < .8) continue;
      // Each wall is made of short pieces, so a shell or an engineers' charge breaks a gap, not the whole wall.
      for (const piece of chop(s, PIECE)) {
        const p = band(piece, w), v = ((piece[0][0] * 7.31 + piece[0][1] * 3.17) % 1 + 1) % 1;
        out.push({ p, h, v, mat: BT.roof, btype: ln.city ? 'rampart' : 'wall', name: ln.city ? 'Town wall' : undefined, thin: true });
      }
    }
  }
  return out;
}
