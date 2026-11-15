import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small low-poly models built from boxes and cylinders. Each model faces +x and stands on y = 0.
// Parts carry their own colours; the team colour tints the whole model per instance.
type Part = [THREE.BufferGeometry, string, number[], number[]?];
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cyl = (r0: number, r1: number, h: number, s = 7) => new THREE.CylinderGeometry(r0, r1, h, s);
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s);
const OLIVE = '#7d7f5c', OLIVE2 = '#6c6f4d', RUBBER = '#2a2b26', DARK = '#3b3c33', STEEL = '#5d6066', SAND = '#b8a57c', CONC = '#8a877c';

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
  // Tank: tracks with road wheels, a sloped front, engine deck, and a turret with a long gun.
  tank: build([
    ...[1, -1].flatMap(z => [
      [box(3.7, .5, .5), DARK, [0, .34, z * 1.02]] as Part,
      ...[-1.5, -.75, 0, .75, 1.5].map(x => [cyl(.27, .27, .56, 9), RUBBER, [x, .28, z * 1.02], [Math.PI / 2, 0, 0]] as Part),
      [box(3.5, .08, .62), OLIVE2, [0, .66, z * 1.02]] as Part,
    ]),
    [box(3.3, .5, 1.5), OLIVE, [0, .72, 0]], [box(.95, .12, 1.5), OLIVE2, [1.5, .98, 0], [0, 0, -.5]],
    [box(2.5, .34, 1.72), OLIVE, [-.3, 1.12, 0]], [box(1, .1, 1.3), OLIVE2, [-1.25, 1.33, 0]],
    [cyl(.07, .07, .5, 6), DARK, [-1.85, 1.1, .5], [0, 0, Math.PI / 2]], [cyl(.07, .07, .5, 6), DARK, [-1.85, 1.1, -.5], [0, 0, Math.PI / 2]],
    [box(1.45, .52, 1.2), OLIVE, [.15, 1.56, 0]], [box(.5, .42, .9), OLIVE2, [-.75, 1.54, 0]], [box(.3, .44, .78), OLIVE2, [.98, 1.56, 0]],
    [cyl(.2, .22, .18, 8), OLIVE2, [-.2, 1.9, .28]], [box(.3, .05, .3), DARK, [.35, 1.84, -.28]],
    [cyl(.085, .1, 2.3, 7), DARK, [2.2, 1.58, 0], [0, 0, -Math.PI / 2]], [cyl(.14, .14, .26, 7), DARK, [3.3, 1.58, 0], [0, 0, -Math.PI / 2]],
    [box(.04, 1.1, .04), DARK, [-.8, 2.3, -.45]],
  ]),
  // A soldier: pale tunic and helmet that take the team colour, dark legs, a rifle. Faces +x.
  soldier: build([
    [box(.22, .5, .34), '#55564a', [0, .25, 0]], [box(.26, .46, .42), '#ececec', [0, .73, 0]],
    [box(.2, .2, .2), '#d6b08e', [0, 1.06, 0]], [cyl(.17, .2, .11, 8), '#b4b4b4', [0, 1.19, 0]],
    [box(.62, .05, .05), '#2e2a25', [.3, .82, .17]],
  ]),
  // The dead: the same figure lying down, all grey.
  body: build([
    [box(.5, .2, .34), '#6e6e6a', [-.35, .1, 0]], [box(.46, .22, .42), '#7c7c78', [.12, .11, 0]], [cyl(.17, .2, .11, 8), '#666662', [.5, .12, 0], [0, 0, -Math.PI / 2]],
  ]),
  // Trees: a trunk and two tiers of leaves. One unit tall, standing on y = 0. The grey one is for outside the battle circle.
  tree: build([[cyl(.07, .09, .3, 5), '#5a4632', [0, .15, 0]], [cone(.5, .55, 6), '#3f5c33', [0, .5, 0]], [cone(.36, .46, 6), '#4a6b3a', [0, .78, 0]]]),
  treeGrey: build([[cyl(.07, .09, .3, 5), '#4a4844', [0, .15, 0]], [cone(.5, .55, 6), '#4b4f4b', [0, .5, 0]], [cone(.36, .46, 6), '#565a56', [0, .78, 0]]]),
  // Aircraft: fuselage, wings, tail.
  plane: build([[box(3.2, .42, .42), '#8a8f86', [0, 0, 0]], [box(.9, .08, 3.6), '#7b8078', [.3, .05, 0]], [box(.5, .06, 1.3), '#7b8078', [-1.4, .08, 0]], [box(.5, .6, .06), '#7b8078', [-1.4, .32, 0]], [cyl(.24, .2, .3, 7), '#3b3c33', [1.7, 0, 0], [0, 0, -Math.PI / 2]]]),
  op: build([
    [box(.15, 3.8, .15), STEEL, [.7, 1.9, .7]], [box(.15, 3.8, .15), STEEL, [-.7, 1.9, .7]], [box(.15, 3.8, .15), STEEL, [.7, 1.9, -.7]], [box(.15, 3.8, .15), STEEL, [-.7, 1.9, -.7]],
    [box(1.9, .15, 1.9), CONC, [0, 3.8, 0]], [box(1.9, .5, .08), SAND, [0, 4.1, .95]], [box(1.9, .5, .08), SAND, [0, 4.1, -.95]], [box(.08, .5, 1.9), SAND, [.95, 4.1, 0]],
    [box(2.2, .12, 2.2), OLIVE, [0, 4.9, 0]], [box(.1, .7, .1), STEEL, [.9, 4.5, .9]], [box(.1, .7, .1), STEEL, [-.9, 4.5, -.9]],
  ]),
  // HQ: a tall flagpole on a stone plinth, with a ring of sandbags round it.
  hq: build([
    [box(2.4, .5, 2.4), CONC, [0, .25, 0]], [box(1.6, .5, 1.6), '#9a978d', [0, .75, 0]],
    [cyl(.12, .16, 12, 6), '#d8d6cf', [0, 6.5, 0]], [cyl(.28, .28, .28, 8), '#c9a13a', [0, 12.6, 0]],
  ]),
  // FOB: a canvas tent, stacked supply crates, sandbags and a radio mast.
  fob: build([
    [box(3.2, 1.6, 2.4), OLIVE, [0, .8, 0]], [box(3.4, .2, 2.6), '#6b6d4f', [0, 1.65, 0]],
    [box(.9, .7, .9), '#7a5f3a', [2.4, .35, .9]], [box(.9, .7, .9), '#7a5f3a', [2.4, .35, -.2]], [box(.9, .6, .9), '#7a5f3a', [2.4, 1, .35]],
    [box(.08, 4.5, .08), STEEL, [-1.4, 2.25, -1]],
    ...sandRing(3.4, 12, .5),
  ]),
  flag: build([[box(3.6, 2.2, .1), '#ffffff', [1.8, 0, 0]], [box(.2, 2.2, .14), '#ffffff', [3.55, 0, 0]]]),
};
