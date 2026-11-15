// OpenFreeMap vector tiles (OpenMapTiles schema): a fast, cached source of OpenStreetMap data.
// The features are turned into the same shape as an Overpass answer, so the rest of the import is shared.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const TILEJSON = 'https://tiles.openfreemap.org/planet', Z = 14;
const ROAD: Record<string, string> = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'track', path: 'footway', raceway: 'service' };
const POI: Record<string, any> = {
  place_of_worship: { amenity: 'place_of_worship' }, police: { amenity: 'police' }, fire_station: { amenity: 'fire_station' }, hospital: { amenity: 'hospital' },
  school: { amenity: 'school' }, college: { amenity: 'college' }, town_hall: { amenity: 'townhall' }, castle: { historic: 'castle' }, bar: { amenity: 'pub' }, beer: { amenity: 'pub' },
};

function lonLat(tx: number, ty: number, x: number, y: number, ext: number) {
  const n = 2 ** Z, fx = (tx + x / ext) / n, fy = (ty + y / ext) / n;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180 / Math.PI, lon: fx * 360 - 180 };
}
const area = (r: { lat: number; lon: number }[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.lon * q.lat - q.lon * p.lat; } return a / 2; };
function inside(r: { lat: number; lon: number }[], lat: number, lon: number) {
  let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) c = !c; } return c;
}

export async function fetchTiles(s: number, w: number, n: number, e: number, progress: (s: string) => void) {
  const tj = await (await fetch(TILEJSON)).json(), tmpl: string = tj.tiles[0];
  const N = 2 ** Z, tx = (lon: number) => Math.floor((lon + 180) / 360 * N), ty = (lat: number) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N); };
  const x0 = tx(w), x1 = tx(e), y0 = ty(n), y1 = ty(s), jobs: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let got = 0; progress(`Downloading map tiles: 0 / ${jobs.length}`);
  const tiles = await Promise.all(jobs.map(async ([x, y]) => {
    const r = await fetch(tmpl.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y)));
    if (!r.ok) throw new Error(`map tile ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer()); progress(`Downloading map tiles: ${++got} / ${jobs.length}`);
    return { x, y, vt: new VectorTile(new Pbf(buf)) };
  }));
  const elements: any[] = [], buildings: any[] = [], pois: any[] = [];
  for (const { x, y, vt } of tiles) {
    const L = (name: string, fn: (f: any, rings: any[], ext: number) => void) => { const l = vt.layers[name]; if (!l) return; for (let i = 0; i < l.length; i++) { const f = l.feature(i); fn(f, f.loadGeometry().map((r: any[]) => r.map(p => lonLat(x, y, p.x, p.y, l.extent))), l.extent); } };
    // Only keep features whose middle lies in this tile, so pieces cut at tile edges are not doubled.
    const mine = (r: any[]) => { const c = r.reduce((a, p) => ({ lat: a.lat + p.lat / r.length, lon: a.lon + p.lon / r.length }), { lat: 0, lon: 0 }), a = lonLat(x, y, 0, 0, 1), b = lonLat(x, y, 1, 1, 1); return c.lon >= a.lon && c.lon < b.lon && c.lat <= a.lat && c.lat > b.lat; };
    L('building', (f, rings) => { for (const r of rings) if (area(r) !== 0 && mine(r)) { const el = { type: 'way', tags: { building: 'yes', ...(f.properties.render_height ? { height: String(f.properties.render_height) } : {}) } as any, geometry: r }; elements.push(el); buildings.push(el); break; } });
    L('transportation', (f, rings) => {
      const p = f.properties; if (p.brunnel === 'tunnel') return;
      if (p.class === 'rail') { for (const r of rings) elements.push({ type: 'way', tags: { highway: 'footway' }, geometry: r }); return; }
      const hw = ROAD[p.class]; if (!hw) return;
      for (const r of rings) elements.push({ type: 'way', tags: { highway: hw, bridge: p.brunnel === 'bridge' ? 'yes' : undefined }, geometry: r });
    });
    const poly = (tags: any, rings: any[]) => { if (rings.length) elements.push({ type: 'relation', tags, members: rings.map(r => ({ role: area(r) < 0 ? 'inner' : 'outer', geometry: r })) }); };
    L('water', (f, rings) => poly({ natural: 'water' }, rings));
    L('waterway', (f, rings) => { const c = f.properties.class; if (c === 'river' || c === 'canal' || c === 'stream') for (const r of rings) elements.push({ type: 'way', tags: { waterway: c }, geometry: r }); });
    L('landcover', (f, rings) => { const c = f.properties.class; poly(c === 'wood' ? { natural: 'wood' } : c === 'farmland' ? { landuse: 'farmland' } : c === 'grass' ? { leisure: 'park' } : {}, rings); });
    L('park', (f, rings) => poly({ leisure: 'park' }, rings));
    L('poi', (f, rings) => { const t = POI[f.properties.class] || (f.properties.subclass === 'station' && f.properties.class === 'railway' ? { building: 'train_station' } : null); if (t) pois.push({ ...rings[0][0], tags: t, name: f.properties.name }); });
  }
  // Points of interest give their building a type and a name.
  for (const p of pois) for (const b of buildings) if (inside(b.geometry, p.lat, p.lon)) { Object.assign(b.tags, p.tags); if (p.name) b.tags.name = p.name; break; }
  // Stable ids: the import uses them to vary building colours and heights.
  elements.forEach((el, i) => el.id = i + 1);
  return { elements: elements.filter(el => !el.tags || Object.keys(el.tags).length) };
}
