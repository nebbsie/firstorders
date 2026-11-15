import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small low-poly models built from boxes and cylinders. Each model faces +x and stands on y = 0.
// Parts carry their own colours; the team colour tints the whole model per instance.
type Part = [THREE.BufferGeometry, string, number[], number[]?];
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cyl = (r0: number, r1: number, h: number, s = 7) => new THREE.CylinderGeometry(r0, r1, h, s);
const OLIVE = '#7d7f5c', DARK = '#3b3c33', STEEL = '#5d6066', SAND = '#b8a57c', CONC = '#8a877c';

function build(parts: Part[]) {
  const list = parts.map(([g, col, pos, rot]) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]) as [number, number, number])), new THREE.Vector3(1, 1, 1));
    const geo = (g.index ? g.toNonIndexed() : g).applyMatrix4(m), c = new THREE.Color(col), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); geo.deleteAttribute('uv'); return geo;
  });
  const merged = mergeGeometries(list); merged.computeVertexNormals(); return merged;
}
function sandRing(r: number, n: number, h = .5): Part[] {
  const out: Part[] = [];
  for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; if (Math.abs(a) < .5) continue; out.push([box(.9, h, .45), SAND, [Math.cos(a) * r, h / 2, Math.sin(a) * r], [0, -a + Math.PI / 2, 0]]); }
  return out;
}
THREE.ColorManagement.enabled = false;
export const MODELS: Record<string, THREE.BufferGeometry> = {
  mortar: build([
    [cyl(.55, .6, .12), STEEL, [0, .06, 0]],
    [cyl(.12, .14, 1.7), DARK, [.35, .75, 0], [0, 0, -.75]],
    [box(.08, 1.1, .08), DARK, [.75, .5, .3], [.35, 0, -.25]], [box(.08, 1.1, .08), DARK, [.75, .5, -.3], [-.35, 0, -.25]],
    ...sandRing(1.4, 9, .45),
  ]),
  mg: build([
    ...sandRing(1.3, 10, .55),
    [box(.6, .28, .28), DARK, [0, .8, 0]], [box(1.5, .12, .12), DARK, [.95, .82, 0]],
    [box(.07, .8, .07), STEEL, [.2, .4, .25], [.4, 0, 0]], [box(.07, .8, .07), STEEL, [.2, .4, -.25], [-.4, 0, 0]], [box(.07, .8, .07), STEEL, [-.2, .4, 0], [0, 0, .4]],
  ]),
  at: build([
    [box(.12, 1, 1.5), OLIVE, [.35, .75, 0]],
    [cyl(.09, .1, 2.6), DARK, [1.55, .8, 0], [0, 0, -Math.PI / 2]],
    [cyl(.42, .42, .22, 9), DARK, [0, .42, .7], [Math.PI / 2, 0, 0]], [cyl(.42, .42, .22, 9), DARK, [0, .42, -.7], [Math.PI / 2, 0, 0]],
    [box(1.8, .12, .12), OLIVE, [-1, .25, .35], [0, -.2, 0]], [box(1.8, .12, .12), OLIVE, [-1, .25, -.35], [0, .2, 0]],
  ]),
  tank: build([
    [box(3.6, .7, .55), DARK, [0, .4, 1.05]], [box(3.6, .7, .55), DARK, [0, .4, -1.05]],
    [box(3.3, .7, 1.6), OLIVE, [0, .85, 0]], [box(.6, .4, 1.6), OLIVE, [1.75, .7, 0], [0, 0, -.5]],
    [box(1.7, .6, 1.4), OLIVE, [-.2, 1.5, 0]], [cyl(.25, .25, .25, 8), OLIVE, [-.5, 1.9, .3]],
    [cyl(.1, .12, 2.6), DARK, [1.9, 1.55, 0], [0, 0, -Math.PI / 2]],
  ]),
  op: build([
    [box(.15, 3.8, .15), STEEL, [.7, 1.9, .7]], [box(.15, 3.8, .15), STEEL, [-.7, 1.9, .7]], [box(.15, 3.8, .15), STEEL, [.7, 1.9, -.7]], [box(.15, 3.8, .15), STEEL, [-.7, 1.9, -.7]],
    [box(1.9, .15, 1.9), CONC, [0, 3.8, 0]], [box(1.9, .5, .08), SAND, [0, 4.1, .95]], [box(1.9, .5, .08), SAND, [0, 4.1, -.95]], [box(.08, .5, 1.9), SAND, [.95, 4.1, 0]],
    [box(2.2, .12, 2.2), OLIVE, [0, 4.9, 0]], [box(.1, .7, .1), STEEL, [.9, 4.5, .9]], [box(.1, .7, .1), STEEL, [-.9, 4.5, -.9]],
  ]),
  hq: build([
    [box(6, 1.6, 5), CONC, [0, .8, 0]], [box(6.6, .35, 5.6), '#6f6c63', [0, 1.75, 0]], [box(.8, .9, 1.4), DARK, [3.05, .45, 0]],
    ...sandRing(4.6, 18, .7),
    [box(.2, 9, .2), '#d0cfc8', [2.4, 4.5, 1.8]],
  ]),
  flag: build([[box(2.8, 1.7, .12), '#ffffff', [1.4, 0, 0]]]),
};
