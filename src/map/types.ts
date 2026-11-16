export interface Building {
  p: number[][];        // outline in map units
  h: number;            // height above the ground in map units
  v: number;            // random value for colour variation
  mat: number[];        // roof colour, 0..255
  id?: number; base?: number; top?: number; cx?: number; cy?: number;
  btype?: string; name?: string;  // what the building is (church, police, castle...) and its real name, if known
  cells?: number[]; hp0?: number; hp?: number; down?: number | null; vr?: number[];
  thin?: boolean;  // a wall, or a long thin building: on the cell grid it takes every cell it touches, so it has no gaps
  hip?: any;  // the pitched roof as the 3D map draws it, so men on the roof stand on its slope
  parent?: number; area?: number; parts?: any[]; spire?: { half: number; y1: number; y2: number };  // a part of a bigger building (a tower, a chapel) points to the main one
}
export interface Bridge {
  cells: number[]; ramp: number[]; ends: number[]; deck: number; cx: number; cy: number;
  blown: number | null; group?: any;
  span?: { ax: number; ay: number; s0: number; s1: number; half: number; h0: number; h1: number }; // straight deck over the water
}
// What a map source (the sample town or an OpenStreetMap import) hands over.
export interface RawMap {
  seed: number; name: string; source: 'sample' | 'osm'; credit?: string;
  terr: Uint8Array;           // surface per cell, without buildings
  baseH: Float32Array;        // ground height at cell corners, before water is cut in
  B: Building[];
  ground?: HTMLCanvasElement; // painted ground texture; painted from the cells when absent
  farm?: Uint8Array;          // farmland cells, for the texture only
  paintOver?: (g: CanvasRenderingContext2D) => void; // smooth roads and water on top of the texture
  feat?: Uint8Array;          // hedge, wall or fence per cell (F_*)
  fences?: Fence[];           // the same lines as drawn, for the 3D models
  trees?: number[][];         // single trees and tree rows: x, y, size
}
// Field boundaries from the map data. Hedges hide men and block sight; walls give cover; fences only show.
export const F_HEDGE = 1, F_WALL = 2, F_FENCE = 3;
export interface Fence { k: number; pts: number[][] }
export interface MapData {
  seed: number; name: string; source: 'sample' | 'osm'; credit?: string;
  ground: HTMLCanvasElement;
  terr: Uint8Array; terr0: Uint8Array;
  TH: Float32Array; hAt: (x: number, y: number) => number;
  deck: Float32Array; deck0: Float32Array;
  bridges: Bridge[]; B: Building[]; trees: number[][];
  bldTop: Float32Array; bldId: Int32Array; count: number;
  play: Uint8Array;           // 1 for cells inside the battle circle
  bldId0: Int32Array; bldTop0: Float32Array;
  wl: Float32Array;           // water surface height per cell
  feat: Uint8Array; fences: Fence[];
}
