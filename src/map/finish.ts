import { W, H, C, GW, GH, GS, CX, CY, PLAY_R, T_WATER, T_BRIDGE, T_BUILD, T_WOOD, T_PARK, T_ROAD, M_PER_UNIT, clamp, hashf, inPlay } from '../config';
import { BTYPES, TOWER_NAME } from './btypes';
import { grow, WALL_MIN } from './walls';
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
      // Imported maps paint smooth roads over the texture; the blocky road cells stay plain ground under them.
      else if (t === T_ROAD && !raw.paintOver) { r = 58; gg = 56; b = 50; }
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

// A very light blur works as anti-aliasing: road and field edges stay sharp but lose their pixel steps.
function soften(cv: HTMLCanvasElement) {
  const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height; const g = out.getContext('2d');
  g.drawImage(cv, 0, 0); g.filter = 'blur(.7px)'; g.drawImage(cv, 0, 0); g.filter = 'none'; return out;
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
  // Water level: every lake, pond and river stretch sits just below its own banks, not at one height for
  // the whole map. Each cell takes the bank height of the nearest shore, then the levels are smoothed.
  const N = GW * GH, cb = new Float32Array(N), wl = new Float32Array(N).fill(NaN), q = new Int32Array(N);
  for (let c = 0; c < N; c++) { const i = c % GW, j = (c / GW) | 0; cb[c] = (raw.baseH[j * VW + i] + raw.baseH[j * VW + i + 1] + raw.baseH[(j + 1) * VW + i] + raw.baseH[(j + 1) * VW + i + 1]) / 4; }
  const nb4 = (c: number) => { const i = c % GW, j = (c / GW) | 0; return [i > 0 ? c - 1 : -1, i < GW - 1 ? c + 1 : -1, j > 0 ? c - GW : -1, j < GH - 1 ? c + GW : -1]; };
  let qh = 0, qt = 0;
  for (let c = 0; c < N; c++) { if (!isWet(terr[c])) continue; let lo = Infinity; for (const n of nb4(c)) if (n >= 0 && !isWet(terr[n])) lo = Math.min(lo, cb[n]); if (lo < Infinity) { wl[c] = lo - .5; q[qt++] = c; } }
  while (qh < qt) { const c = q[qh++]; for (const n of nb4(c)) if (n >= 0 && isNaN(wl[n])) { wl[n] = wl[c]; q[qt++] = n; } }
  for (let c = 0; c < N; c++) if (isNaN(wl[c])) wl[c] = -.5;
  for (let pass = 0; pass < 3; pass++) { const src = wl.slice(); for (let c = 0; c < N; c++) { if (!isWet(terr[c])) continue; let s = 0, k = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = c % GW + dx, j = ((c / GW) | 0) + dy; if (i < 0 || j < 0 || i >= GW || j >= GH) continue; const n = j * GW + i; if (isWet(terr[n])) { s += src[n]; k++; } } wl[c] = s / k; } }
  const TH = new Float32Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
    let s = 0, n = 0, lv = 0;
    for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (ci >= 0 && cj >= 0 && ci < GW && cj < GH) { s += wd[cj * GW + ci]; lv += wl[cj * GW + ci]; n++; }
    const w = s / n, t = ss(-9, 0, w), base = raw.baseH[j * VW + i];
    // The ground meets the water level right at the shore (w = 0) and drops away under it, so the water's edge
    // is where the smooth ground surface cuts the water surface, not a line of square cells.
    const L = Math.min(base, lv / n);
    TH[j * VW + i] = w <= 0 ? base * (1 - t) + (L + .2) * t : L + .2 - clamp(w, 0, 12) * .45;
  }
  const hAt = (x: number, y: number) => {
    const fx = clamp(x, 0, W) / C, fy = clamp(y, 0, H) / C, i = Math.min(GW - 1, Math.floor(fx)), j = Math.min(GH - 1, Math.floor(fy)), u = fx - i, v = fy - j;
    const a = TH[j * VW + i], b = TH[j * VW + i + 1], c = TH[(j + 1) * VW + i], d = TH[(j + 1) * VW + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const ground = soften(raw.ground || paintGround(raw, wd, hAt)); greyOutside(ground);
  const play = new Uint8Array(GW * GH); for (let i = 0; i < play.length; i++) play[i] = inPlay((i % GW) * C + 1, Math.floor(i / GW) * C + 1) ? 1 : 0;

  const bldTop = new Float32Array(GW * GH), bldId = new Int32Array(GW * GH).fill(-1);
  const B = raw.B.filter(b => b.p.length >= 3); for (const b of B) { delete b.parent; delete b.parts; delete b.spire; }
  // Castle work spreads to its neighbours. A named tower near a castle is a castle tower. An unnamed, long and narrow
  // building that touches castle work is a stretch of curtain wall (many town walls are mapped like that).
  {
    const box = B.map(b => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of b.p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return [x0, x1, y0, y1]; });
    const gap = (i: number, j: number) => Math.max(0, box[i][0] - box[j][1], box[j][0] - box[i][1], box[i][2] - box[j][3], box[j][2] - box[i][3]);
    const thick = (b: typeof B[0]) => { let a = 0, per = 0; for (let i = 0; i < b.p.length; i++) { const p = b.p[i], q = b.p[(i + 1) % b.p.length]; a += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); } return [Math.abs(a) / per * M_PER_UNIT, per * M_PER_UNIT]; };
    const fort = (b: typeof B[0]) => b.btype === 'castle' || b.btype === 'rampart';
    for (let pass = 0; pass < 6; pass++) {
      const forts = B.map((b, i) => fort(b) ? i : -1).filter(i => i >= 0); if (!forts.length) break; let changed = false;
      B.forEach((b, i) => {
        if (fort(b) || b.btype === 'wall') return;
        const named = !!b.name && TOWER_NAME.test(b.name), [th, per] = named ? [0, 0] : thick(b), narrow = !b.name && th < 7 && per > 40;
        if (!named && !narrow) return;
        const reach = named ? 30 / M_PER_UNIT + 4 : .8;
        if (!forts.some(j => gap(i, j) <= reach)) return;
        b.btype = named ? 'castle' : 'rampart'; const BT = BTYPES[b.btype]; b.h = Math.max(b.h, ((BT.minH || 7) + (named ? (b.v || 0) * 6 : 0)) / M_PER_UNIT); b.mat = BT.roof; changed = true;
      });
      if (!changed) break;
    }
  }
  // Long thin outlines are walls: a castle's curtain wall is often mapped as one thin ring. The mean thickness of an
  // outline is twice its area over its length round. Under 2.5 m, it is a wall: the cell grid takes every cell it
  // touches, so men cannot slip through. A castle's thin outline becomes a castle wall with battlements.
  for (const b of B) {
    if (b.thin) continue; let a = 0, per = 0;
    for (let i = 0; i < b.p.length; i++) { const p = b.p[i], q = b.p[(i + 1) % b.p.length]; a += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    const thick = Math.abs(a) / per * M_PER_UNIT; if (thick >= 2.5 || per * M_PER_UNIT < 30) continue;
    b.thin = true;
    if (b.btype === 'castle') { b.btype = 'rampart'; b.h = Math.max(b.h, (BTYPES.rampart.minH || 7) / M_PER_UNIT); b.mat = BTYPES.rampart.roof; }
    // Too thin to look solid: push the outline out until the wall has its least thickness.
    const min = b.btype === 'rampart' ? WALL_MIN.rampart : WALL_MIN.wall, now = Math.abs(a) / per;
    if (now < min) b.p = grow(b.p, (min - now) / 2);
  }
  // Building parts: a smaller building whose middle lies inside a bigger one is part of it (a cathedral's tower,
  // chapels, aisles). Parts take the main building's colour, type and name, so the whole reads as one building.
  const bbox = B.map(b => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, a = 0; b.p.forEach((q, k) => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); const r = b.p[(k + 1) % b.p.length]; a += q[0] * r[1] - r[0] * q[1]; }); b.area = Math.abs(a) / 2; return [x0, x1, y0, y1]; });
  const order = B.map((_, i) => i).sort((i, j) => B[j].area - B[i].area);
  for (let oi = 0; oi < order.length; oi++) {
    const b = B[order[oi]], cx = b.p.reduce((s, q) => s + q[0], 0) / b.p.length, cy = b.p.reduce((s, q) => s + q[1], 0) / b.p.length;
    for (let oj = 0; oj < oi; oj++) {
      const j = order[oj], L = B[j], bb = bbox[j]; if (b.thin || L.thin || L.parent != null || L.area < b.area || cx < bb[0] - 1 || cx > bb[1] + 1 || cy < bb[2] - 1 || cy > bb[3] + 1) continue;
      // Inside: the middle is in the bigger one, or most of the corners are.
      const inside = b.p.filter(q => pointIn(L.p, q[0], q[1])).length;
      if (!pointIn(L.p, cx, cy) && inside < b.p.length * .6) continue;
      b.parent = j; b.mat = L.mat; b.v = L.v; if (L.btype) b.btype = L.btype; else if (b.btype) L.btype = b.btype; if (!L.name && b.name) L.name = b.name; break;
    }
  }
  // A part no taller than its main building adds only clutter (boxes inside boxes): drop it. Taller parts stay as towers.
  const keep = B.map(b => b.parent == null || b.h > B[b.parent].h + 1.5), newId = new Int32Array(B.length).fill(-1);
  let nk = 0; keep.forEach((k, i) => { if (k) newId[i] = nk++; });
  const kept = B.filter((_, i) => keep[i]); for (const b of kept) if (b.parent != null) b.parent = newId[b.parent];
  B.length = 0; B.push(...kept);
  B.forEach((b, i) => {
    let base = 1e9, sx = 0, sy = 0; for (const q of b.p) { base = Math.min(base, hAt(q[0], q[1])); sx += q[0]; sy += q[1]; }
    b.id = i; b.base = base - .4; b.top = base + .3 + b.h; b.cx = sx / b.p.length; b.cy = sy / b.p.length;
    const put = (ci: number) => { if (isWet(terr[ci]) || bldId[ci] === i) return; terr[ci] = T_BUILD; bldTop[ci] = b.top; bldId[ci] = i; b.cells.push(ci); };
    b.cells = []; rasterPoly(b.p, put);
    // A wall also takes each cell its sides cross, but not roads: a wall across a road is a gateway.
    if (b.thin) for (let k = 0; k < b.p.length; k++) {
      const a = b.p[k], c = b.p[(k + 1) % b.p.length], n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / .3);
      for (let s = 0; s <= n; s++) { const x = a[0] + (c[0] - a[0]) * s / n, y = a[1] + (c[1] - a[1]) * s / n, cx = Math.floor(x / C), cy = Math.floor(y / C); if (cx >= 0 && cy >= 0 && cx < GW && cy < GH && terr[cy * GW + cx] !== T_ROAD) put(cy * GW + cx); }
    }
    // Strength: bigger and taller buildings take more shells to bring down. Castles are much tougher.
    let ar = 0; for (let k = 0; k < b.p.length; k++) { const a = b.p[k], c = b.p[(k + 1) % b.p.length]; ar += a[0] * c[1] - c[0] * a[1]; }
    b.hp0 = clamp(Math.abs(ar) / 2 * b.h * .05, 6, 160) * (b.btype === 'castle' ? 4 : 1); b.hp = b.hp0; b.down = null;
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
    // Both ends stand clear of the highest water under the bridge, so the straight deck never dips into the river.
    // The ramps below then rise to meet it.
    let wTop = -Infinity; for (const c of cells) if (isWet(terr[c])) wTop = Math.max(wTop, wl[c]);
    const clear = wTop + 1.6, hA = Math.max(hAt(cx + ax * (sA - C), cy + ay * (sA - C)), clear), hB = Math.max(hAt(cx + ax * (sB + C), cy + ay * (sB + C)), clear);
    const deckAt = (c: number) => { const s = ((c % GW) * C + 1 - cx) * ax + (Math.floor(c / GW) * C + 1 - cy) * ay, f = clamp((s - sA) / Math.max(1, sB - sA), 0, 1); return Math.max(hA + (hB - hA) * f, isWet(terr[c]) ? wl[c] + 1.6 : -9) + .15; };
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

  // Mapped single trees and tree rows, then trees scattered in woods. Parks get random trees only when
  // the map data has few real ones.
  const trees: number[][] = [], open = (ci: number) => ci >= 0 && !isWet(terr[ci]) && terr[ci] !== T_BUILD && terr[ci] !== T_ROAD;
  const cellAt = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H ? -1 : Math.floor(y / C) * GW + Math.floor(x / C);
  for (const t of raw.trees || []) if (open(cellAt(t[0], t[1]))) trees.push(t);
  const parkP = (raw.trees || []).length > 40 ? 0 : .05;
  for (let ci = 0; ci < GW * GH; ci++) {
    const t = terr[ci]; if (t !== T_WOOD && t !== T_PARK) continue;
    const x = (ci % GW) * C + 1, y = Math.floor(ci / GW) * C + 1;
    if (hashf(x, y, 3) < (t === T_WOOD ? .42 : parkP)) trees.push([x + (hashf(x, y, 4) - .5) * 1.6, y + (hashf(x, y, 5) - .5) * 1.6, 3 + hashf(x, y, 6) * 4]);
  }
  // Hedges and walls only stand on open ground: not in water, on roads or inside buildings.
  const feat = raw.feat ? raw.feat.slice() : new Uint8Array(GW * GH);
  for (let ci = 0; ci < feat.length; ci++) if (feat[ci] && !open(ci)) feat[ci] = 0;
  return { seed: raw.seed, name: raw.name, source: raw.source, credit: raw.credit, hist: raw.hist, ground, terr, terr0: terr.slice(), TH, hAt, deck, deck0: deck.slice(), bridges, B, trees, bldTop, bldId, count: B.length, play, bldId0: bldId.slice(), bldTop0: bldTop.slice(), wl, feat, fences: raw.fences || [] };
}
