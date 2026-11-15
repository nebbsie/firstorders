export interface Building {
  p: number[][];        // outline in map units
  h: number;            // height above the ground in map units
  v: number;            // random value for colour variation
  mat: number[];        // roof colour, 0..255
  id?: number; base?: number; top?: number; cx?: number; cy?: number;
  btype?: string; name?: string;  // what the building is (church, police, castle...) and its real name, if known
  cells?: number[]; hp0?: number; hp?: number; down?: number | null; vr?: number[];
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
}
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
}
