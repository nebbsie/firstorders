import * as THREE from 'three';
import { W, H, CX, CY, PLAY_R, clamp } from '../config';
import { unitH } from '../world';

export const FOV = 38;
export const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 3000);
export const cam = { tx: W / 2, ty: H / 2, dist: 330, yaw: 0, pitch: .95, userMoved: false };
export const view = { cw: 1, ch: 1, dpr: 1 };

export function applyCam() {
  const tx = cam.tx - W / 2, tz = cam.ty - H / 2, th = 8, cp = Math.cos(cam.pitch);
  camera.position.set(tx + Math.sin(cam.yaw) * cp * cam.dist, th + Math.sin(cam.pitch) * cam.dist, tz + Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(tx, th, tz);
}
export function fit() {
  const t = Math.tan(FOV / 2 * Math.PI / 180), asp = view.cw / Math.max(1, view.ch);
  cam.tx = CX; cam.ty = CY + 8; cam.yaw = 0; cam.pitch = .95;
  cam.dist = clamp(Math.max(PLAY_R * 2 / (2 * t * asp), PLAY_R * 2 * .8 / (2 * t)) * 1.15, 120, 900);
}
export function panBy(dx: number, dy: number) {
  const s = 2 * cam.dist * Math.tan(FOV / 2 * Math.PI / 180) / view.ch, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), f = 1 / Math.max(.5, Math.sin(cam.pitch));
  cam.tx = clamp(cam.tx - cy * dx * s - sy * dy * s * f, CX - PLAY_R - 60, CX + PLAY_R + 60);
  cam.ty = clamp(cam.ty + sy * dx * s - cy * dy * s * f, CY - PLAY_R - 60, CY + PLAY_R + 60);
}
const _v = new THREE.Vector3();
// World point (map units) to screen pixels; far off screen when behind the camera.
export function P(x: number, y: number, dz = 0): [number, number] {
  _v.set(x - W / 2, unitH(x, y) + dz, y - H / 2).project(camera);
  if (_v.z > 1) return [-1e4, -1e4];
  return [(_v.x + 1) / 2 * view.cw, (1 - _v.y) / 2 * view.ch];
}
// World point at a fixed height (not following roofs) to screen pixels.
export function Pa(x: number, y: number, h: number): [number, number] {
  _v.set(x - W / 2, h, y - H / 2).project(camera);
  if (_v.z > 1) return [-1e4, -1e4];
  return [(_v.x + 1) / 2 * view.cw, (1 - _v.y) / 2 * view.ch];
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// Screen pixel to the first ground, roof or bridge it hits.
export function pick(sx: number, sy: number) {
  ndc.set(sx / view.cw * 2 - 1, -(sy / view.ch) * 2 + 1); ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  const hh = (t: number) => { const x = o.x + d.x * t + W / 2, y = o.z + d.z * t + H / 2; return (x >= 0 && y >= 0 && x <= W && y <= H) ? unitH(x, y) : -1.2; };
  let prev = 0;
  for (let t = 0; t < 3000; t += 2) {
    if (o.y + d.y * t <= hh(t)) {
      let lo = prev, hi = t; for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= hh(m)) hi = m; else lo = m; }
      return { x: o.x + d.x * hi + W / 2, y: o.z + d.z * hi + H / 2, sx, sy };
    }
    prev = t;
  }
  return null;
}
