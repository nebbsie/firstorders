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
// A sandbag: a squat box with a darker seam strip, so stacks read as bags and not blocks.
const BAG = '#b9a67c', BAG2 = '#a8956c', WOOD = '#7a5f3a', WOOD2 = '#5f4a2e', CANVAS = '#6e7150';
function bag(x: number, y: number, z: number, yaw: number, col = BAG): Part[] {
  return [[box(.86, .26, .42), col, [x, y, z], [0, yaw, 0]], [box(.9, .05, .2), BAG2, [x, y + .12, z], [0, yaw, 0]]];
}
// A ring of sandbags, open at the front (+x), two layers with the top one staggered.
function sandRing(r: number, n: number, layers = 2, gap = .55): Part[] {
  const out: Part[] = [];
  for (let l = 0; l < layers; l++) for (let k = 0; k < n; k++) {
    const a = (k + l * .5) / n * Math.PI * 2 - Math.PI; if (Math.abs(a) < gap) continue;
    out.push(...bag(Math.cos(a) * r, .13 + l * .27, Math.sin(a) * r, -a + Math.PI / 2, l ? BAG : '#b3a077'));
  }
  return out;
}
const crate = (x: number, y: number, z: number, s = .7, yaw = 0): Part[] => [[box(s, s * .7, s), WOOD, [x, y + s * .35, z], [0, yaw, 0]], [box(s * 1.04, s * .1, s * 1.04), WOOD2, [x, y + s * .35, z], [0, yaw, 0]]];
THREE.ColorManagement.enabled = false;
export const MODELS: Record<string, THREE.BufferGeometry> = {
  // Mortar pit: base plate, tube on a bipod, shells in an open crate, a low ring of bags.
  mortar: build([
    [cyl(.5, .56, .1, 10), STEEL, [0, .05, 0]],
    [cyl(.11, .13, 1.7, 8), DARK, [.34, .78, 0], [0, 0, -.72]], [cyl(.15, .15, .1, 8), STEEL, [.9, 1.42, 0], [0, 0, -.72]],
    [box(.06, 1.15, .06), STEEL, [.78, .52, .3], [.36, 0, -.22]], [box(.06, 1.15, .06), STEEL, [.78, .52, -.3], [-.36, 0, -.22]], [box(.05, .05, .62), STEEL, [.7, .62, 0]],
    ...crate(-.75, 0, .55, .6, .3), [cyl(.06, .06, .34, 6), '#4a5a3a', [-.75, .5, .5], [0, 0, .5]], [cyl(.06, .06, .34, 6), '#4a5a3a', [-.7, .5, .68], [0, 0, .5]],
    ...sandRing(1.5, 10, 2, .7),
  ]),
  // MG nest: a horseshoe of bags three high, the gun on a tripod with its ammunition box.
  mg: build([
    ...sandRing(1.4, 10, 3, .5),
    [box(.62, .2, .22), DARK, [.1, .86, 0]], [cyl(.075, .075, 1.15, 8), '#4b4d52', [.9, .87, 0], [0, 0, -Math.PI / 2]], [cyl(.04, .04, .3, 6), DARK, [1.6, .87, 0], [0, 0, -Math.PI / 2]],
    [box(.2, .28, .06), DARK, [-.25, .82, 0]], [box(.06, .86, .06), STEEL, [.35, .43, .28], [.42, 0, -.2]], [box(.06, .86, .06), STEEL, [.35, .43, -.28], [-.42, 0, -.2]], [box(.06, .86, .06), STEEL, [-.3, .43, 0], [0, 0, .5]],
    [box(.34, .24, .2), '#4a5a3a', [.1, .12, .5]], [box(.3, .04, .04), '#c9b15a', [.1, .78, .2]],
  ]),
  // AT gun: angled shield, long barrel with a muzzle brake, spoked wheels, split trails with spades.
  at: build([
    [box(.1, .95, 1.2), OLIVE, [.38, .82, 0]], [box(.1, .8, .5), OLIVE2, [.3, .78, .8], [0, .45, 0]], [box(.1, .8, .5), OLIVE2, [.3, .78, -.8], [0, -.45, 0]],
    [cyl(.085, .1, 2.5, 8), DARK, [1.6, .86, 0], [0, 0, -Math.PI / 2]], [cyl(.15, .15, .28, 8), DARK, [2.8, .86, 0], [0, 0, -Math.PI / 2]], [box(.7, .26, .3), DARK, [-.05, .86, 0]],
    [cyl(.44, .44, .18, 10), RUBBER, [.05, .44, .72], [Math.PI / 2, 0, 0]], [cyl(.44, .44, .18, 10), RUBBER, [.05, .44, -.72], [Math.PI / 2, 0, 0]],
    [cyl(.2, .2, .22, 8), OLIVE2, [.05, .44, .72], [Math.PI / 2, 0, 0]], [cyl(.2, .2, .22, 8), OLIVE2, [.05, .44, -.72], [Math.PI / 2, 0, 0]], [box(.16, .16, 1.4), OLIVE2, [.05, .46, 0]],
    [box(1.9, .12, .14), OLIVE, [-1.05, .26, .42], [0, -.24, .1]], [box(1.9, .12, .14), OLIVE, [-1.05, .26, -.42], [0, .24, .1]],
    [box(.1, .3, .4), DARK, [-1.95, .14, .66]], [box(.1, .3, .4), DARK, [-1.95, .14, -.66]],
    ...crate(-.6, 0, 1.25, .5, .4),
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
  // Observation tower: timber legs with cross braces, a railed platform with a roof, and a ladder.
  op: build([
    ...[[.75, .75], [-.75, .75], [.75, -.75], [-.75, -.75]].map(([x, z]) => [box(.16, 3.9, .16), WOOD, [x, 1.95, z]] as Part),
    ...[.75, -.75].flatMap(z => [[box(2.4, .08, .08), WOOD2, [0, 1.3, z], [0, 0, .98]] as Part, [box(2.4, .08, .08), WOOD2, [0, 2.6, z], [0, 0, -.98]] as Part]),
    ...[.75, -.75].flatMap(x => [[box(.08, .08, 2.4), WOOD2, [x, 1.3, 0], [.98, 0, 0]] as Part, [box(.08, .08, 2.4), WOOD2, [x, 2.6, 0], [-.98, 0, 0]] as Part]),
    [box(2.1, .14, 2.1), WOOD, [0, 3.9, 0]],
    [box(2.1, .5, .08), WOOD2, [0, 4.25, 1.02]], [box(2.1, .5, .08), WOOD2, [0, 4.25, -1.02]], [box(.08, .5, 2.1), WOOD2, [1.02, 4.25, 0]], [box(.08, .5, 2.1), WOOD2, [-1.02, 4.25, 0]],
    ...[[.95, .95], [-.95, .95], [.95, -.95], [-.95, -.95]].map(([x, z]) => [box(.1, 1.1, .1), WOOD, [x, 4.5, z]] as Part),
    [cone(1.75, .7, 4), CANVAS, [0, 5.4, 0], [0, Math.PI / 4, 0]],
    [box(.06, 4, .06), WOOD2, [-1.15, 1.95, .2], [0, 0, -.08]], [box(.06, 4, .06), WOOD2, [-1.15, 1.95, -.2], [0, 0, -.08]],
    ...[.5, 1.1, 1.7, 2.3, 2.9, 3.5].map(y => [box(.05, .05, .4), WOOD2, [-1.15 + (y - 1.95) * .08, y, 0]] as Part),
  ]),
  // HQ: a tall flagpole on a stepped stone plinth.
  hq: build([
    [box(2.6, .3, 2.6), CONC, [0, .15, 0]], [box(1.9, .3, 1.9), '#9a978d', [0, .45, 0]], [box(1.2, .3, 1.2), '#a8a59b', [0, .75, 0]],
    [cyl(.12, .16, 12, 6), '#d8d6cf', [0, 6.9, 0]], [cyl(.28, .28, .28, 8), '#c9a13a', [0, 13, 0]],
  ]),
  // FOB: a ridge tent, crates and fuel drums, a radio mast, a table, and a ring of bags.
  fob: build([
    [cyl(1.25, 1.25, 3, 3), CANVAS, [-.2, .62, -.5], [Math.PI / 2, 0, Math.PI / 2]], [box(3.1, .05, .1), '#565a3f', [-.2, 1.26, -.5]],
    [box(.08, 1.3, .08), WOOD2, [1.32, .65, -.5]], [box(.08, 1.3, .08), WOOD2, [-1.72, .65, -.5]],
    ...crate(1.5, 0, 1.2, .8, .2), ...crate(2.2, 0, .55, .7, -.3), ...crate(1.6, .56, 1.15, .6, .5),
    [cyl(.3, .3, .8, 9), '#55603f', [.2, .4, 1.6]], [cyl(.3, .3, .8, 9), '#55603f', [-.5, .4, 1.75]], [cyl(.3, .3, .8, 9), '#6b3f33', [-.15, .4, 2.3]],
    [box(.07, 5.2, .07), STEEL, [-1.9, 2.6, 1.4]], [box(.9, .04, .04), STEEL, [-1.9, 4.6, 1.4]], [box(.6, .04, .04), STEEL, [-1.9, 4.2, 1.4]],
    [box(1.1, .06, .6), WOOD, [.6, .62, -1.9]], [box(.06, .6, .06), WOOD2, [.15, .3, -1.7]], [box(.06, .6, .06), WOOD2, [1.05, .3, -1.7]], [box(.06, .6, .06), WOOD2, [.15, .3, -2.1]], [box(.06, .6, .06), WOOD2, [1.05, .3, -2.1]],
    ...sandRing(3.6, 22, 2, .45),
  ]),
  flag: build([[box(3.6, 2.2, .1), '#ffffff', [1.8, 0, 0]], [box(.2, 2.2, .14), '#ffffff', [3.55, 0, 0]]]),
};

// Defences, one piece for each map cell (2 wide), lying along x and standing on y = 0.
const torus = (r: number) => new THREE.TorusGeometry(r, .02, 4, 9);
export const DEFENCES: Record<string, THREE.BufferGeometry> = {
  // Sandbag wall: three layers, the middle one staggered.
  sandbag: build([...[-.66, 0, .66].flatMap(x => bag(x, .13, 0, 0)), ...[-.34, .34].flatMap(x => bag(x, .4, 0, 0, '#b3a077')), ...[-.66, 0, .66].flatMap(x => bag(x, .67, 0, 0))]),
  // Trench: a dark cut with duckboards, and an earth bank on each side.
  trench: build([
    [box(2.02, .06, 1.1), '#2e2318', [0, .04, 0]], ...[-.75, -.25, .25, .75].map(x => [box(.36, .04, .8), '#6a573c', [x, .09, 0]] as Part),
    [box(2.04, .34, .42), '#6b583e', [0, .17, .76], [.35, 0, 0]], [box(2.04, .34, .42), '#6b583e', [0, .17, -.76], [-.35, 0, 0]],
    [box(2.04, .12, .3), '#7a6648', [0, .36, .9]], [box(2.04, .12, .3), '#7a6648', [0, .36, -.9]],
  ]),
  // Wire: posts with coils of concertina wire between them.
  wire: build([
    [box(.09, 1, .09), WOOD2, [-.95, .5, 0]], [box(.09, 1, .09), WOOD2, [.95, .5, 0]], [box(.09, .9, .09), WOOD2, [0, .45, 0], [.2, 0, 0]],
    ...[-.8, -.48, -.16, .16, .48, .8].map((x, k) => [torus(.34), '#b4b0a6', [x, .4, 0], [k * .7, Math.PI / 2, 0]] as Part),
    [box(2, .025, .025), '#b4b0a6', [0, .74, .05], [0, 0, .04]], [box(2, .025, .025), '#b4b0a6', [0, .3, -.05], [0, 0, -.04]],
  ]),
  // Tank trap: a steel hedgehog of three crossed beams on a concrete foot.
  tanktrap: build([
    [box(1.9, .16, .16), '#4f4e4a', [0, .62, 0], [0, .5, .78]], [box(1.9, .16, .16), '#4f4e4a', [0, .62, 0], [0, -.5, -.78]], [box(1.9, .16, .16), '#5b5a55', [0, .62, 0], [.78, 1.57, 0]],
    [box(.5, .12, .5), '#7c7a72', [0, .06, 0]],
  ]),
  // Wall: a concrete block with a plinth and a cap.
  wall: build([[box(2.04, .3, 2.04), '#77736a', [0, .15, 0]], [box(1.94, 1.9, 1.94), '#938e82', [0, 1.25, 0]], [box(2.08, .22, 2.08), '#a39e92', [0, 2.3, 0]], [box(1.96, .06, .5), '#7f7b71', [0, 1.3, .73]], [box(1.96, .06, .5), '#7f7b71', [0, 1.3, -.73]]]),
};
