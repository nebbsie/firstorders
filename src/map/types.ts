export interface Building {
  p: number[][];        // outline in map units
  h: number;            // height above the ground in map units
  v: number;            // random value for colour variation
  mat: number[];        // roof colour, 0..255
  id?: number; base?: number; top?: number; cx?: number; cy?: number;
}
export interface Bridge {
  cells: number[]; ends: number[]; deck: number; cx: number; cy: number;
  blown: number | null; group?: any;
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
}
