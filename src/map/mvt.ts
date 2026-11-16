// Shared helpers for map tiles in the web Mercator grid (vector tiles and height tiles).
export type LL = { lat: number; lon: number };

// The tile that holds a point at zoom z.
export const tileX = (lon: number, z: number) => Math.floor((lon + 180) / 360 * 2 ** z);
export const tileY = (lat: number, z: number) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
// A point inside tile (tx, ty) at zoom z, in tile units out of ext, to latitude and longitude.
export function lonLat(z: number, tx: number, ty: number, x: number, y: number, ext: number): LL {
  const n = 2 ** z, fx = (tx + x / ext) / n, fy = (ty + y / ext) / n;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180 / Math.PI, lon: fx * 360 - 180 };
}
// Signed area of a ring in degrees. Its sign gives the winding.
export const ringArea = (r: LL[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.lon * q.lat - q.lon * p.lat; } return a / 2; };
export function inRing(r: LL[], lat: number, lon: number) {
  let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) c = !c; } return c;
}
// All tiles at zoom z that cover the box.
export function tilesFor(s: number, w: number, n: number, e: number, z: number) {
  const out: [number, number][] = [];
  for (let y = tileY(n, z); y <= tileY(s, z); y++) for (let x = tileX(w, z); x <= tileX(e, z); x++) out.push([x, y]);
  return out;
}
