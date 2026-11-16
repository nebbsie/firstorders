// Overture Maps vector tiles (PMTiles), read straight from the browser with range requests.
// Overture joins OpenStreetMap with machine-learned building outlines (Microsoft, Google, Esri) and adds
// building heights from lidar and other surveys. It also gives hedges, walls, single trees and tree rows,
// road surfaces, and global land cover. The features are turned into the same shape as an Overpass answer,
// so the rest of the import is shared.
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { lonLat, ringArea, tilesFor, type LL } from './mvt';

const STAC = 'https://stac.overturemaps.org/catalog.json', TILES = 'https://tiles.overturemaps.org';
// Used when the release list cannot be read. Each release stays online for some months.
const KNOWN_REL = '2026-10-21.0';
export const OVERTURE_CREDIT = 'Overture Maps Foundation (ODbL): © OpenStreetMap contributors, Microsoft, Google, Esri Community Maps, TomTom and others';

// The newest release in the Overture catalogue.
export async function latestRelease(): Promise<string> {
  try { const r = await fetch(STAC); if (r.ok) { const j = await r.json(); if (typeof j.latest === 'string') return j.latest; } } catch { /* use the known release */ }
  return KNOWN_REL;
}

const ROAD: Record<string, string> = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', residential: 'residential', living_street: 'living_street',
  unclassified: 'unclassified', unknown: 'unclassified', service: 'service', pedestrian: 'pedestrian', track: 'track', footway: 'footway', sidewalk: 'footway', crosswalk: 'footway',
  path: 'path', steps: 'steps', cycleway: 'cycleway', bridleway: 'bridleway',
};
const RAIL = new Set(['standard_gauge', 'narrow_gauge', 'light_rail', 'tram', 'funicular', 'monorail', 'unknown']);
const B_SUB: Record<string, string> = { commercial: 'commercial', industrial: 'industrial', education: 'school', religious: 'church', medical: 'hospital', agricultural: 'farm_auxiliary', outbuilding: 'shed', service: 'garage' };
const PARK = new Set(['grass', 'park', 'garden', 'pitch', 'playground', 'recreation_ground', 'village_green', 'cemetery', 'grave_yard', 'allotments', 'golf_course', 'fairway', 'green', 'rough', 'dog_park', 'common', 'flowerbed', 'meadow_grass']);
const FARM = new Set(['farmland', 'meadow', 'vineyard', 'plant_nursery', 'greenhouse_horticulture', 'animal_keeping', 'aquaculture']);
const BUILT = new Set(['residential', 'industrial', 'commercial', 'retail', 'construction', 'brownfield', 'railway', 'military', 'school', 'college', 'university', 'education', 'hospital', 'clinic', 'religious', 'garages', 'depot', 'landfill', 'quarry']);
const GATE = new Set(['gate', 'kissing_gate', 'swing_gate', 'lift_gate', 'stile', 'cattle_grid', 'sliding_gate', 'hampshire_gate', 'entrance']);

// A JSON list kept as text in a tile property. Bad text gives an empty list.
const list = (s: any): any[] => { if (!s) return []; try { const v = typeof s === 'string' ? JSON.parse(s) : s; return Array.isArray(v) ? v : []; } catch { return []; } };
// The part of a line from fraction a to fraction b of its length.
function slice(p: LL[], a: number, b: number): LL[] {
  const d: number[] = [0]; for (let i = 1; i < p.length; i++) d.push(d[i - 1] + Math.hypot(p[i].lat - p[i - 1].lat, (p[i].lon - p[i - 1].lon) * .7));
  const L = d[d.length - 1] || 1, at = (f: number) => { const t = f * L; let i = 1; while (i < p.length - 1 && d[i] < t) i++; const k = (t - d[i - 1]) / ((d[i] - d[i - 1]) || 1); return { lat: p[i - 1].lat + (p[i].lat - p[i - 1].lat) * k, lon: p[i - 1].lon + (p[i].lon - p[i - 1].lon) * k }; };
  const out = [at(a)]; for (let i = 0; i < p.length; i++) if (d[i] > a * L && d[i] < b * L) out.push(p[i]); out.push(at(b)); return out;
}
// Cut a line where its flags change. Each piece gets the flags that apply along it.
// A line cut at the tile edge has no true fractions; then the whole piece takes the flags of most of its length.
function pieces(p: LL[], rules: any[], whole: boolean): { pts: LL[]; flags: Set<string> }[] {
  if (!rules.length) return [{ pts: p, flags: new Set() }];
  if (!whole) { const f = new Set<string>(); for (const r of rules) { const [a, b] = r.between || [0, 1]; if (b - a > .5) for (const v of r.values || []) f.add(v); } return [{ pts: p, flags: f }]; }
  const cuts = new Set([0, 1]); for (const r of rules) for (const v of r.between || []) cuts.add(v);
  const cs = [...cuts].sort((a, b) => a - b), out: { pts: LL[]; flags: Set<string> }[] = [];
  for (let i = 0; i < cs.length - 1; i++) {
    const a = cs[i], b = cs[i + 1], m = (a + b) / 2; if (b - a < 1e-6) continue; const f = new Set<string>();
    for (const r of rules) { const [x, y] = r.between || [0, 1]; if (m >= x && m <= y) for (const v of r.values || []) f.add(v); }
    out.push({ pts: slice(p, a, b), flags: f });
  }
  return out;
}

export async function fetchOverture(s: number, w: number, n: number, e: number, rel: string | undefined, progress: (s: string) => void) {
  rel = rel || await latestRelease();
  const src = (theme: string) => new PMTiles(`${TILES}/${rel}/${theme}.pmtiles`);
  const jobs = [
    ...tilesFor(s, w, n, e, 14).map(t => ({ theme: 'buildings', z: 14, t })),
    ...tilesFor(s, w, n, e, 14).map(t => ({ theme: 'transportation', z: 14, t })),
    ...tilesFor(s, w, n, e, 13).map(t => ({ theme: 'base', z: 13, t })),
  ];
  const files: Record<string, PMTiles> = {}; for (const j of jobs) files[j.theme] ||= src(j.theme);
  let got = 0, bytes = 0; const say = () => progress(`Downloading Overture map tiles: ${got} / ${jobs.length} (${(bytes / 1e6).toFixed(1)} MB)`); say();
  const tiles = await Promise.all(jobs.map(async j => {
    const r = await files[j.theme].getZxy(j.z, j.t[0], j.t[1]); got++;
    if (!r) { say(); return null; }
    bytes += r.data.byteLength; say();
    return { ...j, vt: new VectorTile(new Pbf(new Uint8Array(r.data))) };
  }));
  if (!tiles.some(t => t && t.theme === 'buildings') && !tiles.some(t => t && t.theme === 'transportation')) throw new Error('no Overture data here');

  const elements: any[] = [], bld = new Map<string, { el: any; a: number; parts?: boolean; of?: string }>();
  const way = (tags: any, geometry: LL[]) => { if (geometry.length > 1) elements.push({ type: 'way', tags, geometry }); };
  const poly = (tags: any, rings: LL[][]) => { if (rings.length) elements.push({ type: 'relation', tags, members: rings.map(r => ({ role: ringArea(r) < 0 ? 'inner' : 'outer', geometry: r })) }); };
  for (const T of tiles) {
    if (!T) continue; const { vt, z, t: [tx, ty] } = T;
    const each = (name: string, fn: (p: any, rings: LL[][], type: number, whole: boolean) => void) => {
      const l = vt.layers[name]; if (!l) return; const ext = l.extent;
      for (let i = 0; i < l.length; i++) {
        const f = l.feature(i), g = f.loadGeometry(); let whole = true;
        const rings = g.map((r: any[]) => r.map(q => { if (q.x < 0 || q.y < 0 || q.x > ext || q.y > ext) whole = false; return lonLat(z, tx, ty, q.x, q.y, ext); }));
        fn(f.properties, rings, f.type, whole);
      }
    };
    if (T.theme === 'buildings') {
      // A building cut by the tile edge comes in pieces from several tiles: keep the biggest piece.
      const add = (p: any, rings: LL[][], part: boolean) => {
        if (p.is_underground === true || p.is_underground === 'true') return;
        const outer = rings.length ? Math.sign(ringArea(rings[0])) : 0, r = rings.filter(r => r.length > 3 && Math.sign(ringArea(r)) === outer).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
        if (!r) return;
        const tags: any = { building: p.class || B_SUB[p.subtype] || 'yes' };
        if (p.height != null) tags.height = String(p.height); if (p.num_floors != null) tags['building:levels'] = String(p.num_floors);
        if (p['@name']) tags.name = p['@name']; if (part) tags.part = 'yes';
        if (p.subtype === 'religious') tags.amenity = 'place_of_worship';
        const a = Math.abs(ringArea(r)), key = String(p.id || Math.random()), old = bld.get(key);
        if (!old || old.a < a) bld.set(key, { el: { type: 'way', tags, geometry: r }, a, parts: p.has_parts === true || p.has_parts === 'true', of: part ? p.building_id : undefined });
      };
      each('building', (p, rings) => add(p, rings, false));
      each('building_part', (p, rings) => { if (p.height != null) add(p, rings, true); });
    } else if (T.theme === 'transportation') {
      each('segment', (p, rings, _t, whole) => {
        const rail = p.subtype === 'rail';
        const hw = rail ? (RAIL.has(p.class) ? 'rail' : null) : ROAD[p.class]; if (!hw) return;
        const surf = list(p.road_surface)[0]?.value, flags = list(rail ? p.rail_flags : p.road_flags), lv = list(p.level_rules).filter((r: any) => r.value < 0).map((r: any) => ({ between: r.between, values: ['is_tunnel'] }));
        for (const r of rings) for (const pc of pieces(r, flags.concat(lv), whole)) {
          if (pc.flags.has('is_tunnel') || pc.flags.has('is_underground')) continue;
          const tags: any = rail ? { railway: 'rail' } : { highway: hw }; if (pc.flags.has('is_bridge')) tags.bridge = 'yes'; if (surf) tags.surface = surf;
          way(tags, pc.pts);
        }
      });
    } else {
      each('water', (p, rings, type) => {
        const c = p.class; if (['swimming_pool', 'reflecting_pool', 'fountain'].includes(c)) return;
        if (type === 3) poly({ natural: 'water' }, rings);
        else if (type === 2 && ['river', 'stream', 'canal', 'ditch', 'drain'].includes(c) && !(p.is_intermittent && c !== 'river')) for (const r of rings) way({ waterway: c === 'ditch' || c === 'drain' ? 'stream' : c }, r);
      });
      each('land', (p, rings, type) => {
        const c = p.class;
        if (type === 1 && c === 'tree') { for (const r of rings) for (const q of r) elements.push({ type: 'node', tags: { natural: 'tree' }, lat: q.lat, lon: q.lon }); }
        else if (type === 2 && c === 'tree_row') for (const r of rings) way({ natural: 'tree_row' }, r);
        else if (type === 3) {
          if (['wood', 'forest'].includes(c)) poly({ natural: 'wood' }, rings);
          else if (['scrub', 'shrub', 'heath'].includes(c)) poly({ natural: 'scrub' }, rings);
          else if (['wetland', 'marsh', 'bog', 'swamp', 'reedbed'].includes(c)) poly({ natural: 'wetland' }, rings);
          else if (['grass', 'grassland'].includes(c)) poly({ leisure: 'park' }, rings);
        }
      });
      each('land_use', (p, rings, type) => {
        if (type !== 3) return; const c = p.class;
        if (c === 'forest') poly({ landuse: 'forest' }, rings);
        else if (c === 'orchard') poly({ landuse: 'orchard' }, rings);
        else if (FARM.has(c)) poly({ landuse: 'farmland' }, rings);
        else if (PARK.has(c)) poly({ leisure: 'park' }, rings);
        else if (BUILT.has(c) || BUILT.has(p.subtype)) poly({ landuse: c === 'retail' || c === 'commercial' ? 'commercial' : c === 'industrial' || c === 'railway' || c === 'quarry' || c === 'military' ? 'industrial' : 'residential' }, rings);
      });
      // Global land cover from satellite images: fills woods and fields where the mapped data is empty.
      each('land_cover', (p, rings, type) => { if (type === 3 && ['forest', 'crop', 'grass'].includes(p.subtype)) poly({ cover: p.subtype }, rings); });
      each('infrastructure', (p, rings, type) => {
        const c = p.class;
        if (type === 1) { if (GATE.has(c)) for (const r of rings) for (const q of r) elements.push({ type: 'node', tags: { barrier: 'gate' }, lat: q.lat, lon: q.lon }); return; }
        const kind = c === 'hedge' ? 'hedge' : c === 'wall' || c === 'city_wall' ? 'wall' : c === 'fence' ? 'fence' : null; if (!kind) return;
        // A hedge drawn as an area: its outline is the hedge.
        for (const r of rings) way({ barrier: kind }, r);
      });
    }
  }
  // A building with parts often carries the height of its tallest part (a spire) over the whole outline.
  // It takes the height of its biggest part instead; the taller parts stand on it as towers.
  const biggest = new Map<string, { a: number; h: string }>();
  for (const b of bld.values()) if (b.of && b.el.tags.height) { const o = biggest.get(b.of); if (!o || o.a < b.a) biggest.set(b.of, { a: b.a, h: b.el.tags.height }); }
  for (const [id, b] of bld) { const big = biggest.get(id); if (b.parts && big && (!b.el.tags.height || +big.h < +b.el.tags.height)) { b.el.tags.height = big.h; delete b.el.tags['building:levels']; } }
  for (const { el } of bld.values()) elements.push(el);
  elements.forEach((el, i) => el.id = i + 1);
  return { elements, rel, mb: bytes / 1e6 };
}
