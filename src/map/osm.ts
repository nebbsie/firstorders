import { W, H, C, GW, GH, M_PER_UNIT, BATTLE_KM, CX, PLAY_R, T_GROUND, T_ROAD, T_PARK, T_WATER, T_BRIDGE, T_WOOD, hashf } from '../config';
import type { RawMap, Building } from './types';
import { cacheGet, cachePut } from './cache';
import { fetchTiles } from './tiles';
import { fetchOverture, OVERTURE_CREDIT } from './overture';
import { tilesFor, tileX, tileY } from './mvt';
import { BTYPES, btypeFromTags, KEEP_NAME } from './btypes';
import { wallBuildings } from './walls';
import { F_HEDGE, F_WALL, F_FENCE } from './types';

// rel: the Overture release the host used, so a guest downloads the same map.
// The historic setup of a battlefield (see battlefields.ts).
export interface Hist { a: number; you: boolean; d: number }
export interface Place { name: string; full: string; lat: number; lon: number; rel?: string; hist?: Hist }

export async function searchPlaces(q: string): Promise<Place[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=en&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`Place search failed (${r.status})`);
  const list = await r.json();
  return list.map((p: any) => ({ name: (p.name || p.display_name.split(',')[0]), full: p.display_name, lat: +p.lat, lon: +p.lon }));
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// One server: reads the answer as it streams in, so the menu can show how much has arrived.
async function fetchFrom(url: string, q: string, signal: AbortSignal, onBytes: (n: number) => void) {
  const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  if (!r.ok || !r.body) throw new Error(`${new URL(url).host} answered ${r.status}`);
  const reader = r.body.getReader(), parts: Uint8Array[] = []; let n = 0;
  for (; ;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes(n); }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const json = JSON.parse(new TextDecoder().decode(all)); if (json.remark && !json.elements?.length) throw new Error(json.remark); return json;
}
// Ask two servers at once and keep whichever answers first; then the next two; then try again.
async function overpass(q: string, progress: (s: string) => void) {
  let last = '';
  for (let round = 0; round < 3; round++) for (let k = 0; k < OVERPASS.length; k += 2) {
    const pair = OVERPASS.slice(k, k + 2), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 75000);
    progress(`Downloading map data (${pair.map(u => new URL(u).host).join(' or ')})`);
    try {
      const res = await Promise.any(pair.map(u => fetchFrom(u, q, ctl.signal, n => progress(`Downloading map data: ${(n / 1e6).toFixed(1)} MB`))));
      ctl.abort(); clearTimeout(timer); return res;
    } catch (e: any) { clearTimeout(timer); last = e?.errors?.[0]?.message || e?.message || 'no answer'; }
    progress('Map servers busy, trying others'); await sleep(1500);
  }
  throw new Error(`Could not download map data (${last}). The public map servers are busy; try again shortly, or play the sample town.`);
}

// Height tiles in the Terrarium code: height in metres = R * 256 + G + B / 256 - 32768.
// Mapterhorn first (512 px tiles, lidar detail in many countries). Where it has no tile at the zoom we want,
// a tile at a lower zoom covers the same ground. If Mapterhorn fails, AWS Terrain Tiles (256 px) are used.
type HTile = { z: number; x: number; y: number; size: number; h: Float32Array };
async function decodeHeights(url: string): Promise<{ size: number; h: Float32Array }> {
  const r = await fetch(url); if (!r.ok) throw new Error(`height tile ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const size = bmp.width, cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); bmp.close();
  const d = g.getImageData(0, 0, size, size).data, h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return { size, h };
}
const HSRC = {
  mapterhorn: { url: (z: number, x: number, y: number) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`, z: () => BATTLE_KM === 1 ? 15 : BATTLE_KM === 2 ? 14 : 13, zMin: 9, credit: 'Mapterhorn' },
  aws: { url: (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, z: () => BATTLE_KM > 1 ? 14 : 15, zMin: 15, credit: 'AWS Terrain Tiles' },
};
async function elevationFrom(src: typeof HSRC.mapterhorn, toLatLon: (x: number, y: number) => [number, number], progress: (s: string) => void) {
  const z = src.z(), [n, w] = toLatLon(0, 0), [s, e] = toLatLon(W, H), want = tilesFor(s, w, n, e, z), loaded = new Map<string, Promise<HTile>>();
  // A tile, or the lowest-zoom tile above it that the server has.
  const get = (zz: number, x: number, y: number): Promise<HTile> => {
    const k = `${zz}/${x}/${y}`; if (!loaded.has(k)) loaded.set(k, decodeHeights(src.url(zz, x, y)).then(t => ({ z: zz, x, y, ...t }), err => zz > src.zMin ? get(zz - 1, x >> 1, y >> 1) : Promise.reject(err)));
    return loaded.get(k);
  };
  let got = 0; progress(`Downloading terrain heights: 0 / ${want.length}`);
  const tiles = new Map<string, HTile>();
  await Promise.all(want.map(async ([x, y]) => { tiles.set(`${x}/${y}`, await get(z, x, y)); progress(`Downloading terrain heights: ${++got} / ${want.length}`); }));
  const VW = GW + 1, VH = GH + 1, out = new Float32Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
    const [la, lo] = toLatLon(i * C, j * C), t = tiles.get(`${tileX(lo, z)}/${tileY(la, z)}`), N = 2 ** t.z, r = la * Math.PI / 180;
    const fx = Math.min(t.size - 1.001, Math.max(0, ((lo + 180) / 360 * N - t.x) * t.size - .5)), fy = Math.min(t.size - 1.001, Math.max(0, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N - t.y) * t.size - .5));
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, H0 = t.h, S = t.size, q = iy * S + ix;
    out[j * VW + i] = H0[q] * (1 - u) * (1 - v) + H0[q + 1] * u * (1 - v) + H0[q + S] * (1 - u) * v + H0[q + S + 1] * u * v;
  }
  return out;
}
async function elevationGrid(toLatLon: (x: number, y: number) => [number, number], progress: (s: string) => void): Promise<{ dem: Float32Array; credit: string }> {
  try { return { dem: await elevationFrom(HSRC.mapterhorn, toLatLon, progress), credit: HSRC.mapterhorn.credit }; }
  catch { return { dem: await elevationFrom(HSRC.aws, toLatLon, progress), credit: HSRC.aws.credit }; }
}

const ROAD_M: Record<string, number> = { motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 7, living_street: 6, service: 5, track: 4, motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7, pedestrian: 6 };
const PATHS = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'corridor']);
const UNPAVED = new Set(['unpaved', 'dirt', 'gravel', 'ground', 'grass', 'earth', 'mud', 'sand', 'fine_gravel', 'compacted', 'pebblestone', 'woodchips']);
const BUILT_LU = new Set(['residential', 'industrial', 'commercial', 'retail']);
const B_HEIGHT: Record<string, number> = { house: 7, detached: 7, semidetached_house: 7, terrace: 8, residential: 9, apartments: 15, commercial: 12, retail: 7, office: 18, industrial: 9, warehouse: 9, church: 16, cathedral: 30, chapel: 9, school: 10, university: 14, hospital: 16, hotel: 18, garage: 3, garages: 3, shed: 3, hut: 3, roof: 4, train_station: 12, farm_auxiliary: 6, barn: 7, greenhouse: 4 };
const STONE = [186, 177, 158], BRICK = [156, 108, 88], SLATE = [118, 124, 128], CONCRETE = [160, 158, 150];

function buildingHeight(t: any, r: number) {
  const num = (s: string) => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : NaN; };
  let m = t.height ? num(t.height) : NaN;
  if (!isFinite(m) && t['building:levels']) { const l = num(t['building:levels']); if (isFinite(l)) m = l * 3.1 + 1.5; }
  if (!isFinite(m)) m = (B_HEIGHT[t.building] || 8) * (.85 + r * .3);
  return Math.max(2.5, Math.min(m, 150));
}
function buildingColour(t: any, r: number) {
  const b = t.building;
  if (['industrial', 'warehouse', 'commercial', 'retail', 'office', 'garage', 'garages'].includes(b)) return r < .5 ? SLATE : CONCRETE;
  if (['church', 'cathedral', 'chapel'].includes(b)) return STONE;
  return r < .45 ? BRICK : r < .85 ? STONE : SLATE;
}

// Clean a building outline: drop doubled points, points on a straight run, and tiny notches,
// so walls are a few clean faces and not slivers. Tolerances are in map units.
function cleanRing(r: number[][]) {
  const TOL = .22;
  for (let pass = 0; pass < 4 && r.length > 3; pass++) {
    const out: number[][] = [];
    for (let i = 0; i < r.length; i++) {
      const a = out.length ? out[out.length - 1] : r[(i - 1 + r.length) % r.length], p = r[i], b = r[(i + 1) % r.length];
      if (Math.hypot(p[0] - a[0], p[1] - a[1]) < TOL) continue;
      const ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey);
      if (el > 1e-6 && Math.abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / el < TOL * .6) continue;
      out.push(p);
    }
    if (out.length < 3 || out.length === r.length) { if (out.length >= 3) r = out; break; }
    r = out;
  }
  return r;
}
// Join the member ways of a multipolygon into closed rings.
function joinRings(ways: number[][][]) {
  const rings: number[][][] = [], left = ways.map(w => w.slice());
  const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  while (left.length) {
    let ring = left.shift();
    for (let guard = 0; guard < 500 && !same(ring[0], ring[ring.length - 1]); guard++) {
      const end = ring[ring.length - 1], i = left.findIndex(w => same(w[0], end) || same(w[w.length - 1], end));
      if (i < 0) break;
      const w = left.splice(i, 1)[0]; ring = ring.concat(same(w[0], end) ? w.slice(1) : w.reverse().slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

export async function importPlace(place: Place, progress: (s: string) => void): Promise<RawMap> {
  const lat0 = place.lat, lon0 = place.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const toUnits = (lat: number, lon: number) => [(lon - lon0) * kx / M_PER_UNIT + W / 2, (lat0 - lat) * ky / M_PER_UNIT + H / 2];
  const toLatLon = (x: number, y: number): [number, number] => [lat0 - (y - H / 2) * M_PER_UNIT / ky, lon0 + (x - W / 2) * M_PER_UNIT / kx];
  // The circle plus a ring of scenery. Less ring means a smaller, faster download.
  const reach = PLAY_R * (BATTLE_KM === 1 ? 1.35 : BATTLE_KM === 2 ? 1.2 : 1.1);
  const [n, w] = toLatLon(CX - reach, CX - reach), [s, e] = toLatLon(CX + reach, CX + reach);
  const bb = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  const key = `osm4:${lat0.toFixed(4)},${lon0.toFixed(4)}:${BATTLE_KM}:${place.rel || ''}`;
  const cached = await cacheGet<{ osm: any; dem: Float32Array | null; credit: string; rel?: string }>(key);
  let osm = cached?.osm, dem = cached?.dem ?? null, credit = cached?.credit || '';
  if (cached?.rel) place.rel = cached.rel;
  if (!osm) {
    const q = `[out:json][timeout:180][maxsize:536870912];(
way["building"](${bb});relation["building"](${bb});
way["highway"](${bb});way["railway"="rail"](${bb});
way["barrier"~"^(hedge|wall|city_wall|fence)$"](${bb});node["barrier"~"^(gate|kissing_gate|stile|swing_gate|lift_gate)$"](${bb});
node["natural"="tree"](${bb});way["natural"="tree_row"](${bb});
way["natural"~"^(water|wood|scrub|wetland)$"](${bb});relation["natural"~"^(water|wood)$"](${bb});
way["waterway"~"^(river|riverbank|canal|stream|dock)$"](${bb});relation["waterway"="riverbank"](${bb});
way["landuse"~"^(forest|grass|meadow|farmland|orchard|recreation_ground|cemetery|village_green|allotments|reservoir|basin|residential|industrial|commercial|retail)$"](${bb});
relation["landuse"~"^(forest|farmland|meadow|grass|reservoir|basin)$"](${bb});
way["leisure"~"^(park|garden|pitch|golf_course|common)$"](${bb});relation["leisure"="park"](${bb});
);out geom;`;
    // Overture first: OpenStreetMap plus machine-learned buildings, hedges, walls and trees.
    // Then OpenFreeMap tiles (OpenStreetMap only, fewer details), then the Overpass servers.
    let mapCredit = OVERTURE_CREDIT, rel: string | undefined;
    try { const o = await fetchOverture(s, w, n, e, place.rel, progress); osm = o; rel = o.rel; }
    catch (err) {
      console.warn('Overture failed, using OpenStreetMap tiles', err);
      mapCredit = '© OpenStreetMap contributors';
      try { osm = await fetchTiles(s, w, n, e, progress); if (!osm.elements.length) throw new Error('empty'); }
      catch { osm = await overpass(q, progress); }
    }
    let hCredit = '';
    try { const r = await elevationGrid(toLatLon, progress); dem = r.dem; hCredit = r.credit; } catch { dem = null; }
    credit = `Map data: ${mapCredit}.${hCredit ? ` Elevation: ${hCredit}.` : ''}`;
    await cachePut(key, { osm, dem, credit, rel });
    if (rel) { place.rel = rel; await cachePut(`osm4:${lat0.toFixed(4)},${lon0.toFixed(4)}:${BATTLE_KM}:${rel}`, { osm, dem, credit, rel }); }
  }
  progress('Building the map');
  const conv = (geom: any[]) => geom.map((p: any) => toUnits(p.lat, p.lon));
  const water: number[][][][] = [], wood: number[][][][] = [], park: number[][][][] = [], farm: number[][][][] = [], built: { k: string; rings: number[][][] }[] = [];
  const coverWood: number[][][][] = [], coverFarm: number[][][][] = [], wet: number[][][][] = [];
  const roads: { pts: number[][]; w: number; bridge: boolean; dirt: boolean }[] = [], paths: number[][][] = [], rivers: { pts: number[][]; w: number }[] = [], streams: number[][][] = [], rails: number[][][] = [];
  const fences: { k: number; pts: number[][] }[] = [], gates: number[][] = [], trees: number[][] = [], wallLines: { pts: number[][]; city: boolean }[] = [];
  const B: Building[] = [];
  // Single trees shrink in bigger battles, so street trees do not bury the town.
  const TREE_K = Math.sqrt(2.5 / M_PER_UNIT);
  const inMap = (p: number[]) => p[0] > -10 && p[1] > -10 && p[0] < W + 10 && p[1] < H + 10;
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    if (el.type === 'node') {
      const p = toUnits(el.lat, el.lon); if (!inMap(p)) continue;
      if (t.natural === 'tree') trees.push([p[0], p[1], (3 + hashf(el.id % 100000, 4, 1) * 3.5) * TREE_K]);
      else if (t.barrier) gates.push(p);
      continue;
    }
    let rings: number[][][] = [];
    if (el.type === 'way' && el.geometry) rings = [conv(el.geometry)];
    else if (el.type === 'relation' && el.members) {
      const outer = el.members.filter((m: any) => m.geometry && m.role !== 'inner').map((m: any) => conv(m.geometry));
      const inner = el.members.filter((m: any) => m.geometry && m.role === 'inner').map((m: any) => conv(m.geometry));
      rings = joinRings(outer).concat(joinRings(inner));
    }
    if (!rings.length) continue;
    if (t.building && t.building !== 'no') {
      let ring = rings[0].slice(); if (ring.length > 3 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-3) ring.pop();
      ring = cleanRing(ring);
      if (ring.length < 3 || ring.some(p => p[0] < -5 || p[1] < -5 || p[0] > W + 5 || p[1] > H + 5)) continue;
      let ar = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; ar += a[0] * c[1] - c[0] * a[1]; }
      if (Math.abs(ar) / 2 < 1.2) continue; // smaller than about one cell: sheds and kiosks at large battle sizes
      const r = hashf(el.id % 100000, 7, 3);
      const bt = btypeFromTags(t), BT = BTYPES[bt];
      // A castle part with no height in the data: a keep stands about 25 m tall, other towers 12 to 18 m, so they are
      // not all the same.
      let hm = Math.max(buildingHeight(t, r), BT.minH || 0); if (bt === 'castle' && !t.height && !t['building:levels']) hm = Math.max(hm, KEEP_NAME.test(t.name || '') ? 25 : 12 + r * 6);
      B.push({ p: ring, h: hm / M_PER_UNIT, v: r, mat: bt === 'house' || bt === 'flats' ? buildingColour(t, hashf(el.id % 100000, 2, 9)) : BT.roof, btype: bt, name: t.name });
    } else if (t.highway) {
      if (t.tunnel && t.tunnel !== 'no') continue;
      if (PATHS.has(t.highway)) { paths.push(rings[0]); continue; }
      const m = ROAD_M[t.highway]; if (!m) continue;
      roads.push({ pts: rings[0], w: m / M_PER_UNIT, bridge: !!t.bridge && t.bridge !== 'no', dirt: t.highway === 'track' || UNPAVED.has(t.surface) });
    } else if (t.railway === 'rail') { if (!(t.tunnel && t.tunnel !== 'no')) rails.push(rings[0]); }
    else if (t.barrier === 'hedge') fences.push({ k: F_HEDGE, pts: rings[0] });
    // Walls become thin, straight buildings once the roads are known (see wallBuildings).
    else if (t.barrier === 'wall' || t.barrier === 'city_wall') wallLines.push({ pts: rings[0], city: t.barrier === 'city_wall' || t.historic === 'citywalls' });
    else if (t.barrier === 'fence') fences.push({ k: F_FENCE, pts: rings[0] });
    else if (t.natural === 'tree_row') {
      // A tree about every 8 m along the row.
      const r = rings[0], step = Math.max(1.6, 8 / M_PER_UNIT);
      for (let i = 0; i < r.length - 1; i++) { const a = r[i], b = r[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d < L; d += step) { const x = a[0] + (b[0] - a[0]) * d / L, y = a[1] + (b[1] - a[1]) * d / L; if (inMap([x, y])) trees.push([x, y, (3 + hashf(x, y, 8) * 3) * TREE_K]); } }
    }
    else if (t.waterway === 'river' || t.waterway === 'canal') rivers.push({ pts: rings[0], w: (t.waterway === 'river' ? 14 : 9) / M_PER_UNIT });
    else if (t.waterway === 'stream') streams.push(rings[0]);
    else if (t.natural === 'wetland') wet.push(rings);
    else if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock' || t.landuse === 'reservoir' || t.landuse === 'basin') water.push(rings);
    else if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest' || t.landuse === 'orchard') wood.push(rings);
    else if (t.landuse === 'farmland' || t.landuse === 'meadow') farm.push(rings);
    else if (t.landuse && BUILT_LU.has(t.landuse)) built.push({ k: t.landuse, rings });
    else if (t.cover === 'forest') coverWood.push(rings);
    else if (t.cover === 'crop' || t.cover === 'grass') coverFarm.push(rings);
    else if (t.leisure || t.landuse) park.push(rings);
  }

  const polys = (g: CanvasRenderingContext2D, list: number[][][][]) => { for (const rings of list) { g.beginPath(); for (const r of rings) { r.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); } g.fill('evenodd'); } };
  const lines = (g: CanvasRenderingContext2D, list: number[][][], w: number) => { g.lineWidth = w; for (const l of list) { g.beginPath(); l.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); } };
  const mask = (draw: (g: CanvasRenderingContext2D) => void, cut = 60) => {
    const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / C, 0, 0, 1 / C, 0, 0); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round'; draw(g);
    const d = g.getImageData(0, 0, GW, GH).data, m = new Uint8Array(GW * GH); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > cut ? 1 : 0; return m;
  };
  const mWater = mask(g => { polys(g, water); for (const r of rivers) lines(g, [r.pts], r.w); });
  const mRoad = mask(g => { for (const r of roads) lines(g, [r.pts], Math.max(r.w, C * .9)); });
  const mBridge = mask(g => { for (const r of roads) if (r.bridge) lines(g, [r.pts], Math.max(r.w, C) + 1); });
  const mWood = mask(g => polys(g, wood)), mPark = mask(g => polys(g, park)), mFarm = mask(g => polys(g, farm));
  // Land cover from satellite images fills woods and fields only where the mapped data has nothing,
  // and never in built-up land or near buildings, where it would turn gardens into forest.
  const mBuilt = mask(g => { for (const b of built) polys(g, [b.rings]); g.lineWidth = 24 / M_PER_UNIT; for (const b of B) { g.beginPath(); b.p.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); g.stroke(); } });
  const mCWood = mask(g => polys(g, coverWood), 140), mCFarm = mask(g => polys(g, coverFarm), 140);
  const terr = new Uint8Array(GW * GH);
  for (let i = 0; i < terr.length; i++) {
    const free = !mWood[i] && !mPark[i] && !mFarm[i] && !mBuilt[i];
    if (free && mCWood[i]) mWood[i] = 1; else if (free && mCFarm[i]) mFarm[i] = 1;
    terr[i] = mBridge[i] && mWater[i] ? T_BRIDGE : mWater[i] ? T_WATER : mRoad[i] ? T_ROAD : mWood[i] ? T_WOOD : mPark[i] ? T_PARK : T_GROUND;
  }
  // Walls: straight thin buildings along the mapped lines, broken where roads, water and gates cross them.
  B.push(...wallBuildings(wallLines, gates, ci => terr[ci] === T_ROAD || terr[ci] === T_WATER || terr[ci] === T_BRIDGE));
  // A historic battlefield: remove the buildings that did not exist at the time of the battle, so the field looks
  // more like it did. Before 1946: no offices, factories, supermarkets or tall blocks. Before 1830: no railway stations
  // and no blocks of flats.
  const year = +((place as any).year || 0);
  if (year) {
    const modern = (b: Building) => {
      if (b.btype === 'church' || b.btype === 'castle' || b.btype === 'rampart' || b.btype === 'wall' || b.btype === 'tower' || b.btype === 'townhall') return false;
      let a = 0; for (let i = 0; i < b.p.length; i++) { const p = b.p[i], q = b.p[(i + 1) % b.p.length]; a += p[0] * q[1] - q[0] * p[1]; }
      const m2 = Math.abs(a) / 2 * M_PER_UNIT * M_PER_UNIT, hm = b.h * M_PER_UNIT;
      if (year < 1946 && (b.btype === 'office' || b.btype === 'industrial' || hm > 24 || (b.btype === 'shop' && m2 > 1200) || m2 > 4000)) return true;
      if (year < 1830 && (b.btype === 'station' || b.btype === 'flats')) return true;
      return false;
    };
    for (let i = B.length - 1; i >= 0; i--) if (modern(B[i])) B.splice(i, 1);
  }
  // Hedges and fences on the cell grid: about one cell wide, with gaps at gates.
  const feat = new Uint8Array(GW * GH);
  for (const k of [F_FENCE, F_HEDGE, F_WALL]) {
    if (!fences.some(f => f.k === k)) continue;
    const m = mask(g => { for (const f of fences) if (f.k === k) lines(g, [f.pts], C * .95); g.globalCompositeOperation = 'destination-out'; for (const p of gates) { g.beginPath(); g.arc(p[0], p[1], C * 1.3, 0, 7); g.fill(); } }, 90);
    for (let i = 0; i < feat.length; i++) if (m[i] && terr[i] !== T_WATER && terr[i] !== T_BRIDGE && terr[i] !== T_ROAD) feat[i] = k;
  }

  const VW = GW + 1, VH = GH + 1, baseH = new Float32Array(VW * VH).fill(3);
  if (dem) {
    let lo = 1e9, hi = -1e9; for (const v of dem) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    // True scale, the same as buildings and distances. Only very steep ground (over 150 m of rise) is squashed to fit.
    const k = Math.min(1 / M_PER_UNIT, 60 / Math.max(1, hi - lo));
    for (let i = 0; i < baseH.length; i++) baseH[i] = 3 + (dem[i] - lo) * k;
  }
  const BUILT_COL: Record<string, string> = { residential: 'rgba(120,112,98,.22)', commercial: 'rgba(122,114,110,.3)', retail: 'rgba(122,114,110,.3)', industrial: 'rgba(104,106,108,.38)' };
  const paintOver = (g: CanvasRenderingContext2D) => {
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const b of built) { g.fillStyle = BUILT_COL[b.k] || BUILT_COL.residential; polys(g, [b.rings]); }
    g.fillStyle = 'rgba(84,106,62,.55)'; polys(g, park);
    g.fillStyle = 'rgba(70,92,52,.45)'; polys(g, wet);
    g.fillStyle = 'rgba(50,86,106,.9)'; polys(g, water); g.strokeStyle = 'rgba(50,86,106,.9)'; for (const r of rivers) lines(g, [r.pts], r.w);
    g.strokeStyle = 'rgba(70,104,118,.8)'; lines(g, streams, 1.2);
    g.strokeStyle = 'rgba(96,92,80,.9)'; lines(g, paths, .7);
    // Railways: a gravel bed with dark sleepers and a rail line.
    g.strokeStyle = '#6b655a'; lines(g, rails, Math.max(1.2, 5 / M_PER_UNIT));
    g.strokeStyle = '#3e3a33'; g.setLineDash([.22, .38]); lines(g, rails, Math.max(.7, 2.6 / M_PER_UNIT)); g.setLineDash([]);
    g.strokeStyle = '#8a857a'; lines(g, rails, Math.max(.25, .8 / M_PER_UNIT));
    // Dirt roads and tracks are brown; paved roads dark.
    g.strokeStyle = '#3a3832'; for (const r of roads) if (!r.dirt) lines(g, [r.pts], r.w + .5);
    g.strokeStyle = '#5e5240'; for (const r of roads) if (r.dirt) lines(g, [r.pts], r.w + .3);
    g.strokeStyle = '#4a4740'; for (const r of roads) if (!r.dirt) lines(g, [r.pts], Math.max(.5, r.w - .6));
    g.strokeStyle = '#7a6a4f'; for (const r of roads) if (r.dirt) lines(g, [r.pts], Math.max(.4, r.w - .7));
    g.strokeStyle = '#686254'; for (const r of roads) if (r.bridge) lines(g, [r.pts], r.w);
  };
  const lineFeats = fences.filter(f => f.pts.some(p => inMap(p)));
  return { seed: Math.floor(Math.abs(lat0 * 1000 + lon0 * 1000)) % 100000, name: place.name.toUpperCase(), source: 'osm', credit, hist: place.hist, terr, baseH, B, farm: mFarm, paintOver, feat, fences: lineFeats, trees };
}
