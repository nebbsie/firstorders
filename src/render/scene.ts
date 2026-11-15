import * as THREE from 'three';
import { W, H, C, GW, GH, IW, IH, IC, TRGB, clamp } from '../config';
import { S, M, OWN } from '../state';
import { unitH } from '../world';
import { camera, cam, FOV, view } from './camera';

// Colours are given in sRGB and used as they are, like the 2D interface.
THREE.ColorManagement.enabled = false;
export let renderer: THREE.WebGLRenderer;
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#121410'); scene.fog = new THREE.Fog('#121410', 560, 1200);

// What the renderer draws this frame: the live battle or a replay frame, with or without fog.
export interface View {
  units: any[]; tracers: any[]; fx: any[]; craters: any[]; shells: any[]; planes: any[]; bombs: any[];
  fogOn: boolean; isVis: (u: any) => boolean; ghosts: any[]; seen: Uint8Array; vis: Uint8Array; replayT?: number;
}

const ilayer = document.createElement('canvas'); ilayer.width = IW; ilayer.height = IH; const ictx = ilayer.getContext('2d');
const terrTex = new THREE.CanvasTexture(ilayer); terrTex.magFilter = THREE.LinearFilter; terrTex.minFilter = THREE.LinearFilter;
const flayer = document.createElement('canvas'); flayer.width = IW; flayer.height = IH; const fctx = flayer.getContext('2d');
const fogTex = new THREE.CanvasTexture(flayer); fogTex.magFilter = THREE.LinearFilter; fogTex.minFilter = THREE.LinearFilter;

export function initRenderer(canvas: HTMLCanvasElement) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Intensities times pi give the classic (non-physical) light levels the colours were picked for.
  scene.add(new THREE.HemisphereLight('#dfe2d2', '#3a3528', 0.62 * Math.PI));
  const sun = new THREE.DirectionalLight('#fff0d8', 0.78 * Math.PI); sun.position.set(-150, 240, -110); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 200, bottom: -200, near: 10, far: 700 }); sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);
  createDynamic();
}

// Ground owned by each side. Under fog, other sides' ground shows only where you have looked.
export function paintTerritory(seen: Uint8Array | null) {
  const img = ictx.createImageData(IW, IH), px = img.data;
  for (let i = 0; i < IW * IH; i++) {
    const o = OWN[i]; if (o < 0 || (seen && o !== 0 && !seen[i])) continue;
    const c = TRGB[o]; px[i * 4] = c[0] * 255; px[i * 4 + 1] = c[1] * 255; px[i * 4 + 2] = c[2] * 255; px[i * 4 + 3] = o === 0 ? 92 : 80;
  }
  ictx.putImageData(img, 0, 0); terrTex.needsUpdate = true;
}
// Fog: clear where you see now, light shade where you have seen, dark where you never looked.
export function paintFog(vis: Uint8Array, seen: Uint8Array, on: boolean) {
  const img = fctx.createImageData(IW, IH), px = img.data;
  if (on) for (let i = 0; i < IW * IH; i++) { px[i * 4] = 11; px[i * 4 + 1] = 14; px[i * 4 + 2] = 18; px[i * 4 + 3] = vis[i] ? 0 : seen[i] ? 95 : 150; }
  fctx.putImageData(img, 0, 0); fogTex.needsUpdate = true;
}

let mapGroup: THREE.Group = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
export function buildMap3D() {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map !== terrTex && o.material.map !== fogTex) o.material.map.dispose(); o.material.dispose(); } }); }
  mapGroup = new THREE.Group(); const VW = GW + 1, TH = M.TH;
  const pos = new Float32Array(GW * GH * 18), uv = new Float32Array(GW * GH * 12); let k = 0, u = 0;
  const vtx = (i: number, j: number) => { pos[k++] = i * C - W / 2; pos[k++] = TH[j * VW + i]; pos[k++] = j * C - H / 2; uv[u++] = i * C / W; uv[u++] = 1 - j * C / H; };
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { vtx(i, j); vtx(i, j + 1); vtx(i + 1, j); vtx(i + 1, j); vtx(i, j + 1); vtx(i + 1, j + 1); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.computeVertexNormals();
  const gt = new THREE.CanvasTexture(M.ground); gt.anisotropy = renderer.capabilities.getMaxAnisotropy(); gt.colorSpace = THREE.NoColorSpace;
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ map: gt })); terrain.receiveShadow = true; mapGroup.add(terrain);
  const over = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: terrTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); over.renderOrder = 1; mapGroup.add(over);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#3f6874', transparent: true, opacity: .8 })); water.renderOrder = 2; mapGroup.add(water);

  // Buildings: one merged mesh of flat-shaded walls and roofs. Roofs are triangulated, so L-shapes work.
  const Pa: number[] = [], Na: number[] = [], Ca: number[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), out = new THREE.Vector3();
  const tri = (a: number[], b: number[], c: number[], col: number[], o: THREE.Vector3) => {
    va.fromArray(a); vb.fromArray(b); vc.fromArray(c); nn.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
    if (nn.dot(o) < 0) { const t = b; b = c; c = t; nn.negate(); } nn.normalize();
    for (const q of [a, b, c]) { Pa.push(q[0], q[1], q[2]); Na.push(nn.x, nn.y, nn.z); Ca.push(col[0], col[1], col[2]); }
  };
  for (const b of M.B) {
    const j = (b.v * 37 % 1 - .5) * 14, roof = b.mat.map(v => (v + j) / 255), wall = roof.map(v => v * .8), p = b.p;
    let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], c = p[(i + 1) % p.length]; area += a[0] * c[1] - c[0] * a[1]; }
    const T = p.map(q => [q[0] - W / 2, b.top, q[1] - H / 2]), Bt = p.map(q => [q[0] - W / 2, b.base, q[1] - H / 2]);
    const faces = THREE.ShapeUtils.triangulateShape(p.map(q => new THREE.Vector2(q[0], q[1])), []);
    for (const f of faces) tri(T[f[0]], T[f[1]], T[f[2]], roof, _up);
    for (let i = 0; i < p.length; i++) {
      const n = (i + 1) % p.length, ex = p[n][0] - p[i][0], ey = p[n][1] - p[i][1];
      if (area > 0) out.set(ey, 0, -ex); else out.set(-ey, 0, ex);
      tri(Bt[i], Bt[n], T[n], wall, out); tri(Bt[i], T[n], T[i], wall, out);
    }
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(Pa, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(Na, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(Ca, 3));
  const bm = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ vertexColors: true })); bm.castShadow = true; bm.receiveShadow = true; mapGroup.add(bm);

  for (const br of M.bridges) {
    const grp = new THREE.Group(), deckM = new THREE.MeshLambertMaterial({ color: '#7a7266' }), pierM = new THREE.MeshLambertMaterial({ color: '#5f594f' });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(C, .8, C), deckM, br.cells.length);
    br.cells.forEach((c, i) => { _p.set((c % GW) * C + 1 - W / 2, br.deck - .4, Math.floor(c / GW) * C + 1 - H / 2); _m.compose(_p, _q.identity(), _s.set(1, 1, 1)); im.setMatrixAt(i, _m); });
    im.castShadow = true; im.receiveShadow = true; grp.add(im);
    const piers = br.cells.filter((_, i) => i % 9 === 4), pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1, 1.4), pierM, Math.max(1, piers.length));
    piers.forEach((c, i) => { const h = br.deck + 2; _p.set((c % GW) * C + 1 - W / 2, h / 2 - 2.2, Math.floor(c / GW) * C + 1 - H / 2); _m.compose(_p, _q.identity(), _s.set(1, h, 1)); pm.setMatrixAt(i, _m); });
    pm.count = piers.length; grp.add(pm);
    br.group = grp; mapGroup.add(grp);
  }
  if (M.trees.length) {
    const tm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshLambertMaterial({ color: '#3d5832' }), M.trees.length);
    M.trees.forEach((t, i) => { _q.setFromAxisAngle(_up, t[0]); _p.set(t[0] - W / 2, M.hAt(t[0], t[1]) + t[2] / 2, t[1] - H / 2); _s.set(1.3 + t[2] * .18, t[2], 1.3 + t[2] * .18); _m.compose(_p, _q, _s); tm.setMatrixAt(i, _m); });
    tm.castShadow = true; tm.receiveShadow = true; mapGroup.add(tm);
  }
  const fogMesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); fogMesh.renderOrder = 3; mapGroup.add(fogMesh);
  scene.add(mapGroup); structKey = '';
}

// Dynamic objects, created once and refilled every frame.
let mTrench, mTrenchLip, mSand, mWire, mWall, mTrap, mEmp, mPlane, mCrater, mBoom, ptUnits, ptBodies, ptGhosts, ptHeads, lineG;
const LMAX = 8000;
function inst(geom: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow?: boolean) {
  const m = new THREE.InstancedMesh(geom, mat, cap); m.frustumCulled = false; const c = new THREE.Color(1, 1, 1);
  for (let i = 0; i < cap; i++) m.setColorAt(i, c); m.count = 0; if (shadow) m.castShadow = true; scene.add(m); return m;
}
const lam = (c: string) => new THREE.MeshLambertMaterial({ color: c });
function pointsObj(cap: number, size: number, opacity: number) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3)); g.setDrawRange(0, 0);
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: opacity < 1, opacity })); p.frustumCulled = false; scene.add(p); return p;
}
function createDynamic() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  mTrench = inst(box, lam('#3a2c1e'), 4000); mTrenchLip = inst(box, lam('#6b583e'), 4000); mSand = inst(box, lam('#b39d74'), 4000, true);
  mWire = inst(new THREE.BoxGeometry(2.6, .5, .12), lam('#a39f95'), 8000); mWall = inst(box, lam('#8f8a7e'), 4000, true);
  mTrap = inst(new THREE.BoxGeometry(2.2, .3, .3), lam('#4c4b47'), 9000, true); mEmp = inst(box, lam('#ffffff'), 1500, true);
  mPlane = inst(box, new THREE.MeshLambertMaterial({ color: '#c87a2a' }), 40, true);
  mCrater = inst(new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#211b14', transparent: true, opacity: .75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 700);
  mBoom = inst(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), 300);
  ptUnits = pointsObj(5000, 3, 1); ptBodies = pointsObj(5000, 2, .7); ptGhosts = pointsObj(3000, 3, .45); ptHeads = pointsObj(800, 3, 1);
  lineG = new THREE.BufferGeometry(); lineG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LMAX * 6), 3)); lineG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LMAX * 6), 3)); lineG.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(lineG, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85 })); lines.frustumCulled = false; scene.add(lines);
}
function setI(mesh: any, i: number, x: number, y: number, h: number, sx: number, sy: number, sz: number, yaw: number, col?: number[]) {
  _q.setFromAxisAngle(_up, yaw || 0); _p.set(x - W / 2, h, y - H / 2); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
  if (col) { _c.setRGB(col[0], col[1], col[2]); mesh.setColorAt(i, _c); }
}
function done(mesh: any, n: number) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }

let structKey = '';
const cellSeen = (seen: Uint8Array, x: number, y: number) => seen[Math.floor(clamp(y, 0, H - .01) / IC) * IW + Math.floor(clamp(x, 0, W - .01) / IC)];
export function visibleStruct(s: any, V?: View) {
  if (S.phase === 'replay') return s.placedAt != null && s.placedAt <= S.rt;
  if (S.phase === 'plan' && s.team !== 0 && s.round >= S.round) return false;
  if (S.phase !== 'plan' && s.placedAt == null) return false;
  if (V && V.fogOn && s.team !== 0) return s.cells.some((c: number) => cellSeen(V.seen, (c % GW) * C + 1, Math.floor(c / GW) * C + 1));
  return true;
}
function updateStructs(V: View) {
  const vis = S.structs.filter((s: any) => visibleStruct(s, V)); const key = vis.map((s: any) => s.id).join(',') + S.phase; if (key === structKey) return; structKey = key;
  let nt = 0, nl = 0, ns = 0, nw = 0, nwl = 0, nk = 0;
  for (const s of vis) {
    const yaw = Math.atan2(-(s.b.y - s.a.y), s.b.x - s.a.x);
    for (const ci of s.cells) {
      const x = (ci % GW) * C + 1, y = Math.floor(ci / GW) * C + 1, h = M.hAt(x, y);
      if (s.type === 'trench') { setI(mTrench, nt++, x, y, h + .04, 2, .1, 2, 0); setI(mTrenchLip, nl++, x, y, h + .18, 2.1, .35, .5, yaw); }
      else if (s.type === 'sandbag') setI(mSand, ns++, x, y, h + .4, 2.05, .8, 1.1, yaw);
      else if (s.type === 'wire') { setI(mWire, nw++, x, y, h + .3, 1, 1, 1, yaw + .78); setI(mWire, nw++, x, y, h + .3, 1, 1, 1, yaw - .78); }
      else if (s.type === 'tanktrap') { setI(mTrap, nk++, x, y, h + .35, 1, 1, 1, yaw + .78); setI(mTrap, nk++, x, y, h + .35, 1, 1, 1, yaw - .78); setI(mTrap, nk++, x, y, h + .75, .6, 1, 1, yaw); }
      else setI(mWall, nwl++, x, y, h + 1.2, 2.02, 2.4, 2.02, 0);
    }
  }
  done(mTrap, nk); done(mTrench, nt); done(mTrenchLip, nl); done(mSand, ns); done(mWire, nw); done(mWall, nwl);
}

export function update3D(V: View) {
  const plan = S.phase === 'plan';
  const up = ptUnits.geometry.attributes.position.array, uc = ptUnits.geometry.attributes.color.array;
  const bp = ptBodies.geometry.attributes.position.array, bc = ptBodies.geometry.attributes.color.array;
  const gp = ptGhosts.geometry.attributes.position.array, gc = ptGhosts.geometry.attributes.color.array;
  let n = 0, nb = 0, ng = 0, ne = 0;
  const putU = (x: number, y: number, h: number, c: number[], dim: number) => { if (n >= 5000) return; up[n * 3] = x - W / 2; up[n * 3 + 1] = h; up[n * 3 + 2] = y - H / 2; uc[n * 3] = c[0] * dim; uc[n * 3 + 1] = c[1] * dim; uc[n * 3 + 2] = c[2] * dim; n++; };
  const emp = (kind: string, x: number, y: number, c: number[], hd: number) => {
    const h = unitH(x, y), dc = c.map(v => v * .55), yaw = hd || 0, fx = Math.cos(yaw), fy = -Math.sin(yaw);
    if (kind === 'mg') setI(mEmp, ne++, x, y, h + .45, 2.6, .9, 2.6, 0, dc);
    else if (kind === 'mortar') setI(mEmp, ne++, x, y, h + .6, 1.4, 1.2, 1.4, .6, dc);
    else if (kind === 'tank') { setI(mEmp, ne++, x, y, h + .7, 3.4, 1.3, 2.1, yaw, dc); setI(mEmp, ne++, x, y, h + 1.65, 1.5, .7, 1.4, yaw, c.map(v => v * .7)); setI(mEmp, ne++, x + fx * 1.9, y + fy * 1.9, h + 1.65, 2.2, .25, .25, yaw, dc); }
    else if (kind === 'at') { setI(mEmp, ne++, x, y, h + .4, 1.6, .7, 1.6, yaw, dc); setI(mEmp, ne++, x + fx * 1.4, y + fy * 1.4, h + .8, 2, .2, .2, yaw, dc); }
    else if (kind === 'op') { setI(mEmp, ne++, x, y, h + 2, .35, 4, .35, 0, dc); setI(mEmp, ne++, x, y, h + 4.2, 1.4, .6, 1.4, 0, c); }
  };
  for (const u of V.units) {
    if (ne > 1400) break; const c = TRGB[u.team];
    if (u.alive) {
      if (u.team !== 0 && V.fogOn && !V.isVis(u)) continue;
      putU(u.x, u.y, unitH(u.x, u.y) + .9 + (u.drop > 0 ? u.drop * 14 : 0), c, 1);
      if (u.kind !== 'rifle' && u.kind !== 'sniper') emp(u.kind, u.x, u.y, c, u.hd);
    } else if (nb < 5000) {
      if (u.team !== 0 && V.fogOn && !cellSeen(V.seen, u.x, u.y)) continue;
      bp[nb * 3] = u.x - W / 2; bp[nb * 3 + 1] = unitH(u.x, u.y) + .2; bp[nb * 3 + 2] = u.y - H / 2; bc[nb * 3] = c[0] * .45; bc[nb * 3 + 1] = c[1] * .45; bc[nb * 3 + 2] = c[2] * .45; nb++;
    }
  }
  if (plan) for (const s of S.squads) {
    if (s.members || s.team !== 0) continue; const c = TRGB[0];
    for (const p of s.pos) putU(p[0], p[1], unitH(p[0], p[1]) + .9, c, .75);
    if (s.kind !== 'rifles' && s.kind !== 'sniper' && s.kind !== 'garrison') emp(s.kind, s.pos[0][0], s.pos[0][1], c, Math.atan2(-(H / 2 - s.pos[0][1]), W / 2 - s.pos[0][0]));
  }
  // Last known enemy positions, shown faded.
  for (const g of V.ghosts) { if (ng >= 3000) break; const c = TRGB[g.team]; gp[ng * 3] = g.x - W / 2; gp[ng * 3 + 1] = unitH(g.x, g.y) + .9; gp[ng * 3 + 2] = g.y - H / 2; gc[ng * 3] = c[0]; gc[ng * 3 + 1] = c[1]; gc[ng * 3 + 2] = c[2]; ng++; }
  for (const [p, c] of [[ptUnits, n], [ptBodies, nb], [ptGhosts, ng]] as [any, number][]) { p.geometry.setDrawRange(0, c); p.geometry.attributes.position.needsUpdate = true; p.geometry.attributes.color.needsUpdate = true; }
  done(mEmp, ne);
  const ppu = view.ch / 2 / (cam.dist * Math.tan(FOV / 2 * Math.PI / 180));
  ptUnits.material.size = clamp(ppu * 1.1, 2.5, 7); ptBodies.material.size = clamp(ppu * .8, 1.5, 5); ptGhosts.material.size = clamp(ppu * 1.1, 2.5, 7); ptHeads.material.size = clamp(ppu * 1.2, 2.5, 6);

  const lp = lineG.attributes.position.array, lc = lineG.attributes.color.array; let L = 0;
  const seg = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, c: number[], c2?: number[]) => {
    if (L >= LMAX) return; const o = L * 6; lp[o] = x0 - W / 2; lp[o + 1] = h0; lp[o + 2] = y0 - H / 2; lp[o + 3] = x1 - W / 2; lp[o + 4] = h1; lp[o + 5] = y1 - H / 2;
    lc[o] = c[0]; lc[o + 1] = c[1]; lc[o + 2] = c[2]; const d = c2 || c; lc[o + 3] = d[0]; lc[o + 4] = d[1]; lc[o + 5] = d[2]; L++;
  };
  for (const t of V.tracers) {
    if (V.fogOn && t.team !== 0 && !cellSeen(V.vis, t.x0, t.y0) && !cellSeen(V.vis, t.x1, t.y1)) continue;
    const c = TRGB[t.team]; seg(t.x0, t.y0, unitH(t.x0, t.y0) + 1.2, t.x1, t.y1, unitH(t.x1, t.y1) + 1, [c[0] * .6 + .4, c[1] * .6 + .4, c[2] * .6 + .4]);
  }
  const hp = ptHeads.geometry.attributes.position.array, hc = ptHeads.geometry.attributes.color.array; let nh = 0;
  for (const s of V.shells) {
    if (s.t < 0) continue; const k = s.t / s.dur, d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0), arc = d * .35 + 12;
    const at = (q: number) => { const x = s.x0 + (s.x1 - s.x0) * q, y = s.y0 + (s.y1 - s.y0) * q; return [x, y, unitH(x, y) * (1 - q) + unitH(s.x1, s.y1) * q + Math.sin(Math.PI * q) * arc]; };
    let prev = at(Math.max(0, k - .3));
    for (let i = 1; i <= 6; i++) { const q = Math.max(0, k - .3) + (k - Math.max(0, k - .3)) * i / 6, p = at(q), f = i / 6; seg(prev[0], prev[1], prev[2], p[0], p[1], p[2], [.15 + .5 * f, .15 + .5 * f, .15 + .48 * f]); prev = p; }
    if (nh < 800) { hp[nh * 3] = prev[0] - W / 2; hp[nh * 3 + 1] = prev[2]; hp[nh * 3 + 2] = prev[1] - H / 2; hc[nh * 3] = 1; hc[nh * 3 + 1] = 1; hc[nh * 3 + 2] = .9; nh++; }
  }
  for (const b of V.bombs) if (nh < 800) { hp[nh * 3] = b.x - W / 2; hp[nh * 3 + 1] = unitH(b.x, b.y) + b.t * 60; hp[nh * 3 + 2] = b.y - H / 2; hc[nh * 3] = 1; hc[nh * 3 + 1] = .95; hc[nh * 3 + 2] = .8; nh++; }
  ptHeads.geometry.setDrawRange(0, nh); ptHeads.geometry.attributes.position.needsUpdate = true; ptHeads.geometry.attributes.color.needsUpdate = true;
  let np = 0;
  for (const p of V.planes) {
    const x = p.ax + p.ux * p.s, y = p.ay + p.uy * p.s, h = p.kind === 'spy' ? 60 : 45, yaw = Math.atan2(-p.uy, p.ux);
    const col = p.kind === 'spy' ? [.75, .78, .8] : undefined;
    setI(mPlane, np++, x, y, h, 4.2, .7, 1.2, yaw, col || [.78, .48, .16]); setI(mPlane, np++, x, y, h + .1, 1, .25, 6, yaw, col || [.78, .48, .16]);
    seg(x - p.ux * 60, y - p.uy * 60, h, x - p.ux * 3, y - p.uy * 3, h, [.07, .07, .06], [.75, .75, .72]);
  }
  done(mPlane, np);
  lineG.setDrawRange(0, L * 2); lineG.attributes.position.needsUpdate = true; lineG.attributes.color.needsUpdate = true;
  let nf = 0; for (const f of V.fx) { if (nf >= 300) break; const k = 1 - f.life / f.max, s = f.r * (.35 + k * .8), fade = 1 - k; setI(mBoom, nf++, f.x, f.y, unitH(f.x, f.y) + s * .5, s, s * .8, s, 0, [fade, fade * (.75 - k * .4), fade * (.45 - k * .4)]); } done(mBoom, nf);
  let nc = 0; for (const c of V.craters) { if (nc >= 700) break; setI(mCrater, nc++, c.x, c.y, M.hAt(c.x, c.y) + .06, c.r, 1, c.r, 0); } done(mCrater, nc);
  for (const br of M.bridges) if (br.group) br.group.visible = !(br.blown != null && (S.phase !== 'replay' || br.blown <= S.rt));
  updateStructs(V);
}
export function render() { renderer.render(scene, camera); }
