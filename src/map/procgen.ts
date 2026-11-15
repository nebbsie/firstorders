import { W, H, C, GW, GH, GS, HS, M_PER_UNIT, T_GROUND, T_ROAD, T_PARK, T_WATER, T_BRIDGE, T_WOOD, clamp, mod, mulberry32, makeNoise } from '../config';
import type { RawMap, Building } from './types';

function townName(seed: number) {
  const a = ['ASH', 'MARL', 'HOLT', 'BRAN', 'KEL', 'DUN', 'WEX', 'ORM', 'TAV', 'LYN'], b = ['FORD', 'BRIDGE', 'MOUTH', 'WICK', 'STOW', 'HAVEN', 'MERE', 'BURY'];
  return a[seed % a.length] + b[(seed >> 4) % b.length];
}

// A made-up river town: dense centre, suburbs, farmland and woods, a river with bridges, hills.
export function sampleTown(seed: number): RawMap {
  // f shrinks streets, blocks, buildings, hills and the river for bigger battles, so the town keeps real proportions.
  const f = 2.5 / M_PER_UNIT;
  const rng = mulberry32(seed), n = makeNoise(mulberry32(seed ^ 0x51ed27));
  const hg = (x: number, y: number) => (n(x / (85 * f), y / (85 * f)) * 0.72 + n(x / (24 * f) + 31.7, y / (24 * f) + 11.3) * 0.28) * 46 * f;
  const rA = (10 + rng() * 16) * f, rF = (0.010 + rng() * 0.010) / f, rP = rng() * 6.28, rY = H * (0.45 + rng() * 0.1), rW = (8 + rng() * 3.5) * f;
  const NX = W * GS + 1, RY = new Float32Array(NX), RW = new Float32Array(NX);
  for (let i = 0; i < NX; i++) { const x = i / GS; RY[i] = rY + Math.sin(x * rF + rP) * rA + (n(x / 45, 90.5) - .5) * 22 * f; RW[i] = rW + n(x / 60, 140.5) * 7 * f; }
  const ri = (x: number) => clamp(Math.round(x * GS), 0, NX - 1);
  const wdep = (x: number, y: number) => { const i = ri(x); return RW[i] - Math.abs(y - RY[i]); };
  const nb = 3 + (rng() < .5 ? 1 : 0), BX: number[] = []; for (let i = 0; i < nb; i++) BX.push(W * (0.12 + 0.76 * i / (nb - 1)) + (rng() - .5) * 30);
  const bridgeAt = (x: number, y: number) => { for (const bx of BX) { if (Math.abs(x - bx) < Math.max(C * .8, 2.3 * f)) { const i = ri(x); if (Math.abs(y - RY[i]) < RW[i] + 14 * f) return true; } } return false; };
  const nd = 6 + Math.floor(rng() * 3), D: any[] = [];
  for (let i = 0; i < nd; i++) D.push({ cx: 30 + rng() * (W - 60), cy: 25 + rng() * (H - 60), a: (rng() - .5) * 1.2, bw: (24 + rng() * 14) * f, bh: (17 + rng() * 10) * f, ou: rng() * 50, ov: rng() * 50 });
  D[0].cx = W / 2 + (rng() - .5) * 90; D[0].cy = rY + (rng() < .5 ? -1 : 1) * (40 + rng() * 18);
  for (const d of D) { d.c = Math.cos(d.a); d.s = Math.sin(d.a); }
  let nI = 0, nE = 0;
  const near = (x: number, y: number) => { let b = 0, bd = 1e9, sd = 1e9; for (let i = 0; i < nd; i++) { const dx = x - D[i].cx, dy = y - D[i].cy, dd = dx * dx + dy * dy; if (dd < bd) { sd = bd; bd = dd; b = i; } else if (dd < sd) sd = dd; } nI = b; nE = Math.sqrt(sd) - Math.sqrt(bd); };
  const lu = (d: any, x: number, y: number) => { const dx = x - d.cx, dy = y - d.cy; return [dx * d.c + dy * d.s + d.ou, -dx * d.s + dy * d.c + d.ov]; };
  const tw = (d: any, u: number, v: number) => { u -= d.ou; v -= d.ov; return [d.cx + u * d.c - v * d.s, d.cy + u * d.s + v * d.c]; };
  const hash = (a: number, b: number, c: number) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + (seed % 1000) * 0.613) * 43758.5453; return h - Math.floor(h); };
  const rw = (i: number) => Math.max(C * .55, (mod(i, 3) === 0 ? 2.4 : 1.4) * f);
  let park = false;
  const roadKind = (x: number, y: number) => { near(x, y); const d = D[nI]; const [u, v] = lu(d, x, y); park = hash(nI, Math.floor(u / d.bw), Math.floor(v / d.bh)) < 0.09; if (nE < Math.max(C * .6, 2.2 * f)) return 2; const iu = Math.round(u / d.bw), iv = Math.round(v / d.bh); if (Math.abs(u - iu * d.bw) < rw(iu)) return mod(iu, 3) === 0 ? 2 : 1; if (Math.abs(v - iv * d.bh) < rw(iv)) return mod(iv, 3) === 0 ? 2 : 1; return 0; };
  const dens = (x: number, y: number) => clamp(1.3 - Math.hypot(x - D[0].cx, y - D[0].cy) / 175, 0, 1);
  const woodAt = (x: number, y: number) => { const de = dens(x, y); return de < .7 && n(x / (36 * f) + 70.3, y / (36 * f) + 70.7) > .6 - (1 - de) * .12; };
  const classify = (x: number, y: number) => { const wd = wdep(x, y); if (bridgeAt(x, y)) return wd > 0 ? T_BRIDGE : T_ROAD; if (wd > 0) return T_WATER; const rk = roadKind(x, y), de = dens(x, y); if (rk === 2 || (rk === 1 && de > .3)) return T_ROAD; if (wd > -4 * f) return T_PARK; if (woodAt(x, y)) return T_WOOD; if (park && de > .3) return T_PARK; return T_GROUND; };

  const gw = W * GS, gh = H * GS, cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
  const g = cv.getContext('2d'), img = g.createImageData(gw, gh), px = img.data, HP = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) HP[y * gw + x] = hg((x + .5) / GS, (y + .5) / GS);
  const WATER = [[64, 104, 122], [54, 92, 112], [46, 81, 101], [39, 71, 91], [32, 61, 80]];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x, wx = (x + .5) / GS, wy = (y + .5) / GS; let r: number, gg: number, b: number;
    const t = classify(wx, wy);
    if (t === T_WATER) { const wd = wdep(wx, wy); const c = WATER[Math.min(4, Math.floor(wd / 2.4))]; r = c[0]; gg = c[1]; b = c[2]; }
    else if (t === T_BRIDGE) { r = 104; gg = 98; b = 86; }
    else if (t === T_ROAD) { r = 58; gg = 56; b = 50; }
    else if (t === T_PARK) { const tr = n(wx / 2.1, wy / 2.1 + 500) > .6; r = tr ? 60 : 84; gg = tr ? 84 : 106; b = tr ? 48 : 62; }
    else if (t === T_WOOD) { const tr = n(wx / 1.6, wy / 1.6 + 300) > .5; r = tr ? 44 : 56; gg = tr ? 64 : 76; b = tr ? 36 : 44; }
    else {
      const h = HP[i], k = h / 46; r = 104 + k * 26; gg = 106 + k * 22; b = 84 + k * 10;
      if (dens(wx, wy) < .35 && Math.floor((wx * .8 + wy * .6) / 4) % 2) { r += 9; gg += 6; b -= 4; }
      if (x > 0 && y > 0) { const band = Math.floor(h / 5.5); if (band !== Math.floor(HP[i - 1] / 5.5) || band !== Math.floor(HP[i - gw] / 5.5)) { r -= 12; gg -= 12; b -= 10; } }
    }
    px[i * 4] = r; px[i * 4 + 1] = gg; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const terr = new Uint8Array(GW * GH);
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) terr[cy * GW + cx] = classify(cx * C + 1, cy * C + 1);
  const VW = GW + 1, VH = GH + 1, baseH = new Float32Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) baseH[j * VW + i] = 3 + hg(i * C, j * C) * HS;

  const B: Building[] = [];
  for (let di = 0; di < nd; di++) {
    const d = D[di]; let mnU = 1e9, mxU = -1e9, mnV = 1e9, mxV = -1e9;
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { const [u, v] = lu(d, x, y); mnU = Math.min(mnU, u); mxU = Math.max(mxU, u); mnV = Math.min(mnV, v); mxV = Math.max(mxV, v); }
    for (let iu = Math.floor(mnU / d.bw); iu <= Math.ceil(mxU / d.bw); iu++) for (let iv = Math.floor(mnV / d.bh); iv <= Math.ceil(mxV / d.bh); iv++) {
      if (hash(di, iu, iv) < 0.09) continue;
      { const bc = tw(d, (iu + .5) * d.bw, (iv + .5) * d.bh); if (hash(di + 7, iu, iv) > dens(bc[0], bc[1]) * 1.25 + .08) continue; }
      const u0 = iu * d.bw + rw(iu) + .7 * f, u1 = (iu + 1) * d.bw - rw(iu + 1) - .7 * f, v0 = iv * d.bh + rw(iv) + .7 * f, v1 = (iv + 1) * d.bh - rw(iv + 1) - .7 * f;
      if (u1 - u0 < 4 * f || v1 - v0 < 4 * f) continue;
      const rows = (v1 - v0) > 13 * f ? 2 : 1, rh = (v1 - v0 - (rows - 1) * .8 * f) / rows;
      for (let r = 0; r < rows; r++) {
        const vv0 = v0 + r * (rh + .8 * f), vv1 = vv0 + rh; let u = u0;
        while (u < u1 - 3 * f) {
          let lw = Math.min(u1 - u, (5 + rng() * 8) * f); if (u1 - (u + lw) < 3 * f) lw = u1 - u;
          if (rng() > 0.08) {
            const ins = (.3 + rng() * .6) * f, dep = rows === 1 ? rng() * Math.max(0, rh - 7 * f) * .6 : 0;
            const pts = [tw(d, u + ins, vv0 + ins + (r === 1 ? dep : 0)), tw(d, u + lw - ins, vv0 + ins + (r === 1 ? dep : 0)), tw(d, u + lw - ins, vv1 - ins - (r === 0 ? dep : 0)), tw(d, u + ins, vv1 - ins - (r === 0 ? dep : 0))];
            let ok = true; for (const [x, y] of pts) { if (x < 1 || y < 1 || x > W - 1 || y > H - 1) { ok = false; break; } near(x, y); if (nI !== di || nE < 3.2 * f || wdep(x, y) > -4.5 * f || bridgeAt(x, y) || woodAt(x, y)) { ok = false; break; } }
            if (ok) {
              const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2, dd = Math.hypot(cx - D[0].cx, cy - D[0].cy), fd = Math.max(0, 1 - dd / 115);
              const h = (3.5 + rng() * 5 + fd * fd * (6 + rng() * 40)) * f, v = rng();
              B.push({ p: pts, h: h * .75, v, mat: v < .5 ? [186, 177, 158] : v < .78 ? [156, 108, 88] : [118, 124, 128] });
            }
          }
          u += lw;
        }
      }
    }
  }
  return { seed, name: townName(seed) + ' · SAMPLE', source: 'sample', terr, baseH, B, ground: cv };
}
