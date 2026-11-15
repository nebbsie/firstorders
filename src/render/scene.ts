import { NET } from '../state';
import * as THREE from 'three';
import { W, H, C, GW, GH, IW, IH, IC, TRGB, clamp, inPlay } from '../config';
import { S, M, OWN } from '../state';
import { unitH } from '../world';
import { camera, cam, FOV, view } from './camera';
import { MODELS } from './models';
import { BTYPES } from '../map/btypes';
const MODEL_KINDS = new Set(['mg', 'mortar', 'tank', 'at', 'op']);

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
  Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, near: 10, far: 900 }); sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);
  createDynamic();
}

// Ground owned by each side. Under fog, other sides' ground shows only where you have looked.
export function paintTerritory(seen: Uint8Array | null) {
  const img = ictx.createImageData(IW, IH), px = img.data;
  for (let i = 0; i < IW * IH; i++) {
    const o = OWN[i]; if (o < 0 || (seen && o !== NET.me && !seen[i])) continue;
    const c = TRGB[o]; px[i * 4] = c[0] * 255; px[i * 4 + 1] = c[1] * 255; px[i * 4 + 2] = c[2] * 255; px[i * 4 + 3] = viewOpts.area ? 175 : o === NET.me ? 92 : 80;
  }
  ictx.putImageData(img, 0, 0); terrTex.needsUpdate = true;
}
// Fog: clear where you see now, light shade where you have seen, dark where you never looked.
export function paintFog(vis: Uint8Array, seen: Uint8Array, on: boolean) {
  const img = fctx.createImageData(IW, IH), px = img.data;
  if (on) for (let i = 0; i < IW * IH; i++) { if (!inPlay((i % IW) * IC + 2, Math.floor(i / IW) * IC + 2)) continue; px[i * 4] = 11; px[i * 4 + 1] = 14; px[i * 4 + 2] = 18; px[i * 4 + 3] = vis[i] ? 0 : seen[i] ? 95 : 150; }
  fctx.putImageData(img, 0, 0); fogTex.needsUpdate = true;
}

let mapGroup: THREE.Group = null;
// View options: AREA paints held ground strongly; XRAY makes buildings and trees see-through and draws troops on top.
export const viewOpts = { area: false, xray: false };
const xrayable: THREE.Mesh[] = [];
export function applyViews() {
  for (const o of xrayable) { const m = o.material as THREE.Material; m.transparent = viewOpts.xray; m.opacity = viewOpts.xray ? .22 : 1; m.depthWrite = !viewOpts.xray; m.needsUpdate = true; }
  for (const p of [ptUnits, ptGhosts]) if (p) { p.material.depthTest = !viewOpts.xray; p.renderOrder = viewOpts.xray ? 10 : 0; }
}
// Collapsed buildings: their walls drop to a low slab, and rubble lies on their ground.
let bldGeo: THREE.BufferGeometry = null, bldY: Float32Array = null, downKey = '', mRubble: any = null;
function updateDowns() {
  const downs = M.B.filter(b => b.down != null && (S.phase !== 'replay' || b.down <= S.rt)), key = downs.map(b => b.id).join(',');
  if (key === downKey || !bldGeo) return; downKey = key;
  const pos = bldGeo.attributes.position as THREE.BufferAttribute, isDown = new Set(downs.map(b => b.id));
  for (const b of M.B) { if (!b.vr) continue; const [s, n] = b.vr; for (let i = s; i < s + n; i++) pos.setY(i, isDown.has(b.id) ? Math.min(bldY[i], b.base + .5) : bldY[i]); }
  pos.needsUpdate = true; bldGeo.computeBoundingSphere();
  let k = 0;
  for (const b of downs) for (const c of b.cells) { if (k >= 20000) break; const x = (c % GW) * C + 1, y = Math.floor(c / GW) * C + 1, r = (c * 7919 % 97) / 97; setI(mRubble, k++, x + (r - .5), y + (r * 3 % 1 - .5), M.hAt(x, y) + .3, 1.6 + r, .5 + r * .9, 1.4 + r * .6, r * 6, [.42 + r * .1, .4 + r * .1, .37 + r * .1]); }
  done(mRubble, k);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
export function buildMap3D() {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map !== terrTex && o.material.map !== fogTex) o.material.map.dispose(); o.material.dispose(); } }); }
  mapGroup = new THREE.Group(); xrayable.length = 0; const VW = GW + 1, TH = M.TH;
  const pos = new Float32Array(GW * GH * 18), uv = new Float32Array(GW * GH * 12); let k = 0, u = 0;
  const vtx = (i: number, j: number) => { pos[k++] = i * C - W / 2; pos[k++] = TH[j * VW + i]; pos[k++] = j * C - H / 2; uv[u++] = i * C / W; uv[u++] = 1 - j * C / H; };
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { vtx(i, j); vtx(i, j + 1); vtx(i + 1, j); vtx(i + 1, j); vtx(i, j + 1); vtx(i + 1, j + 1); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.computeVertexNormals();
  const gt = new THREE.CanvasTexture(M.ground); gt.anisotropy = renderer.capabilities.getMaxAnisotropy(); gt.colorSpace = THREE.NoColorSpace;
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ map: gt })); terrain.receiveShadow = true; mapGroup.add(terrain);
  const over = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: terrTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); over.renderOrder = 1; mapGroup.add(over);
  // Square, solid map edge: a wall from the ground line down to a flat base on all four sides.
  const skirt: number[] = [], BASE = -8, edge = (pts: number[][]) => { for (let k = 0; k < pts.length - 1; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], h0 = M.hAt(x0, y0), h1 = M.hAt(x1, y1); const q = (x: number, y: number, h: number) => skirt.push(x - W / 2, h, y - H / 2); q(x0, y0, h0); q(x0, y0, BASE); q(x1, y1, h1); q(x1, y1, h1); q(x0, y0, BASE); q(x1, y1, BASE); } };
  const line = (fx: (k: number) => number[]) => { const p: number[][] = []; for (let k = 0; k <= GW; k++) p.push(fx(k)); return p; };
  edge(line(k => [k * C, 0])); edge(line(k => [W, k * C])); edge(line(k => [W - k * C, H])); edge(line(k => [0, H - k * C]));
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3)); sg.computeVertexNormals();
  mapGroup.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: '#3a3529', side: THREE.DoubleSide })));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W - .3, H - .3).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#3f6874', transparent: true, opacity: .8 })); water.renderOrder = 2; mapGroup.add(water);

  // Buildings: one merged mesh of flat-shaded walls and roofs. Roofs are triangulated, so L-shapes work.
  const Pa: number[] = [], Na: number[] = [], Ca: number[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), out = new THREE.Vector3();
  const tri = (a: number[], b: number[], c: number[], col: number[], o: THREE.Vector3) => {
    va.fromArray(a); vb.fromArray(b); vc.fromArray(c); nn.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
    if (nn.dot(o) < 0) { const t = b; b = c; c = t; nn.negate(); } nn.normalize();
    for (const q of [a, b, c]) { Pa.push(q[0], q[1], q[2]); Na.push(nn.x, nn.y, nn.z); Ca.push(col[0], col[1], col[2]); }
  };
  for (const b of M.B) {
    const vStart = Pa.length / 3;
    // Buildings outside the battle circle are grey scenery.
    const out0 = !inPlay(b.cx, b.cy), j = (b.v * 37 % 1 - .5) * 14, lum = (b.mat[0] * .3 + b.mat[1] * .59 + b.mat[2] * .11 + j) / 255;
    const BT = BTYPES[b.btype || 'house'], roof = out0 ? [lum * .62, lum * .63, lum * .65] : b.mat.map(v => (v + j) / 255);
    const wall = out0 || !BT.wall ? roof.map(v => v * .8) : BT.wall.map(v => v * .82 / 255), p = b.p;
    let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], c = p[(i + 1) % p.length]; area += a[0] * c[1] - c[0] * a[1]; }
    const T = p.map(q => [q[0] - W / 2, b.top, q[1] - H / 2]), Bt = p.map(q => [q[0] - W / 2, b.base, q[1] - H / 2]);
    const faces = THREE.ShapeUtils.triangulateShape(p.map(q => new THREE.Vector2(q[0], q[1])), []);
    // Churches and town halls get a pointed tower roof; castles get battlements along the walls.
    if (BT.spire && !out0) { const apex = [b.cx - W / 2, b.top + Math.min(14, b.h * .9 + 3), b.cy - H / 2]; for (let i = 0; i < p.length; i++) { const n = (i + 1) % p.length, ex = p[n][0] - p[i][0], ey = p[n][1] - p[i][1]; if (area > 0) out.set(ey, 1, -ex); else out.set(-ey, 1, ex); tri(T[i], T[n], apex, roof, out); } }
    else for (const f of faces) tri(T[f[0]], T[f[1]], T[f[2]], roof, _up);
    if (BT.battlements && !out0) for (let i = 0; i < p.length; i++) {
      const n = (i + 1) % p.length, len = Math.hypot(p[n][0] - p[i][0], p[n][1] - p[i][1]), k = Math.max(1, Math.floor(len / 1.6));
      for (let s = 0; s < k; s += 2) { const f0 = s / k, f1 = Math.min(1, (s + 1) / k), a0 = [p[i][0] + (p[n][0] - p[i][0]) * f0, p[i][1] + (p[n][1] - p[i][1]) * f0], a1 = [p[i][0] + (p[n][0] - p[i][0]) * f1, p[i][1] + (p[n][1] - p[i][1]) * f1];
        const lo0 = [a0[0] - W / 2, b.top, a0[1] - H / 2], lo1 = [a1[0] - W / 2, b.top, a1[1] - H / 2], hi0 = [a0[0] - W / 2, b.top + .9, a0[1] - H / 2], hi1 = [a1[0] - W / 2, b.top + .9, a1[1] - H / 2];
        const ex = a1[0] - a0[0], ey = a1[1] - a0[1]; if (area > 0) out.set(ey, 0, -ex); else out.set(-ey, 0, ex); tri(lo0, lo1, hi1, wall, out); tri(lo0, hi1, hi0, wall, out); tri(hi0, hi1, [hi1[0], hi1[1], hi1[2]], roof, _up); }
    }
    for (let i = 0; i < p.length; i++) {
      const n = (i + 1) % p.length, ex = p[n][0] - p[i][0], ey = p[n][1] - p[i][1];
      if (area > 0) out.set(ey, 0, -ex); else out.set(-ey, 0, ex);
      tri(Bt[i], Bt[n], T[n], wall, out); tri(Bt[i], T[n], T[i], wall, out);
    }
    b.vr = [vStart, Pa.length / 3 - vStart];
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(Pa, 3)); bldGeo = bg; bldY = new Float32Array(Pa.filter((_, i) => i % 3 === 1)); downKey = ''; bg.setAttribute('normal', new THREE.Float32BufferAttribute(Na, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(Ca, 3));
  const bm = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ vertexColors: true })); bm.castShadow = true; bm.receiveShadow = true; mapGroup.add(bm); xrayable.push(bm);

  for (const br of M.bridges) {
    // One straight deck from bank to bank, with piers down into the water.
    const grp = new THREE.Group(), sp = br.span, deckM = new THREE.MeshLambertMaterial({ color: '#8a8070' }), pierM = new THREE.MeshLambertMaterial({ color: '#5f594f' });
    const ax0 = br.cx + sp.ax * sp.s0, ay0 = br.cy + sp.ay * sp.s0, ax1 = br.cx + sp.ax * sp.s1, ay1 = br.cy + sp.ay * sp.s1;
    const a = new THREE.Vector3(ax0 - W / 2, sp.h0 - .4, ay0 - H / 2), b = new THREE.Vector3(ax1 - W / 2, sp.h1 - .4, ay1 - H / 2), len = a.distanceTo(b);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(sp.half * 2, .8, len), deckM); deck.position.copy(a).lerp(b, .5); deck.lookAt(b); deck.castShadow = true; deck.receiveShadow = true; grp.add(deck);
    for (const side of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(.3, .6, len), deckM); rail.position.set(side * (sp.half - .15), .7, 0); deck.add(rail); }
    const n = Math.max(1, Math.floor((sp.s1 - sp.s0) / 9));
    for (let k = 1; k < n; k++) {
      const f = k / n, x = ax0 + (ax1 - ax0) * f, y = ay0 + (ay1 - ay0) * f, top = sp.h0 + (sp.h1 - sp.h0) * f - .8, bottom = Math.min(-2.5, M.hAt(x, y));
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, top - bottom, 1.4), pierM); pier.position.set(x - W / 2, (top + bottom) / 2, y - H / 2); grp.add(pier);
    }
    br.group = grp; mapGroup.add(grp);
  }
  for (const inside of [true, false]) {
    const list = M.trees.filter(t => inPlay(t[0], t[1]) === inside); if (!list.length) continue;
    const tm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshLambertMaterial({ color: inside ? '#3d5832' : '#4b4f4b' }), list.length);
    list.forEach((t, i) => { _q.setFromAxisAngle(_up, t[0]); _p.set(t[0] - W / 2, M.hAt(t[0], t[1]) + t[2] / 2, t[1] - H / 2); _s.set(1.3 + t[2] * .18, t[2], 1.3 + t[2] * .18); _m.compose(_p, _q, _s); tm.setMatrixAt(i, _m); });
    tm.castShadow = inside; tm.receiveShadow = true; mapGroup.add(tm); xrayable.push(tm);
  }
  const fogMesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); fogMesh.renderOrder = 3; mapGroup.add(fogMesh);
  scene.add(mapGroup); structKey = ''; applyViews();
}

// Dynamic objects, created once and refilled every frame.
const mModel: Record<string, any> = {}, nModel: Record<string, number> = {};
let mTrench, mTrenchLip, mSand, mWire, mWall, mTrap, mPlane, mCrater, mBoom, ptUnits, ptBodies, ptGhosts, ptHeads, lineG;
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
  mTrap = inst(new THREE.BoxGeometry(2.2, .3, .3), lam('#4c4b47'), 9000, true); mRubble = inst(box, lam('#ffffff'), 20000, true);
  for (const k of Object.keys(MODELS)) mModel[k] = inst(MODELS[k], new THREE.MeshLambertMaterial({ vertexColors: true }), k === 'hq' || k === 'flag' ? 8 : 400, true);
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
  if (S.phase === 'plan' && s.team !== NET.me && s.round >= S.round) return false;
  if (S.phase !== 'plan' && s.placedAt == null) return false;
  if (V && V.fogOn && s.team !== NET.me) return s.cells.some((c: number) => cellSeen(V.seen, (c % GW) * C + 1, Math.floor(c / GW) * C + 1));
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
  let n = 0, nb = 0, ng = 0;
  const putU = (x: number, y: number, h: number, c: number[], dim: number) => { if (n >= 5000) return; up[n * 3] = x - W / 2; up[n * 3 + 1] = h; up[n * 3 + 2] = y - H / 2; uc[n * 3] = c[0] * dim; uc[n * 3 + 1] = c[1] * dim; uc[n * 3 + 2] = c[2] * dim; n++; };
  // Team tint over the model's own colours: a light wash of the team colour.
  for (const k in mModel) nModel[k] = 0;
  const emp = (kind: string, x: number, y: number, c: number[], hd: number) => {
    const m = mModel[kind]; if (!m || nModel[kind] >= 400) return;
    setI(m, nModel[kind]++, x, y, unitH(x, y), 1.6, 1.6, 1.6, hd || 0, [.62 + c[0] * .5, .62 + c[1] * .5, .62 + c[2] * .5]);
  };
  for (const u of V.units) {
    const c = TRGB[u.team];
    if (u.alive) {
      if (u.team !== NET.me && V.fogOn && !V.isVis(u)) continue;
      putU(u.x, u.y, unitH(u.x, u.y) + .9 + (u.drop > 0 ? u.drop * 14 : 0), c, 1);
      if (MODEL_KINDS.has(u.kind)) emp(u.kind, u.x, u.y, c, u.hd);
    } else if (nb < 5000) {
      if (u.team !== NET.me && V.fogOn && !cellSeen(V.seen, u.x, u.y)) continue;
      bp[nb * 3] = u.x - W / 2; bp[nb * 3 + 1] = unitH(u.x, u.y) + .2; bp[nb * 3 + 2] = u.y - H / 2; bc[nb * 3] = c[0] * .45; bc[nb * 3 + 1] = c[1] * .45; bc[nb * 3 + 2] = c[2] * .45; nb++;
    }
  }
  if (plan) for (const s of S.squads) {
    if (s.members || s.team !== NET.me) continue; const c = TRGB[NET.me];
    for (const p of s.pos) putU(p[0], p[1], unitH(p[0], p[1]) + .9, c, .75);
    if (MODEL_KINDS.has(s.kind)) emp(s.kind, s.pos[0][0], s.pos[0][1], c, Math.atan2(-(H / 2 - s.pos[0][1]), W / 2 - s.pos[0][0]));
  }
  // Last known enemy positions, shown faded.
  for (const g of V.ghosts) { if (ng >= 3000) break; const c = TRGB[g.team]; gp[ng * 3] = g.x - W / 2; gp[ng * 3 + 1] = unitH(g.x, g.y) + .9; gp[ng * 3 + 2] = g.y - H / 2; gc[ng * 3] = c[0]; gc[ng * 3 + 1] = c[1]; gc[ng * 3 + 2] = c[2]; ng++; }
  for (const [p, c] of [[ptUnits, n], [ptBodies, nb], [ptGhosts, ng]] as [any, number][]) { p.geometry.setDrawRange(0, c); p.geometry.attributes.position.needsUpdate = true; p.geometry.attributes.color.needsUpdate = true; }
  // Each HQ: a bunker with a flag in the team colour. Enemy HQs show once your side has found them.
  for (const t of S.teams) {
    if (t.id !== NET.me && V.fogOn && !(S.hqKnown && S.hqKnown[NET.me] && S.hqKnown[NET.me].has(t.id))) continue;
    const x = t.zone.x, y = t.zone.y, h = M.hAt(x, y), fc = TRGB[t.lost && t.hqBy >= 0 ? t.hqBy : t.id];
    // The flag streams out from the top of the pole and sways a little.
    const sway = Math.sin(performance.now() / 700 + t.id) * .25;
    setI(mModel.hq, nModel.hq++, x, y, h, 1, 1, 1, 0, [1, 1, 1]);
    setI(mModel.flag, nModel.flag++, x, y, h + 11.4, 1, 1, 1, .4 + sway, fc);
  }
  for (const k in mModel) done(mModel[k], nModel[k]);
  const ppu = view.ch / 2 / (cam.dist * Math.tan(FOV / 2 * Math.PI / 180));
  ptUnits.material.size = clamp(ppu * 1.1, 2.5, 7); ptBodies.material.size = clamp(ppu * .8, 1.5, 5); ptGhosts.material.size = clamp(ppu * 1.1, 2.5, 7); ptHeads.material.size = clamp(ppu * 1.2, 2.5, 6);

  const lp = lineG.attributes.position.array, lc = lineG.attributes.color.array; let L = 0;
  const seg = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, c: number[], c2?: number[]) => {
    if (L >= LMAX) return; const o = L * 6; lp[o] = x0 - W / 2; lp[o + 1] = h0; lp[o + 2] = y0 - H / 2; lp[o + 3] = x1 - W / 2; lp[o + 4] = h1; lp[o + 5] = y1 - H / 2;
    lc[o] = c[0]; lc[o + 1] = c[1]; lc[o + 2] = c[2]; const d = c2 || c; lc[o + 3] = d[0]; lc[o + 4] = d[1]; lc[o + 5] = d[2]; L++;
  };
  for (const t of V.tracers) {
    if (V.fogOn && t.team !== NET.me && !cellSeen(V.vis, t.x0, t.y0) && !cellSeen(V.vis, t.x1, t.y1)) continue;
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
  updateStructs(V); updateDowns();
}
export function render() { renderer.render(scene, camera); }
