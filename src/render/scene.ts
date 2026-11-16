import { NET, sw } from '../state';
import * as THREE from 'three';
import { W, H, C, GW, GH, IW, IH, IC, TRGB, T_WATER, T_BRIDGE, T_BUILD, M_PER_UNIT, clamp, inPlay } from '../config';
import { S, M, OWN } from '../state';
import { smokeR, orderSpots } from '../sim';
import { unitH, cellOf, nudge } from '../world';
import { camera, cam, FOV, view, fpv } from './camera';
import { MODELS, DEFENCES } from './models';
import { BTYPES } from '../map/btypes';
import { F_HEDGE, F_WALL, F_FENCE } from '../map/types';
import { input } from '../ui/input';
import { K, COST, TOOLDEF, MOVERS, PLATOON_SIZE, unitKind } from '../config';
import { placeSpot, left, squadLayout } from '../plan';
const WALLS = [[170, 108, 86], [216, 205, 180], [184, 176, 158], [228, 223, 210], [146, 98, 80], [198, 172, 140]];
const ROOFS = [[94, 99, 106], [152, 88, 64], [114, 84, 66], [74, 78, 84], [130, 74, 58]];
const FLAT = new Set(['castle', 'rampart', 'wall', 'tower', 'industrial', 'office', 'station', 'hospital', 'police', 'fire']);
// The smallest rectangle round a footprint, lined up with one of its edges. l is the long way, s the short way.
function obb(p: number[][]) {
  let best: any = null;
  for (let i = 0; i < p.length; i++) {
    const n = (i + 1) % p.length; let ux = p[n][0] - p[i][0], uy = p[n][1] - p[i][1]; const len = Math.hypot(ux, uy); if (len < .3) continue; ux /= len; uy /= len;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const q of p) { const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0); if (best && area >= best.area) continue;
    best = u1 - u0 >= v1 - v0 ? { area, lx: ux, ly: uy, sx: -uy, sy: ux, l0: u0, l1: u1, s0: v0, s1: v1 } : { area, lx: -uy, ly: ux, sx: ux, sy: uy, l0: v0, l1: v1, s0: u0, s1: u1 };
  }
  return best;
}
const MODEL_KINDS = new Set(['mg', 'mortar', 'tank', 'at', 'op', 'fob']), MAN_PARTS = new Set(['soldier', 'thigh', 'shin', 'prone', 'body']);

// Colours are given in sRGB and used as they are, like the 2D interface.
THREE.ColorManagement.enabled = false;
export let renderer: THREE.WebGLRenderer;
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#121410'); scene.fog = new THREE.Fog('#121410', 560, 1200);

// What the renderer draws this frame: the live battle or a replay frame, with or without fog.
export interface View {
  units: any[]; smokes?: any[]; tracers: any[]; fx: any[]; craters: any[]; shells: any[]; planes: any[]; bombs: any[];
  fogOn: boolean; isVis: (u: any) => boolean; ghosts: any[]; seen: Uint8Array; vis: Uint8Array; replayT?: number;
}

const ilayer = document.createElement('canvas'); ilayer.width = IW; ilayer.height = IH; const ictx = ilayer.getContext('2d');
const terrTex = new THREE.CanvasTexture(ilayer); terrTex.magFilter = THREE.LinearFilter; terrTex.minFilter = THREE.LinearFilter;
const flayer = document.createElement('canvas'); flayer.width = IW; flayer.height = IH; const fctx = flayer.getContext('2d');
const fogTex = new THREE.CanvasTexture(flayer); fogTex.magFilter = THREE.LinearFilter; fogTex.minFilter = THREE.LinearFilter;
// Ground never looked at loses its colour. The red channel holds 255 where it is undiscovered.
const ulayer = document.createElement('canvas'); ulayer.width = IW; ulayer.height = IH; const uctx = ulayer.getContext('2d');
const unseenTex = new THREE.CanvasTexture(ulayer); unseenTex.magFilter = THREE.LinearFilter; unseenTex.minFilter = THREE.LinearFilter; unseenTex.flipY = false;
const winScale = { value: 1 };
const timeU = { value: 0 };
// 0 by day, 1 at night: some windows light up.
const nightU = { value: 0 };
// fx: 'win' window rows on walls, 'sway' trees move in the wind, 'water' ripples.
function greyUnseen<T extends THREE.Material>(m: T, fx: boolean | 'sway' | 'water' = false): T {
  if (fx) (m as any).defines = { ...((m as any).defines || {}), [fx === 'sway' ? 'FO_SWAY' : fx === 'water' ? 'FO_WATER' : 'FO_WIN']: '' };
  m.onBeforeCompile = (sh: any) => {
    sh.uniforms.unseenMap = { value: unseenTex }; sh.uniforms.winScale = winScale; sh.uniforms.foTime = timeU; sh.uniforms.foNight = nightU;
    sh.vertexShader = `varying vec3 vFoW;
uniform float foTime;
#ifdef FO_WIN
attribute float foWin;
varying float vFoWin;
#endif
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef FO_SWAY
        // Trees lean in the wind: the top moves, the foot stays. Each tree has its own beat.
        float foPh = instanceMatrix[3].x * .37 + instanceMatrix[3].z * .23;
        transformed.x += (sin(foTime * 1.4 + foPh) * .045 + sin(foTime * 3.1 + foPh * 1.7) * .012) * position.y * position.y;
        transformed.z += cos(foTime * 1.1 + foPh) * .03 * position.y * position.y;
      #endif
      #ifdef FO_WATER
        transformed.y += sin(foTime * .9 + position.x * .35 + position.z * .27) * .05 + sin(foTime * 1.7 + position.x * .8 - position.z * .6) * .02;
      #endif`).replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fowP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fowP = instanceMatrix * fowP;
      #endif
      vFoW = (modelMatrix * fowP).xyz;
      #ifdef FO_WIN
        vFoWin = foWin;
      #endif`);
    sh.fragmentShader = `uniform sampler2D unseenMap;
uniform float winScale;
uniform float foTime;
uniform float foNight;
varying vec3 vFoW;
#ifdef FO_WIN
varying float vFoWin;
#endif
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float foGlow = 0.;
      #ifdef FO_WATER
        // Broad, soft swells of light that drift slowly. Waves are added, not multiplied, so no grid pattern shows.
        float foR = sin(vFoW.x * .09 + vFoW.z * .05 + foTime * .35) + sin(vFoW.x * .04 - vFoW.z * .11 - foTime * .22) + sin(vFoW.x * .21 + vFoW.z * .17 + foTime * .6) * .35;
        diffuseColor.rgb += vec3(.012, .016, .018) * foR;
      #endif
      #ifdef FO_WIN
        // Rows of dark windows on walls (faces that stand upright), one bay about every 3 m.
        vec3 fowN = normalize(cross(dFdx(vFoW), dFdy(vFoW)));
        if (abs(fowN.y) < .3) {
          vec2 fowH = normalize(vec2(-fowN.z, fowN.x) + 1e-5);
          vec2 fowG = vec2(fract(dot(vFoW.xz, fowH) * winScale), fract(vFoW.y * winScale * 1.3));
          // Walls and castles (vFoWin = 0) have no rows of windows.
          float fowW = step(.3, fowG.x) * step(fowG.x, .7) * step(.28, fowG.y) * step(fowG.y, .74) * vFoWin;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.16, .18, .22), fowW * .45);
          // At night about one window in three is lit. Each window has its own fixed chance and warmth.
          vec2 fowId = vec2(floor(dot(vFoW.xz, fowH) * winScale), floor(vFoW.y * winScale * 1.3));
          float fowR = fract(sin(dot(fowId, vec2(12.9898, 78.233)) + floor(vFoW.x * .02) * 3.1 + floor(vFoW.z * .02) * 7.7) * 43758.5453);
          foGlow = fowW * step(.66, fowR) * foNight * (.7 + fract(fowR * 17.) * .5);
        }
      #endif
      float fowU = texture2D(unseenMap, vec2(vFoW.x / ${W.toFixed(1)} + .5, vFoW.z / ${H.toFixed(1)} + .5)).r;
      float fowL = dot(diffuseColor.rgb, vec3(.3, .59, .11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(fowL), fowU * .78);`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(1., .72, .38) * foGlow;`);
  };
  return m;
}

let sun: THREE.DirectionalLight = null;
// Shadows can be turned off in the settings, for slow computers.
export const shadowsOn = () => { try { return localStorage.getItem('fo-shadows') !== '0'; } catch { return true; } };
export function setShadows(v: boolean) { try { localStorage.setItem('fo-shadows', v ? '1' : '0'); } catch { } if (sun) sun.castShadow = v; }
export function initRenderer(canvas: HTMLCanvasElement) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Intensities times pi give the classic (non-physical) light levels the colours were picked for.
  hemi = new THREE.HemisphereLight('#dfe2d2', '#3a3528', 0.62 * Math.PI); scene.add(hemi);
  sun = new THREE.DirectionalLight('#fff0d8', 0.78 * Math.PI); sun.position.set(-150, 240, -110); sun.castShadow = shadowsOn(); sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, near: 10, far: 900 }); sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);
  createDynamic(); setNight(nightOn());
}
// Night: a dim blue moon instead of the sun, a dark sky, and lit windows. Kept in this browser.
let hemi: THREE.HemisphereLight = null;
export const nightOn = () => { try { return localStorage.getItem('fo-night') === '1'; } catch { return false; } };
export function setNight(v: boolean) {
  try { localStorage.setItem('fo-night', v ? '1' : '0'); } catch { }
  nightU.value = v ? 1 : 0;
  hemi.color.set(v ? '#5a6a8c' : '#dfe2d2'); hemi.groundColor.set(v ? '#14161c' : '#3a3528'); hemi.intensity = (v ? .42 : .62) * Math.PI;
  sun.color.set(v ? '#9fb4e0' : '#fff0d8'); sun.intensity = (v ? .32 : .78) * Math.PI;
  const sky = v ? '#07090e' : '#121410'; (scene.background as THREE.Color).set(sky); (scene.fog as THREE.Fog).color.set(sky);
}

// Ground owned by each side. Under fog, other sides' ground shows only where you have looked.
// Under fog, enemy ground shows only as last seen: who held it when your troops last looked there.
const KOWN = new Int8Array(IW * IH).fill(-1);
export function paintTerritory(seen: Uint8Array | null, vis?: Uint8Array) {
  const img = ictx.createImageData(IW, IH), px = img.data;
  if (seen && vis) { if (S.phase === 'plan' && S.round === 1) KOWN.fill(-1); for (let i = 0; i < IW * IH; i++) if (vis[i]) KOWN[i] = OWN[i]; }
  for (let i = 0; i < IW * IH; i++) {
    const o = !seen ? OWN[i] : OWN[i] === NET.me ? NET.me : KOWN[i]; if (o < 0 || (seen && o !== NET.me && !seen[i])) continue;
    const c = TRGB[sw(o)]; px[i * 4] = c[0] * 255; px[i * 4 + 1] = c[1] * 255; px[i * 4 + 2] = c[2] * 255; px[i * 4 + 3] = viewOpts.area ? 175 : o === NET.me ? 52 : 64;
  }
  ictx.putImageData(img, 0, 0); terrTex.needsUpdate = true;
}
// Fog: clear where you see now, light shade where you have seen, dark where you never looked.
// The painted fog eases towards these levels: ground clears in about half a second and closes again
// slowly, so sight that comes and goes as troops move does not make the ground flicker.
const fogT = new Float32Array(IW * IH), fogA = new Float32Array(IW * IH), unT = new Float32Array(IW * IH), unA = new Float32Array(IW * IH);
const fogImg = fctx.createImageData(IW, IH), unImg = uctx.createImageData(IW, IH);
let fogWasOn = false, fogMoving = false;
export function paintFog(vis: Uint8Array, seen: Uint8Array, on: boolean) {
  for (let i = 0; i < IW * IH; i++) {
    const inside = inPlay((i % IW) * IC + 2, Math.floor(i / IW) * IC + 2);
    fogT[i] = on && inside ? (vis[i] ? 0 : seen[i] ? 80 : 112) : 0; unT[i] = on && !seen[i] ? 255 : 0;
  }
  // Fog turned on or off (a new phase type, a replay): no fade, show it as it is at once.
  if (on !== fogWasOn) { fogA.set(fogT); unA.set(unT); fogWasOn = on; }
  fogMoving = true; writeFog();
}
function stepFog(dt: number) {
  if (!fogMoving) return; let moving = false; const clear = 1 - Math.exp(-dt * 6), close = 1 - Math.exp(-dt * .8);
  for (let i = 0; i < IW * IH; i++) {
    const d = fogT[i] - fogA[i]; if (d) { fogA[i] = Math.abs(d) < .5 ? fogT[i] : fogA[i] + d * (d < 0 ? clear : close); moving = true; }
    const e = unT[i] - unA[i]; if (e) { unA[i] = Math.abs(e) < 1 ? unT[i] : unA[i] + e * clear; moving = true; }
  }
  fogMoving = moving; writeFog();
}
function writeFog() {
  const px = fogImg.data, up = unImg.data;
  for (let i = 0; i < IW * IH; i++) { px[i * 4] = 11; px[i * 4 + 1] = 14; px[i * 4 + 2] = 18; px[i * 4 + 3] = fogA[i]; up[i * 4] = unA[i]; up[i * 4 + 3] = 255; }
  fctx.putImageData(fogImg, 0, 0); fogTex.needsUpdate = true; uctx.putImageData(unImg, 0, 0); unseenTex.needsUpdate = true;
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
  terrGeo = tg; terrY0 = new Float32Array(GW * GH * 6); for (let i = 0; i < terrY0.length; i++) terrY0[i] = pos[i * 3 + 1]; dug.fill(0); dugKey = '';
  const terrain = new THREE.Mesh(tg, greyUnseen(new THREE.MeshLambertMaterial({ map: gt }))); terrain.receiveShadow = true; mapGroup.add(terrain);
  const over = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: terrTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); over.renderOrder = 1; mapGroup.add(over);
  // Square, solid map edge: a wall from the ground line down to a flat base on all four sides.
  const skirt: number[] = [], BASE = -8, edge = (pts: number[][]) => { for (let k = 0; k < pts.length - 1; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], h0 = M.hAt(x0, y0), h1 = M.hAt(x1, y1); const q = (x: number, y: number, h: number) => skirt.push(x - W / 2, h, y - H / 2); q(x0, y0, h0); q(x0, y0, BASE); q(x1, y1, h1); q(x1, y1, h1); q(x0, y0, BASE); q(x1, y1, BASE); } };
  const line = (fx: (k: number) => number[]) => { const p: number[][] = []; for (let k = 0; k <= GW; k++) p.push(fx(k)); return p; };
  edge(line(k => [k * C, 0])); edge(line(k => [W, k * C])); edge(line(k => [W - k * C, H])); edge(line(k => [0, H - k * C]));
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3)); sg.computeVertexNormals();
  mapGroup.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: '#3a3529', side: THREE.DoubleSide })));
  // Water: a surface over the wet cells only, each at its own level.
  const wp: number[] = [], isW = (c: number) => M.terr0[c] === T_WATER || M.terr0[c] === T_BRIDGE;
  const vh = (i: number, j: number) => { let s = 0, k = 0; for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (ci >= 0 && cj >= 0 && ci < GW && cj < GH) { s += M.wl[cj * GW + ci]; k++; } return s / k; };
  for (let c = 0; c < GW * GH; c++) {
    const i = c % GW, j = (c / GW) | 0, x0 = i * C - W / 2, z0 = j * C - H / 2;
    // Water also lies under the cells next to wet ones; the ground hides it above the shore line.
    let near = isW(c); for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) { const ni = i + di, nj = j + dj; if (ni >= 0 && nj >= 0 && ni < GW && nj < GH && isW(nj * GW + ni)) { near = true; break; } }
    if (!near) continue;
    const a = [x0, vh(i, j), z0], b = [x0 + C, vh(i + 1, j), z0], d = [x0, vh(i, j + 1), z0 + C], e = [x0 + C, vh(i + 1, j + 1), z0 + C];
    wp.push(...a, ...d, ...b, ...b, ...d, ...e);
  }
  // Normals point straight up: the surface shades as one smooth sheet, with no shine on each triangle.
  const wn = new Float32Array(wp.length); for (let i = 1; i < wn.length; i += 3) wn[i] = 1;
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('normal', new THREE.BufferAttribute(wn, 3));
  // Phong, so the sun puts a soft shine on the water.
  const water = new THREE.Mesh(wg, greyUnseen(new THREE.MeshPhongMaterial({ color: '#35606c', specular: '#22333a', shininess: 30, transparent: true, opacity: .9 }), 'water')); water.renderOrder = 2; mapGroup.add(water);

  // Buildings: one merged mesh of flat-shaded walls and roofs. Roofs are triangulated, so L-shapes work.
  const Pa: number[] = [], Na: number[] = [], Ca: number[] = [], Wa: number[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), out = new THREE.Vector3();
  const tri = (a: number[], b: number[], c: number[], col: number[], o: THREE.Vector3) => {
    va.fromArray(a); vb.fromArray(b); vc.fromArray(c); nn.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
    if (nn.dot(o) < 0) { const t = b; b = c; c = t; nn.negate(); } nn.normalize();
    for (const q of [a, b, c]) { Pa.push(q[0], q[1], q[2]); Na.push(nn.x, nn.y, nn.z); Ca.push(col[0], col[1], col[2]); }
  };
  // A main building that has a tall part (its own tower) gets no extra spire.
  const tallPart = new Set<number>(); for (const b of M.B) if (b.parent != null && b.h > M.B[b.parent].h + 1) tallPart.add(b.parent);
  for (const b of M.B) {
    const vStart = Pa.length / 3;
    // Buildings outside the battle circle are grey scenery.
    const out0 = !inPlay(b.cx, b.cy), j = (b.v * 37 % 1 - .5) * 14, lum = (b.mat[0] * .3 + b.mat[1] * .59 + b.mat[2] * .11 + j) / 255;
    const BT = BTYPES[b.btype || 'house'], plain = !b.btype || b.btype === 'house' || b.btype === 'flats', fr = (k: number) => (b.v * k) % 1;
    // Homes: brick, render or stone walls under slate or tile roofs. Other types keep their own roof colour over pale walls.
    const roofC = plain ? ROOFS[Math.floor(fr(13.7) * ROOFS.length)] : BT.roof, wallC = plain ? WALLS[Math.floor(fr(7.3) * WALLS.length)] : BT.wall || (b.btype === 'industrial' || b.btype === 'office' ? [168, 168, 162] : [204, 196, 180]);
    const roof = out0 ? [lum * .62, lum * .63, lum * .65] : roofC.map(v => (v + j) / 255);
    const wall = out0 ? [lum * .5, lum * .5, lum * .52] : wallC.map(v => (v + j * .6) / 255), p = b.p;
    let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], c = p[(i + 1) % p.length]; area += a[0] * c[1] - c[0] * a[1]; }
    const T = p.map(q => [q[0] - W / 2, b.top, q[1] - H / 2]), Bt = p.map(q => [q[0] - W / 2, b.base, q[1] - H / 2]);
    const faces = THREE.ShapeUtils.triangulateShape(p.map(q => new THREE.Vector2(q[0], q[1])), []);
    // Churches and town halls get a pointed tower roof; castles get battlements along the walls.
    for (const f of faces) tri(T[f[0]], T[f[1]], T[f[2]], roof, _up);
    // A pitched (hip) roof for buildings that are close to a rectangle and not tall blocks.
    b.hip = undefined;
    const ob = b.parent == null && !FLAT.has(b.btype || 'house') && b.h * M_PER_UNIT < 19 ? obb(p) : null;
    if (ob && Math.abs(area) / 2 > ob.area * .84 && ob.s1 - ob.s0 > 1.6 && ob.s1 - ob.s0 < 18) {
      const hs = (ob.s1 - ob.s0) / 2, sm = (ob.s0 + ob.s1) / 2, inset = Math.min(hs * .8, (ob.l1 - ob.l0) * .45), rh = clamp(hs * .6, .5, 3), e = .12;
      const at = (l: number, s: number, y: number) => [l * ob.lx + s * ob.sx - W / 2, y, l * ob.ly + s * ob.sy - H / 2];
      const a0 = at(ob.l0 - e, ob.s0 - e, b.top), a1 = at(ob.l1 + e, ob.s0 - e, b.top), b0 = at(ob.l0 - e, ob.s1 + e, b.top), b1 = at(ob.l1 + e, ob.s1 + e, b.top), r0 = at(ob.l0 + inset, sm, b.top + rh), r1 = at(ob.l1 - inset, sm, b.top + rh);
      const dark = roof.map(v => v * .88); b.hip = { lx: ob.lx, ly: ob.ly, sx: ob.sx, sy: ob.sy, l0: ob.l0, l1: ob.l1, sm, hs, inset, rh };
      tri(a0, a1, r1, roof, _up); tri(a0, r1, r0, roof, _up); tri(b0, b1, r1, dark, _up); tri(b0, r1, r0, dark, _up); tri(a0, b0, r0, dark, _up); tri(a1, b1, r1, roof, _up);
    }
    // Churches and town halls: a square tower with a pointed spire rising from the middle of the roof.
    if (BT.spire && !out0 && b.parent == null && !tallPart.has(b.id)) {
      const half = clamp(Math.sqrt(Math.abs(area) / 2) / 5, 1.2, 3.5), x0 = b.cx - W / 2, z0 = b.cy - H / 2, y0 = b.top, y1 = b.top + half * 2.2, y2 = y1 + half * 3;
      b.spire = { half, y1, y2 }; // the selection outline draws it too
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [x0 + u * half, z0 + v * half]), wall2 = (BT.wall || b.mat).map(v => v * .85 / 255);
      for (let i = 0; i < 4; i++) {
        const a0 = c[i], a1 = c[(i + 1) % 4]; out.set((a0[0] + a1[0]) / 2 - x0, 0, (a0[1] + a1[1]) / 2 - z0);
        tri([a0[0], y0, a0[1]], [a1[0], y0, a1[1]], [a1[0], y1, a1[1]], wall2, out); tri([a0[0], y0, a0[1]], [a1[0], y1, a1[1]], [a0[0], y1, a0[1]], wall2, out);
        out.set((a0[0] + a1[0]) / 2 - x0, half * .6, (a0[1] + a1[1]) / 2 - z0); tri([a0[0], y1, a0[1]], [a1[0], y1, a1[1]], [x0, y2, z0], roof, out);
      }
    }
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
    const win = BT.plain ? 0 : 1; for (let k = Wa.length; k < Pa.length / 3; k++) Wa.push(win);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(Pa, 3)); bldGeo = bg; bldY = new Float32Array(Pa.filter((_, i) => i % 3 === 1)); downKey = ''; bg.setAttribute('normal', new THREE.Float32BufferAttribute(Na, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(Ca, 3)); bg.setAttribute('foWin', new THREE.Float32BufferAttribute(Wa, 1));
  winScale.value = M_PER_UNIT / 4.4;
  const bm = new THREE.Mesh(bg, greyUnseen(new THREE.MeshLambertMaterial({ vertexColors: true }), true)); bm.castShadow = true; bm.receiveShadow = true; mapGroup.add(bm); xrayable.push(bm);

  for (const br of M.bridges) {
    // One straight deck from bank to bank, with piers down into the water.
    const grp = new THREE.Group(), sp = br.span, deckM = new THREE.MeshLambertMaterial({ color: '#8a8070' }), pierM = new THREE.MeshLambertMaterial({ color: '#5f594f' });
    const ax0 = br.cx + sp.ax * sp.s0, ay0 = br.cy + sp.ay * sp.s0, ax1 = br.cx + sp.ax * sp.s1, ay1 = br.cy + sp.ay * sp.s1;
    const a = new THREE.Vector3(ax0 - W / 2, sp.h0 - .4, ay0 - H / 2), b = new THREE.Vector3(ax1 - W / 2, sp.h1 - .4, ay1 - H / 2), len = a.distanceTo(b);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(sp.half * 2, .8, len), deckM); deck.position.copy(a).lerp(b, .5); deck.lookAt(b); deck.castShadow = true; deck.receiveShadow = true; grp.add(deck);
    for (const side of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(.3, .6, len), deckM); rail.position.set(side * (sp.half - .15), .7, 0); deck.add(rail); }
    const n = Math.max(1, Math.floor((sp.s1 - sp.s0) / 9));
    for (let k = 1; k < n; k++) {
      const f = k / n, x = ax0 + (ax1 - ax0) * f, y = ay0 + (ay1 - ay0) * f, top = sp.h0 + (sp.h1 - sp.h0) * f - .8, bottom = M.hAt(x, y) - 1;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, top - bottom, 1.4), pierM); pier.position.set(x - W / 2, (top + bottom) / 2, y - H / 2); grp.add(pier);
    }
    br.group = grp; mapGroup.add(grp);
  }
  for (const inside of [true, false]) {
    const list = M.trees.filter(t => inPlay(t[0], t[1]) === inside); if (!list.length) continue;
    const tm = new THREE.InstancedMesh(inside ? MODELS.tree : MODELS.treeGrey, greyUnseen(new THREE.MeshLambertMaterial({ vertexColors: true }), 'sway'), list.length);
    list.forEach((t, i) => { const w = (1.3 + t[2] * .18) * 2, sh = .82 + ((t[0] * 7.31 + t[1] * 3.17) % 1) * .3; _q.setFromAxisAngle(_up, t[0]); _p.set(t[0] - W / 2, M.hAt(t[0], t[1]) - .1, t[1] - H / 2); _s.set(w, t[2] * 1.15, w); _m.compose(_p, _q, _s); tm.setMatrixAt(i, _m); _c.setRGB(sh, sh, sh); tm.setColorAt(i, _c); });
    tm.castShadow = inside; tm.receiveShadow = true; mapGroup.add(tm); xrayable.push(tm);
  }
  // Hedges, walls and fences, laid end to end along the mapped lines. A piece stands only where its cell holds
  // that boundary, so gates, roads and buildings leave gaps exactly where the battle rules have them.
  const FK = [[F_HEDGE, MODELS.hedge, 1.15, 1.45, 1], [F_WALL, MODELS.fieldWall, 1.3, 1.3, 1], [F_FENCE, MODELS.fence, 1.6, 1.4, .6]] as const;
  for (const [k, geom, step, sy, sw] of FK) {
    const at: number[][] = [];
    for (const f of M.fences) {
      if (f.k !== k) continue;
      for (let i = 0; i < f.pts.length - 1; i++) {
        const a = f.pts[i], b = f.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .05) continue;
        const n = Math.max(1, Math.round(L / step)), len = L / n, yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
        for (let j = 0; j < n; j++) {
          const x = a[0] + (b[0] - a[0]) * (j + .5) / n, y = a[1] + (b[1] - a[1]) * (j + .5) / n, cx = Math.floor(x / C), cy = Math.floor(y / C);
          if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || M.feat[cy * GW + cx] !== k) continue;
          at.push([x, y, len, yaw]);
        }
      }
    }
    if (!at.length) continue;
    const fm = new THREE.InstancedMesh(geom, greyUnseen(new THREE.MeshLambertMaterial({ vertexColors: true })), at.length);
    at.forEach(([x, y, len, yaw], i) => {
      const r = (x * 7.31 + y * 3.17) % 1, out0 = !inPlay(x, y), sh = out0 ? .55 : .86 + r * .26;
      // Hedges vary in height and turn a little, piece by piece, so a row reads as growth and not as blocks.
      const hedge = k === F_HEDGE, r2 = (x * 3.73 + y * 5.11) % 1;
      _q.setFromAxisAngle(_up, yaw + (hedge ? (r2 - .5) * .5 : 0)); _p.set(x - W / 2, M.hAt(x, y) - .05, y - H / 2);
      _s.set(len * (hedge ? 1.25 : 1.08), sy * (hedge ? .78 + r * .44 : .9 + r * .2), sw * (hedge ? .9 + r2 * .3 : 1)); _m.compose(_p, _q, _s); fm.setMatrixAt(i, _m);
      if (out0) _c.setRGB(sh * 1.2, sh, sh * 1.15); else _c.setRGB(sh, sh, sh); fm.setColorAt(i, _c);
    });
    fm.castShadow = true; fm.receiveShadow = true; mapGroup.add(fm); if (k === F_HEDGE) xrayable.push(fm);
  }
  const fogMesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); fogMesh.renderOrder = 3; mapGroup.add(fogMesh);
  scene.add(mapGroup); structKey = ''; applyViews();
}

// Dynamic objects, created once and refilled every frame.
const mModel: Record<string, any> = {}, nModel: Record<string, number> = {};
let mBank: any, terrGeo: THREE.BufferGeometry | null = null, terrY0: Float32Array | null = null, pitMesh: THREE.Mesh | null = null;
let mSoldier, mBody, mThigh, mShin, mProne, mSmoke, mTrench, mTrenchLip, mSand, mWire, mWall, mTrap, mPlane, mCrater, mBoom, ptUnits, ptBodies, ptGhosts, ptHeads, lineG;
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
  const dm = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  mTrench = inst(DEFENCES.trench, dm(), 4000); mBank = inst(DEFENCES.trenchBank, dm(), 8000, true); mSand = inst(DEFENCES.sandbag, dm(), 4000, true); mWire = inst(DEFENCES.wire, dm(), 4000, true); mWall = inst(DEFENCES.wall, dm(), 4000, true);
  mTrap = inst(DEFENCES.tanktrap, dm(), 4000, true); mRubble = inst(box, lam('#ffffff'), 20000, true);
  for (const k of Object.keys(MODELS)) if (!MAN_PARTS.has(k)) mModel[k] = inst(MODELS[k], new THREE.MeshLambertMaterial({ vertexColors: true }), k === 'hq' || k === 'flag' ? 8 : 400, true);
  mPlane = inst(box, new THREE.MeshLambertMaterial({ color: '#c87a2a' }), 40, true);
  mCrater = inst(new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#211b14', transparent: true, opacity: .75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 700);
  // Smoke: grey puffs, a few per cloud, swelling and fading.
  mSmoke = inst(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#c9ccc8', transparent: true, opacity: .62, depthWrite: false }), 400);
  mBoom = inst(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), 300);
  mSoldier = inst(MODELS.soldier, dm(), 5000, true); mThigh = inst(MODELS.thigh, dm(), 10000, true); mShin = inst(MODELS.shin, dm(), 10000, true);
  mProne = inst(MODELS.prone, dm(), 5000, true); mBody = inst(MODELS.body, dm(), 5000, true);
  ptUnits = pointsObj(5000, 3, 1); ptBodies = pointsObj(5000, 2, 1); ptGhosts = pointsObj(3000, 3, .45); ptHeads = pointsObj(800, 3, 1);
  lineG = new THREE.BufferGeometry(); lineG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LMAX * 6), 3)); lineG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LMAX * 6), 3)); lineG.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(lineG, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85 })); lines.frustumCulled = false; scene.add(lines);
}
function setI(mesh: any, i: number, x: number, y: number, h: number, sx: number, sy: number, sz: number, yaw: number, col?: number[]) {
  _q.setFromAxisAngle(_up, yaw || 0); _p.set(x - W / 2, h, y - H / 2); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
  if (col) { _c.setRGB(col[0], col[1], col[2]); mesh.setColorAt(i, _c); }
}
// A gun or vehicle model. An MG nest is two models: the bags face the battle centre and do not turn; the gun turns.
function model(kind: string, x: number, y: number, h: number, s: number, hd: number, col: number[], sy = s) {
  const m = mModel[kind]; if (!m || nModel[kind] >= 400) return;
  setI(m, nModel[kind]++, x, y, h, s, sy, s, hd, col);
  if (kind === 'mg' && nModel.mgBase < 400) setI(mModel.mgBase, nModel.mgBase++, x, y, h, s, sy, s, Math.atan2(-(H / 2 - y), W / 2 - x), col);
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
// Trenches are dug into the ground. The ground of each trench cell drops to the trench floor, earth walls close the
// sides that face open ground, and the dug earth lies as a bank with sandbags along those sides.
// Men in a trench are drawn lower, so only their heads and shoulders show. This is drawing only: the battle rules
// for trenches do not change.
export const TRENCH_D = .95;
const dug = new Uint8Array(GW * GH); let dugKey = '';
export const inTrench = (x: number, y: number) => { const ci = cellOf(x, y); return ci >= 0 && dug[ci] === 1; };
function digTrenches(list: any[]) {
  if (!terrGeo || !terrY0) return;
  const key = list.map(s => s.id).join(','); if (key === dugKey) return; dugKey = key;
  dug.fill(0); for (const s of list) for (const ci of s.cells) if (M.terr[ci] !== T_BUILD) dug[ci] = 1;
  const pos = terrGeo.attributes.position as THREE.BufferAttribute;
  for (let ci = 0; ci < GW * GH; ci++) for (let v = 0; v < 6; v++) pos.setY(ci * 6 + v, terrY0[ci * 6 + v] - (dug[ci] ? TRENCH_D : 0));
  pos.needsUpdate = true; terrGeo.computeVertexNormals();
  // Earth walls on the open sides, and a bank with sandbags outside each of them.
  const VW = GW + 1, TH = M.TH, P: number[] = [], Cc: number[] = []; let nt = 0, nb = 0;
  const quad = (a: number[], b: number[], c: number[], d: number[], col: number[]) => { for (const q of [a, b, c, a, c, d]) { P.push(q[0] - W / 2, q[1], q[2] - H / 2); Cc.push(col[0], col[1], col[2]); } };
  for (let ci = 0; ci < GW * GH; ci++) {
    if (!dug[ci]) continue; const i = ci % GW, j = (ci / GW) | 0, x = i * C + 1, y = j * C + 1;
    setI(mTrench, nt++, x, y, M.hAt(x, y) - TRENCH_D, 1, 1, 1, 0);
    // Each side: its two corners, the cell beyond it, and the way out.
    const sides: [number, number, number, number, number, number][] = [[i, j, i + 1, j, 0, -1], [i + 1, j, i + 1, j + 1, 1, 0], [i + 1, j + 1, i, j + 1, 0, 1], [i, j + 1, i, j, -1, 0]];
    for (const [ai, aj, bi, bj, ox, oy] of sides) {
      const ni = i + ox, nj = j + oy; if (ni >= 0 && nj >= 0 && ni < GW && nj < GH && dug[nj * GW + ni]) continue;
      const ha = TH[aj * VW + ai], hb = TH[bj * VW + bi], shade = ox + oy > 0 ? .8 : 1, col = [.33 * shade, .26 * shade, .18 * shade];
      quad([ai * C, ha, aj * C], [bi * C, hb, bj * C], [bi * C, hb - TRENCH_D, bj * C], [ai * C, ha - TRENCH_D, aj * C], col);
      // Plank revetment along the wall, a little lighter.
      const pc = [.42 * shade, .33 * shade, .22 * shade], t0 = .35, t1 = .55;
      quad([ai * C, ha - t0, aj * C], [bi * C, hb - t0, bj * C], [bi * C, hb - t1, bj * C], [ai * C, ha - t1, aj * C], pc);
      if (nb < 8000 && !(ni >= 0 && nj >= 0 && ni < GW && nj < GH && M.terr[nj * GW + ni] === T_BUILD)) {
        const mx = (ai + bi) / 2 * C + ox * .45, my = (aj + bj) / 2 * C + oy * .45;
        setI(mBank, nb++, mx, my, M.hAt(mx, my) - .05, 1, 1, 1, Math.atan2(ox, oy));
      }
    }
  }
  done(mTrench, nt); done(mBank, nb);
  if (pitMesh) { scene.remove(pitMesh); pitMesh.geometry.dispose(); pitMesh = null; }
  if (P.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.computeVertexNormals();
    pitMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); pitMesh.receiveShadow = true; scene.add(pitMesh);
  }
}
function updateStructs(V: View) {
  const vis = S.structs.filter((s: any) => visibleStruct(s, V)); const key = vis.map((s: any) => s.id).join(',') + S.phase; if (key === structKey) return; structKey = key;
  let nt = 0, nl = 0, ns = 0, nw = 0, nwl = 0, nk = 0;
  for (const s of vis) {
    const yaw = Math.atan2(-(s.b.y - s.a.y), s.b.x - s.a.x);
    for (const ci of s.cells) {
      const x = (ci % GW) * C + 1, y = Math.floor(ci / GW) * C + 1, h = M.hAt(x, y);
      if (s.type === 'trench') continue;
      else if (s.type === 'sandbag') setI(mSand, ns++, x, y, h, 1.05, 1.1, 1.3, yaw);
      else if (s.type === 'wire') setI(mWire, nw++, x, y, h, 1.05, 1, 1, yaw);
      else if (s.type === 'tanktrap') setI(mTrap, nk++, x, y, h, 1, 1, 1, yaw + (nk % 3) * .5);
      else setI(mWall, nwl++, x, y, h, 1, 1, 1, 0);
    }
  }
  done(mTrap, nk); done(mSand, ns); done(mWire, nw); done(mWall, nwl);
  digTrenches(vis.filter((s: any) => s.type === 'trench'));
}

// Soldier figures. The battle data has no animation state; the renderer keeps a little for each man:
// where it drew him, his heading, his stride and his pose. The battle data itself stays plain.
interface Anim { x: number; y: number; px: number; py: number; hd: number; ph: number; spd: number; pr: number; die: number; alive: boolean; ox: number; oy: number }
// Men are drawn a little apart from each other and clear of walls. This moves only the figure, never the unit.
// The places of the men drawn in the last frame (x, y, unit number), in buckets of one cell.
let crowd = new Map<number, number[]>(), crowdNext = new Map<number, number[]>();
const CLEAR = .55, APART = .75;
function nudgeOut(x: number, y: number, self: number, out: number[]) {
  let fx = 0, fy = 0; const cx = Math.floor(x / C), cy = Math.floor(y / C);
  // Other men close by push apart.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const b = crowd.get((cy + dy) * GW + cx + dx); if (!b) continue;
    for (let i = 0; i < b.length; i += 3) { if (b[i + 2] === self) continue; const ex = x - b[i], ey = y - b[i + 1], d = Math.hypot(ex, ey); if (d > 1e-3 && d < APART) { fx += ex / d * (APART - d) * .5; fy += ey / d * (APART - d) * .5; } }
  }
  // Walls push out: a man inside an outline or closer than CLEAR to it moves out to CLEAR.
  let seen = -2;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cx + dx, iy = cy + dy; if (ix < 0 || iy < 0 || ix >= GW || iy >= GH) continue; const id = M.bldId[iy * GW + ix];
    if (id < 0 || id === seen) continue; seen = id; const b: any = M.B[id]; if (!b || b.down != null) continue; const P = b.p as number[][];
    let ins = false, bd = 1e9, qx = 0, qy = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a0 = P[j], a1 = P[i]; if ((a1[1] > y) !== (a0[1] > y) && x < (a0[0] - a1[0]) * (y - a1[1]) / (a0[1] - a1[1]) + a1[0]) ins = !ins;
      const ex = a1[0] - a0[0], ey = a1[1] - a0[1], L = ex * ex + ey * ey || 1, t = clamp(((x - a0[0]) * ex + (y - a0[1]) * ey) / L, 0, 1), px = a0[0] + ex * t, py = a0[1] + ey * t, d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; qx = px; qy = py; }
    }
    if (bd > CLEAR && !ins) continue;
    let nx = x - qx, ny = y - qy; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; if (ins) { nx = -nx; ny = -ny; }
    const need = ins ? bd + CLEAR : CLEAR - bd; fx += nx * need; fy += ny * need;
  }
  const m = Math.hypot(fx, fy); if (m > 1.2) { fx *= 1.2 / m; fy *= 1.2 / m; }
  out[0] = fx; out[1] = fy;
}
const _push = [0, 0];
const ANIM = new WeakMap<any, Anim>();
// Radians of stride for each map unit walked, so the feet keep pace with the ground and do not slide.
const STRIDE = Math.PI * 2 / 1.55;
let nm = 0, nl = 0, nPr = 0, nd = 0, lastAnimT = 0;
// The battle runs in fixed ticks. Before each tick the main loop keeps where each man stood (snapUnits).
// After the ticks it gives the part of the next tick that has gone by (interp.a). Men are drawn between the two places.
export const interp = { a: 1, on: false };
export function snapUnits() { for (const u of S.units) { const a = ANIM.get(u); if (a) { a.px = u.x; a.py = u.y; } } }
interface Pose { swing: number; kneeL: number; kneeR: number; bob: number; lean: number; fall: number; kick: number }
const IDLE: Pose = { swing: 0, kneeL: -.05, kneeR: -.05, bob: 0, lean: 0, fall: 0, kick: 0 }, P: Pose = { ...IDLE };
const _B = new THREE.Matrix4(), _H = new THREE.Matrix4(), _L = new THREE.Matrix4(), _X = new THREE.Matrix4(), _Y = new THREE.Matrix4(), _cc = new THREE.Color();
const HIP = .52, THIGH = .25;
// One man from his parts: the body, then each leg as a thigh from the hip and a shin from the knee.
function drawMan(x: number, y: number, h: number, yaw: number, col: number[], p: Pose) {
  if (nm >= 5000 || nl + 2 > 10000) return;
  _q.setFromAxisAngle(_up, yaw); _p.set(x - W / 2, h, y - H / 2); _s.set(1.25, 1.25, 1.25); _B.compose(_p, _q, _s);
  // A falling man turns forward round his feet.
  if (p.fall) _B.multiply(_X.makeRotationZ(-p.fall));
  _cc.setRGB(col[0], col[1], col[2]);
  // The body turns forward round the hips when the man leans.
  _H.copy(_B).multiply(_X.makeTranslation(p.kick, HIP + p.bob, 0)).multiply(_Y.makeRotationZ(-p.lean)).multiply(_X.makeTranslation(0, -HIP, 0));
  mSoldier.setMatrixAt(nm, _H); mSoldier.setColorAt(nm++, _cc);
  for (const [side, sw, knee] of [[1, p.swing, p.kneeL], [-1, -p.swing, p.kneeR]]) {
    _L.copy(_B).multiply(_X.makeTranslation(0, HIP + p.bob, side * .085)).multiply(_Y.makeRotationZ(sw));
    mThigh.setMatrixAt(nl, _L); mThigh.setColorAt(nl, _cc);
    _L.multiply(_X.makeTranslation(0, -THIGH, 0)).multiply(_Y.makeRotationZ(knee));
    mShin.setMatrixAt(nl, _L); mShin.setColorAt(nl++, _cc);
  }
}
// Where a man in a building stands: on the roof, on the slope of a pitched roof as the roof is drawn.
export function roofH(x: number, y: number) {
  const h = unitH(x, y), ci = cellOf(x, y); if (ci < 0) return h; const id = M.bldId[ci], b: any = id >= 0 ? M.B[id] : null;
  if (!b || !b.hip || b.down != null) return h; const r = b.hip, l = x * r.lx + y * r.ly, s = x * r.sx + y * r.sy;
  const k = Math.min(1 - Math.abs(s - r.sm) / r.hs, (l - r.l0) / Math.max(.01, r.inset), (r.l1 - l) / Math.max(.01, r.inset));
  return h + r.rh * clamp(k, 0, 1);
}
export function update3D(V: View) {
  const plan = S.phase === 'plan';
  const up = ptUnits.geometry.attributes.position.array, uc = ptUnits.geometry.attributes.color.array;
  const bp = ptBodies.geometry.attributes.position.array, bc = ptBodies.geometry.attributes.color.array;
  const gp = ptGhosts.geometry.attributes.position.array, gc = ptGhosts.geometry.attributes.color.array;
  let n = 0, nb = 0, ng = 0;
  const putU = (x: number, y: number, h: number, c: number[], dim: number) => { if (n >= 5000) return; up[n * 3] = x - W / 2; up[n * 3 + 1] = h; up[n * 3 + 2] = y - H / 2; uc[n * 3] = c[0] * dim; uc[n * 3 + 1] = c[1] * dim; uc[n * 3 + 2] = c[2] * dim; n++; };
  // Zoomed in, soldiers are small figures; zoomed out (or in x-ray) they are dots, so they never get lost.
  const ppu = view.ch / 2 / (cam.dist * Math.tan(FOV / 2 * Math.PI / 180)), figures = (ppu > 3.2 || fpv.on) && !viewOpts.xray; nm = nl = nPr = nd = 0; { const t = crowd; crowd = crowdNext; crowdNext = t; crowdNext.clear(); }
  const tint = (c: number[], dim: number) => [Math.min(1, c[0] * dim * 1.2 + .08), Math.min(1, c[1] * dim * 1.2 + .08), Math.min(1, c[2] * dim * 1.2 + .08)];
  // A man who stands still (placed units, previews): no state, only the idle pose.
  const man = (u: any, h: number, c: number[], dim: number) => {
    if (!figures || nm >= 5000) { putU(u.x, u.y, h + .9, c, dim); return; }
    drawMan(u.x, u.y, h, u.hd || 0, tint(c, dim), IDLE);
  };
  // A man in the battle: drawn where he is between two ticks, turning smoothly, with legs that keep pace with the ground.
  const live = S.phase === 'battle' && NET.mode !== 'guest' && interp.on, guest = NET.mode === 'guest', rNow = performance.now() / 1000, fdt = Math.min(.1, rNow - (lastAnimT || rNow)); lastAnimT = rNow;
  const actor = (u: any) => {
    let a = ANIM.get(u); const fresh = !a;
    if (!a) { a = { x: u.x, y: u.y, px: u.x, py: u.y, hd: u.hd || 0, ph: (u.i * 1.7) % 6.28, spd: 0, pr: 0, die: -1, alive: !!u.alive, ox: 0, oy: 0 }; ANIM.set(u, a); }
    let tx = u.x, ty = u.y;
    if (live) { tx = a.px + (u.x - a.px) * interp.a; ty = a.py + (u.y - a.py) * interp.a; }
    const jump = Math.hypot(tx - a.x, ty - a.y);
    // A guest gets the host's positions ten times a second: ease toward them.
    let nx = tx, ny = ty; if (guest && jump < 8) { const k = Math.min(1, fdt * 10); nx = a.x + (tx - a.x) * k; ny = a.y + (ty - a.y) * k; }
    const d = fresh || jump > 8 ? 0 : Math.hypot(nx - a.x, ny - a.y); a.x = nx; a.y = ny;
    if (fdt > 0) a.spd += (d / fdt - a.spd) * Math.min(1, fdt * 8);
    a.ph += d * STRIDE;
    let dh = (u.hd || 0) - a.hd; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); a.hd += fresh ? dh : Math.sign(dh) * Math.min(Math.abs(dh), fdt * 9);
    const prone = (u.sup || 0) > .75 && a.spd < .3; a.pr = clamp(a.pr + (prone ? 1 : -1) * fdt * 3, 0, 1);
    if (!u.alive) { if (a.alive && !fresh) a.die = rNow; a.alive = false; } else { a.alive = true; a.die = -1; }
    return a;
  };
  const soldier = (u: any, c: number[], dim: number, drop: number) => {
    const a = actor(u);
    // Figures only: ease the drawn place away from walls and from other men. Men on roofs stay where they are.
    if (figures && !u.gar) { nudgeOut(a.x + a.ox, a.y + a.oy, u.i, _push); const k = Math.min(1, fdt * 6); a.ox = a.ox * (1 - k * .25) + _push[0] * k; a.oy = a.oy * (1 - k * .25) + _push[1] * k; const m = Math.hypot(a.ox, a.oy); if (m > 1.2) { a.ox *= 1.2 / m; a.oy *= 1.2 / m; } }
    else { a.ox = a.oy = 0; }
    const x = a.x + a.ox, y = a.y + a.oy, h = (u.gar ? roofH(x, y) : unitH(x, y) - (inTrench(x, y) ? TRENCH_D - .05 : 0)) + drop;
    if (figures) { const key = Math.floor(y / C) * GW + Math.floor(x / C); let b = crowdNext.get(key); if (!b) crowdNext.set(key, b = []); b.push(x, y, u.i); }
    if (!figures || nm >= 5000) { putU(a.x, a.y, h + .9, c, dim); return; }
    const col = tint(c, dim);
    // Pinned down: the man lies flat.
    if (a.pr >= .55) { if (nPr < 5000) setI(mProne, nPr++, x, y, h, 1.25, 1.25, 1.25, a.hd, col); return; }
    // Walk to run: longer strides and more lean as the man goes faster. Still: a slow breath.
    const w = clamp(a.spd / .6, 0, 1), run = clamp((a.spd - 1.6) / 1.5, 0, 1), amp = (.5 + run * .3) * w, sn = Math.sin(a.ph), cs = Math.cos(a.ph);
    P.swing = sn * amp; P.kneeL = -Math.max(0, cs) * (.9 + run * .5) * w - .05; P.kneeR = -Math.max(0, -cs) * (.9 + run * .5) * w - .05;
    P.bob = (Math.cos(P.swing) - 1) * .4 + Math.abs(cs) * .03 * w + (1 - w) * Math.sin(rNow * 1.9 + u.i) * .006;
    P.lean = .1 * w + .15 * run + a.pr * .9; P.fall = 0;
    // The rifle kicks back a little at each shot.
    P.kick = live && u.fired != null && S.t - u.fired < .12 ? -.05 : 0;
    drawMan(x, y, h, a.hd, col, P);
  };
  // A man who is hit falls forward, then lies still.
  const fallen = (u: any) => {
    const a = actor(u), h = unitH(a.x, a.y) - (inTrench(a.x, a.y) ? TRENCH_D - .05 : 0), yaw = a.die >= 0 || a.spd > 0 ? a.hd : (u.hd || 0) + u.i * .7;
    const t = a.die >= 0 ? (rNow - a.die) / .45 : 1;
    if (t < 1) { Object.assign(P, IDLE); P.fall = t * t * 1.5; drawMan(a.x, a.y, h, yaw, [.72, .72, .7], P); return; }
    if (nd < 5000) setI(mBody, nd++, a.x, a.y, h, 1.25, 1.25, 1.25, yaw);
  };
  // Team tint over the model's own colours: a light wash of the team colour.
  for (const k in mModel) nModel[k] = 0;
  const emp = (kind: string, x: number, y: number, c: number[], hd: number) => model(kind, x, y, unitH(x, y), 1.6, hd || 0, [.62 + c[0] * .5, .62 + c[1] * .5, .62 + c[2] * .5]);
  // While planning, your soldiers that already have orders turn grey, so the ones still waiting stand out.
  const ORDERED = [.58, .6, .64], hasOrder = (q: any) => q && (q.order || ['attack', 'move', 'suppress', 'follow'].includes(q.state));
  for (const u of V.units) {
    const c = plan && u.team === NET.me && !MODEL_KINDS.has(u.kind) && hasOrder(u.sqo) ? ORDERED : TRGB[sw(u.team)];
    if (u.alive) {
      if (u.team !== NET.me && V.fogOn && !V.isVis(u)) continue;
      if (MODEL_KINDS.has(u.kind)) { emp(u.kind, u.x, u.y, c, u.hd); if (!figures) putU(u.x, u.y, unitH(u.x, u.y) + .9, c, 1); }
      else soldier(u, c, 1, u.drop > 0 ? u.drop * 14 : 0);
    } else if (nb < 5000) {
      if (u.team !== NET.me && V.fogOn && !cellSeen(V.seen, u.x, u.y)) continue;
      if (figures && !MODEL_KINDS.has(u.kind)) fallen(u);
      else { bp[nb * 3] = u.x - W / 2; bp[nb * 3 + 1] = unitH(u.x, u.y) + .2; bp[nb * 3 + 2] = u.y - H / 2; bc[nb * 3] = .42; bc[nb * 3 + 1] = .42; bc[nb * 3 + 2] = .4; nb++; } // the dead: grey
      // Wrecked guns and tanks stay where they fell, burnt dark.
      if (MODEL_KINDS.has(u.kind)) model(u.kind, u.x, u.y, unitH(u.x, u.y) - .15, 1.6, (u.hd || 0) + .3, [.22, .2, .18], 1.3);
    }
  }
  if (plan) for (const s of S.squads) {
    if (s.members || s.team !== NET.me) continue; const c = s.order && !MODEL_KINDS.has(s.kind) ? ORDERED : TRGB[0];
    const hd0 = Math.atan2(-(H / 2 - s.pos[0][1]), W / 2 - s.pos[0][0]);
    for (const p of s.pos) { if (MODEL_KINDS.has(s.kind)) putU(p[0], p[1], unitH(p[0], p[1]) + .9, c, .75); else man({ x: p[0], y: p[1], hd: hd0 }, s.kind === 'garrison' ? roofH(p[0], p[1]) : unitH(p[0], p[1]), c, .75); }
    if (MODEL_KINDS.has(s.kind)) emp(s.kind, s.pos[0][0], s.pos[0][1], c, Math.atan2(-(H / 2 - s.pos[0][1]), W / 2 - s.pos[0][0]));
  }
  // Previews while planning: the unit you are about to place, or where the selected units will stand.
  const hv = input.hover, tl = TOOLDEF[S.tool];
  if (plan && hv && !input.ptr && tl) {
    const ghost = (kind: string, x: number, y: number, c: number[], hd: number) => {
      const uk = unitKind(kind);
      if (MODEL_KINDS.has(uk)) { model(uk, x, y, unitH(x, y), 1.6, hd, c); return; }
      const n = PLATOON_SIZE[kind] || 1, fx = Math.cos(-hd), fy = Math.sin(-hd);
      // Men never stand in a building or in water: each one goes to the nearest open cell, as they will when they get there.
      for (let i = 0; i < n; i++) { const col = (i % 4 - 1.5) * 2.3, row = (Math.floor(i / 4) - 1.5) * 2.3, q = nudge(x - fy * col - fx * row, y + fx * col - fy * row); if (q) man({ x: q[0], y: q[1], hd }, unitH(q[0], q[1]), c, 1); }
    };
    const toMid = Math.atan2(-(H / 2 - hv.y), W / 2 - hv.x);
    if ((tl.mode === 'point' || tl.mode === 'aim') && K[unitKind(S.tool)] && S.tool !== 'garrison') {
      // The preview stands where the unit will really go: moved aside if another unit is in the way.
      // A platoon shows each man where he will stand (the same layout the placement uses).
      const L = squadLayout(NET.me, S.tool, hv.x, hv.y), ok = !!L && left(NET.me) >= COST[S.tool], gc = ok ? [.55, 1, .65] : [1, .4, .36];
      if (L && PLATOON_SIZE[S.tool]) for (const q of L.pos) man({ x: q[0], y: q[1], hd: toMid }, unitH(q[0], q[1]), gc, 1);
      else { const q = L ? L.p : placeSpot(NET.me, S.tool, hv.x, hv.y); ghost(S.tool, q ? q[0] : hv.x, q ? q[1] : hv.y, gc, toMid); }
    } else if (S.tool === 'move' || S.tool === 'attack' || S.tool === 'defend') {
      const sel = (S.selMany || []).filter((s: any) => s.team === NET.me && MOVERS.includes(s.kind)); let gx = 0, gy = 0, k = 0;
      for (const s of sel) { gx += s.x; gy += s.y; k++; }
      if (k) { const a = Math.atan2(hv.y - gy / k, hv.x - gx / k), dx = Math.cos(a), dy = Math.sin(a); sel.forEach((s: any, j: number) => {
        const off = (j - (k - 1) / 2) * 11, tx = hv.x - dy * off, ty = hv.y + dx * off, uk = unitKind(s.kind);
        if (MODEL_KINDS.has(uk)) { ghost(s.kind, tx, ty, [.5, .78, 1], -a); return; }
        // Each man where he will stand: the same spots the battle gives him (in line, or in the cover round the point).
        const n = s.members ? s.members.filter((i: number) => S.units[i].alive).length : (s.pos ? s.pos.length : PLATOON_SIZE[s.kind] || 1);
        for (const q of orderSpots(S.tool, tx, ty, a, n, uk === 'tank')) man({ x: q[0], y: q[1], hd: -a }, unitH(q[0], q[1]), [.5, .78, 1], 1);
      }); }
    }
  }
  // Last known enemy positions, shown faded.
  for (const g of V.ghosts) { if (ng >= 3000) break; const c = TRGB[sw(g.team)]; gp[ng * 3] = g.x - W / 2; gp[ng * 3 + 1] = unitH(g.x, g.y) + .9; gp[ng * 3 + 2] = g.y - H / 2; gc[ng * 3] = c[0]; gc[ng * 3 + 1] = c[1]; gc[ng * 3 + 2] = c[2]; ng++; }
  done(mSoldier, nm); done(mThigh, nl); done(mShin, nl); done(mProne, nPr); done(mBody, nd);
  for (const [p, c] of [[ptUnits, n], [ptBodies, nb], [ptGhosts, ng]] as [any, number][]) { p.geometry.setDrawRange(0, c); p.geometry.attributes.position.needsUpdate = true; p.geometry.attributes.color.needsUpdate = true; }
  // Each HQ: a bunker with a flag in the team colour. Enemy HQs show once your side has found them.
  for (const t of S.teams) {
    if (t.id !== NET.me && V.fogOn && !(S.hqKnown && S.hqKnown[NET.me] && S.hqKnown[NET.me].has(t.id))) continue;
    const x = t.zone.x, y = t.zone.y, h = M.hAt(x, y), fc = TRGB[sw(t.lost && t.hqBy >= 0 ? t.hqBy : t.id)];
    // The flag streams out from the top of the pole and sways a little.
    const sway = Math.sin(performance.now() / 700 + t.id) * .25;
    setI(mModel.hq, nModel.hq++, x, y, h, 1, 1, 1, 0, [1, 1, 1]);
    setI(mModel.flag, nModel.flag++, x, y, h + 11.4, 1, 1, 1, .4 + sway, fc);
  }
  for (const k in mModel) done(mModel[k], nModel[k]);
  ptUnits.material.size = clamp(ppu * 1.1, 2.5, 7); ptBodies.material.size = clamp(ppu * 1, 2, 6); ptGhosts.material.size = clamp(ppu * 1.1, 2.5, 7); ptHeads.material.size = clamp(ppu * 1.2, 2.5, 6);

  const lp = lineG.attributes.position.array, lc = lineG.attributes.color.array; let L = 0;
  const seg = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, c: number[], c2?: number[]) => {
    if (L >= LMAX) return; const o = L * 6; lp[o] = x0 - W / 2; lp[o + 1] = h0; lp[o + 2] = y0 - H / 2; lp[o + 3] = x1 - W / 2; lp[o + 4] = h1; lp[o + 5] = y1 - H / 2;
    lc[o] = c[0]; lc[o + 1] = c[1]; lc[o + 2] = c[2]; const d = c2 || c; lc[o + 3] = d[0]; lc[o + 4] = d[1]; lc[o + 5] = d[2]; L++;
  };
  for (const t of V.tracers) {
    if (V.fogOn && t.team !== NET.me && !cellSeen(V.vis, t.x0, t.y0) && !cellSeen(V.vis, t.x1, t.y1)) continue;
    const c = TRGB[sw(t.team)]; seg(t.x0, t.y0, unitH(t.x0, t.y0) + 1.2, t.x1, t.y1, unitH(t.x1, t.y1) + 1, [c[0] * .6 + .4, c[1] * .6 + .4, c[2] * .6 + .4]);
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
  let ns = 0; const tNow = V.replayT ?? S.t;
  for (const m of V.smokes || []) { const r = smokeR(m, tNow); if (r <= 0) continue; for (let k = 0; k < 6 && ns < 400; k++) { const a = k * 1.05 + m.x, d = r * .45 * (k % 3) / 2, s = r * (.55 + (k % 2) * .2); setI(mSmoke, ns++, m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, unitH(m.x, m.y) + s * .45, s, s * .7, s, 0, [1, 1, 1]); } }
  done(mSmoke, ns);
  let nf = 0; for (const f of V.fx) { if (nf >= 300) break; const k = 1 - f.life / f.max, s = f.r * (.35 + k * .8), fade = 1 - k; setI(mBoom, nf++, f.x, f.y, unitH(f.x, f.y) + s * .5, s, s * .8, s, 0, [fade, fade * (.75 - k * .4), fade * (.45 - k * .4)]); } done(mBoom, nf);
  let nc = 0; for (const c of V.craters) { if (nc >= 700) break; setI(mCrater, nc++, c.x, c.y, M.hAt(c.x, c.y) + .06, c.r, 1, c.r, 0); } done(mCrater, nc);
  for (const br of M.bridges) if (br.group) br.group.visible = !(br.blown != null && (S.phase !== 'replay' || br.blown <= S.rt));
  updateStructs(V); updateDowns();
}
export function render() { const t = performance.now() / 1000; stepFog(clamp(t - timeU.value, 0, .1)); timeU.value = t; renderer.render(scene, camera); }

export const THREE_ = THREE; // developer checks only
