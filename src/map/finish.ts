import { W, H, C, GW, GH, GS, CX, CY, PLAY_R, T_WATER, T_BRIDGE, T_BUILD, T_WOOD, T_PARK, T_ROAD, clamp, hashf, inPlay } from '../config';
import type { RawMap, MapData, Bridge } from './types';

const isWet = (t: number) => t === T_WATER || t === T_BRIDGE;

// Distance to the shore for every cell: positive inside water (depth), negative on land.
function waterDistance(terr: Uint8Array) {
  const N = GW * GH, dIn = new Float32Array(N).fill(1e9), dOut = new Float32Array(N).fill(1e9), q = new Int32Array(N);
  const bfs = (dist: Float32Array, seed: (t: number) => boolean) => {
    let h = 0, tl = 0;
    for (let i = 0; i < N; i++) if (seed(terr[i])) { dist[i] = 0; q[tl++] = i; }
    while (h < tl) {
      const c = q[h++], x = c % GW, y = (c / GW) | 0, d = dist[c] + C;
      const nb = [x > 0 ? c - 1 : -1, x < GW - 1 ? c + 1 : -1, y > 0 ? c - GW : -1, y < GH - 1 ? c + GW : -1];
      for (const n of nb) if (n >= 0 && dist[n] > d) { dist[n] = d; q[tl++] = n; }
    }
  };
  bfs(dOut, isWet); bfs(dIn, t => !isWet(t));
  const wd = new Float32Array(N);
  for (let i = 0; i < N; i++) wd[i] = isWet(terr[i]) ? Math.min(dIn[i], 20) : -Math.min(dOut[i], 20);
  return wd;
}

function pointIn(p: number[][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function rasterPoly(p: number[][], fn: (ci: number) => void) {
  let mnX = 1e9, mxX = -1e9, mnY = 1e9, mxY = -1e9;
  for (const [x, y] of p) { mnX = Math.min(mnX, x); mxX = Math.max(mxX, x); mnY = Math.min(mnY, y); mxY = Math.max(mxY, y); }
  for (let cy = Math.max(0, Math.floor(mnY / C)); cy <= Math.min(GH - 1, Math.floor(mxY / C)); cy++)
    for (let cx = Math.max(0, Math.floor(mnX / C)); cx <= Math.min(GW - 1, Math.floor(mxX / C)); cx++)
      if (pointIn(p, cx * C + 1, cy * C + 1)) fn(cy * GW + cx);
}

// Plain texture from the cells, for map sources that do not paint their own.
function paintGround(raw: RawMap, wd: Float32Array, hAt: (x: number, y: number) => number) {
  const gw = W * GS, gh = H * GS, cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
  const g = cv.getContext('2d'), img = g.createImageData(gw, gh), px = img.data;
  const WATER = [[64, 104, 122], [54, 92, 112], [46, 81, 101], [39, 71, 91], [32, 61, 80]];
  let prevRow = new Float32Array(gw), row = new Float32Array(gw);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x, wx = (x + .5) / GS, wy = (y + .5) / GS, ci = Math.min(GH - 1, Math.floor(wy / C)) * GW + Math.min(GW - 1, Math.floor(wx / C));
      const t = raw.terr[ci]; let r: number, gg: number, b: number; const h = hAt(wx, wy); row[x] = h;
      if (isWet(t)) { const c = WATER[Math.min(4, Math.floor(wd[ci] / 2.4))]; r = c[0]; gg = c[1]; b = c[2]; }
      else if (t === T_ROAD) { r = 58; gg = 56; b = 50; }
      else if (t === T_WOOD) { const tr = hashf(Math.floor(wx / 1.4), Math.floor(wy / 1.4), 9) > .5; r = tr ? 44 : 56; gg = tr ? 64 : 76; b = tr ? 36 : 44; }
      else if (t === T_PARK) { r = 84; gg = 106; b = 62; }
      else {
        const k = clamp((h - 3) / 14, 0, 1); r = 104 + k * 26; gg = 106 + k * 22; b = 84 + k * 10;
        if (raw.farm && raw.farm[ci] && Math.floor((wx * .8 + wy * .6) / 4) % 2) { r += 9; gg += 6; b -= 4; }
        if (x > 0 && y > 0) { const band = Math.floor(h / 1.65); if (band !== Math.floor(row[x - 1] / 1.65) || band !== Math.floor(prevRow[x] / 1.65)) { r -= 10; gg -= 10; b -= 8; } }
      }
      px[i * 4] = r; px[i * 4 + 1] = gg; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    const t = prevRow; prevRow = row; row = t;
  }
  g.putImageData(img, 0, 0);
  if (raw.paintOver) { g.save(); g.scale(GS, GS); raw.paintOver(g); g.restore(); }
  return cv;
}

// Outside the battle circle the map is scenery: grey, darker, with a thin light ring at the edge.
function greyOutside(cv: HTMLCanvasElement) {
  const g = cv.getContext('2d'), img = g.getImageData(0, 0, cv.width, cv.height), px = img.data, s = W / cv.width;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const d = Math.hypot((x + .5) * s - CX, (y + .5) * s - CY) - PLAY_R; if (d < 0) continue;
    const i = (y * cv.width + x) * 4, l = px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11, k = clamp(d / 4, 0, 1), dark = .72 - clamp(d / 160, 0, 1) * .25;
    for (let c = 0; c < 3; c++) px[i + c] = (px[i + c] * (1 - k) + l * k) * (1 - k * (1 - dark));
    if (d < 1.2) { px[i] = 200; px[i + 1] = 190; px[i + 2] = 150; }
  }
  g.putImageData(img, 0, 0);
}

export function finishMap(raw: RawMap): MapData {
  const terr = raw.terr, VW = GW + 1, VH = GH + 1, wd = waterDistance(terr);
  const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TH = new Float32Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
    let s = 0, n = 0;
    for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (ci >= 0 && cj >= 0 && ci < GW && cj < GH) { s += wd[cj * GW + ci]; n++; }
    const w = s / n, t = ss(-9, 0, w), base = raw.baseH[j * VW + i];
    TH[j * VW + i] = base * (1 - t) + (-1.2 - clamp(w, 0, 12) * .22) * t;
  }
  const hAt = (x: number, y: number) => {
    const fx = clamp(x, 0, W) / C, fy = clamp(y, 0, H) / C, i = Math.min(GW - 1, Math.floor(fx)), j = Math.min(GH - 1, Math.floor(fy)), u = fx - i, v = fy - j;
    const a = TH[j * VW + i], b = TH[j * VW + i + 1], c = TH[(j + 1) * VW + i], d = TH[(j + 1) * VW + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const ground = raw.ground || paintGround(raw, wd, hAt); greyOutside(ground);
  const play = new Uint8Array(GW * GH); for (let i = 0; i < play.length; i++) play[i] = inPlay((i % GW) * C + 1, Math.floor(i / GW) * C + 1) ? 1 : 0;

  const bldTop = new Float32Array(GW * GH), bldId = new Int32Array(GW * GH).fill(-1);
  const B = raw.B.filter(b => b.p.length >= 3);
  B.forEach((b, i) => {
    let base = 1e9, sx = 0, sy = 0; for (const q of b.p) { base = Math.min(base, hAt(q[0], q[1])); sx += q[0]; sy += q[1]; }
    b.id = i; b.base = base - .4; b.top = base + .3 + b.h; b.cx = sx / b.p.length; b.cy = sy / b.p.length;
    rasterPoly(b.p, ci => { if (isWet(terr[ci])) return; terr[ci] = T_BUILD; bldTop[ci] = b.top; bldId[ci] = i; });
  });

  // Bridges are connected groups of bridge cells. Their ends are the land cells beside them.
  const deck = new Float32Array(GW * GH).fill(-99), seen = new Uint8Array(GW * GH), bridges: Bridge[] = [];
  for (let s = 0; s < GW * GH; s++) {
    if (terr[s] !== T_BRIDGE || seen[s]) continue;
    const cells: number[] = [], stack = [s]; seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(); cells.push(c); const x = c % GW, y = (c / GW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const n = ny * GW + nx; if (!seen[n] && terr[n] === T_BRIDGE) { seen[n] = 1; stack.push(n); }
      }
    }
    // Main axis of the bridge cells, then the land on both banks along it.
    let sx = 0, sy = 0; for (const c of cells) { sx += (c % GW) * C + 1; sy += Math.floor(c / GW) * C + 1; } const cx = sx / cells.length, cy = sy / cells.length;
    let xx = 0, xy = 0, yy = 0; for (const c of cells) { const dx = (c % GW) * C + 1 - cx, dy = Math.floor(c / GW) * C + 1 - cy; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
    const ang = .5 * Math.atan2(2 * xy, xx - yy), ax = Math.cos(ang), ay = Math.sin(ang);
    let lo = 1e9, hi = -1e9, half = 0;
    for (const c of cells) { const dx = (c % GW) * C + 1 - cx, dy = Math.floor(c / GW) * C + 1 - cy, s = dx * ax + dy * ay; lo = Math.min(lo, s); hi = Math.max(hi, s); half = Math.max(half, Math.abs(-dx * ay + dy * ax)); }
    half = Math.max(half, C * .8);
    // Ramps: land cells in line with the bridge where the bank was cut down for the river. The deck runs straight
    // from natural ground on one bank to natural ground on the other, so troops walk on and off it.
    const ramp: number[] = [], inRamp = new Set<number>(); let sA = lo, sB = hi;
    for (const [dir, from] of [[-1, lo], [1, hi]] as [number, number][]) {
      let s = from;
      for (let k = 1; k <= 8; k++) {
        const ss = from + dir * k * C, px = cx + ax * ss, py = cy + ay * ss, ci = Math.floor(py / C) * GW + Math.floor(px / C);
        if (px < 0 || py < 0 || px >= W || py >= H || isWet(terr[ci]) || wd[ci] < -9) break; s = ss;
        for (let w = -half; w <= half + .01; w += C * .5) { const qx = px - ay * w, qy = py + ax * w, q = Math.floor(qy / C) * GW + Math.floor(qx / C); if (q >= 0 && q < GW * GH && !isWet(terr[q]) && terr[q] !== T_BUILD && !inRamp.has(q)) { inRamp.add(q); ramp.push(q); } }
      }
      if (dir < 0) sA = s; else sB = s;
    }
    const hA = hAt(cx + ax * (sA - C), cy + ay * (sA - C)), hB = hAt(cx + ax * (sB + C), cy + ay * (sB + C));
    const deckAt = (c: number) => { const s = ((c % GW) * C + 1 - cx) * ax + (Math.floor(c / GW) * C + 1 - cy) * ay, f = clamp((s - sA) / Math.max(1, sB - sA), 0, 1); return Math.max(hA + (hB - hA) * f, isWet(terr[c]) ? 1.6 : -9) + .15; };
    for (const c of cells) deck[c] = deckAt(c);
    // Raise the banks under the ramps into an embankment that meets the deck.
    for (const c of ramp) {
      const d = deckAt(c) - .15, i = c % GW, j = Math.floor(c / GW);
      for (const [vi, vj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) TH[vj * VW + vi] = Math.max(TH[vj * VW + vi], d);
    }
    const ends = ramp.length ? ramp : cells;
    const top = Math.max(hA, hB) + .15, span = { ax, ay, s0: lo - C * .6, s1: hi + C * .6, half: half + C * .5, h0: hA + (hB - hA) * clamp((lo - C * .6 - sA) / Math.max(1, sB - sA), 0, 1) + .15, h1: hA + (hB - hA) * clamp((hi + C * .6 - sA) / Math.max(1, sB - sA), 0, 1) + .15 };
    bridges.push({ cells, ramp, ends, deck: top, cx, cy, blown: null, span });
  }

  const trees: number[][] = [];
  for (let ci = 0; ci < GW * GH; ci++) {
    const t = terr[ci]; if (t !== T_WOOD && t !== T_PARK) continue;
    const x = (ci % GW) * C + 1, y = Math.floor(ci / GW) * C + 1;
    if (hashf(x, y, 3) < (t === T_WOOD ? .42 : .05)) trees.push([x + (hashf(x, y, 4) - .5) * 1.6, y + (hashf(x, y, 5) - .5) * 1.6, 3 + hashf(x, y, 6) * 4]);
  }
  return { seed: raw.seed, name: raw.name, source: raw.source, credit: raw.credit, ground, terr, terr0: terr.slice(), TH, hAt, deck, deck0: deck.slice(), bridges, B, trees, bldTop, bldId, count: B.length, play };
}
