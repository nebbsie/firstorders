import { W, H, C, GW, GH, M_PER_UNIT, BATTLE_KM, CX, PLAY_R, T_GROUND, T_ROAD, T_PARK, T_WATER, T_BRIDGE, T_WOOD, hashf } from '../config';
import type { RawMap, Building } from './types';
import { cacheGet, cachePut } from './cache';
import { fetchTiles } from './tiles';
import { BTYPES, btypeFromTags } from './btypes';

export interface Place { name: string; full: string; lat: number; lon: number }

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

// Terrarium elevation tiles: height in metres = R * 256 + G + B / 256 - 32768.
async function elevationGrid(lat0: number, lon0: number, toLatLon: (x: number, y: number) => [number, number], progress: (s: string) => void) {
  const z = BATTLE_KM > 1 ? 14 : 15, n = 2 ** z * 256;
  const px = (lon: number) => (lon + 180) / 360 * n;
  const py = (lat: number) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };
  const [la0, lo0] = toLatLon(0, 0), [la1, lo1] = toLatLon(W, H);
  const tx0 = Math.floor(px(lo0) / 256), tx1 = Math.floor(px(lo1) / 256), ty0 = Math.floor(py(la0) / 256), ty1 = Math.floor(py(la1) / 256);
  const cw = (tx1 - tx0 + 1) * 256, ch = (ty1 - ty0 + 1) * 256, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true });
  progress('Downloading terrain heights');
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { g.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256); res(); };
    img.onerror = () => rej(new Error('terrain tile'));
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
  }));
  await Promise.all(jobs);
  const d = g.getImageData(0, 0, cw, ch).data;
  const e = (x: number, y: number) => { x = Math.max(0, Math.min(cw - 1, x)); y = Math.max(0, Math.min(ch - 1, y)); const i = (y * cw + x) * 4; return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768; };
  const VW = GW + 1, VH = GH + 1, out = new Float32Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
    const [la, lo] = toLatLon(i * C, j * C), fx = px(lo) - tx0 * 256, fy = py(la) - ty0 * 256, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    out[j * VW + i] = e(ix, iy) * (1 - u) * (1 - v) + e(ix + 1, iy) * u * (1 - v) + e(ix, iy + 1) * (1 - u) * v + e(ix + 1, iy + 1) * u * v;
  }
  return out;
}

const ROAD_M: Record<string, number> = { motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 9, residential: 7, unclassified: 7, living_street: 6, service: 5, track: 4, motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7, pedestrian: 6 };
const PATHS = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'corridor']);
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
  // Fetch the battle circle and a ring around it. Bigger battles fetch less of the grey ring to keep the download sane.
  // The circle plus a ring of scenery. Less ring means a smaller, faster download.
  const reach = PLAY_R * (BATTLE_KM === 1 ? 1.35 : BATTLE_KM === 2 ? 1.2 : 1.1);
  const [n, w] = toLatLon(CX - reach, CX - reach), [s, e] = toLatLon(CX + reach, CX + reach);
  const bb = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  const key = `osm3:${lat0.toFixed(4)},${lon0.toFixed(4)}:${BATTLE_KM}`;
  let cached = await cacheGet<{ osm: any; dem: Float32Array | null }>(key);
  let osm = cached?.osm, dem = cached?.dem ?? null;
  if (!osm) {
    const q = `[out:json][timeout:180][maxsize:536870912];(
way["building"](${bb});relation["building"](${bb});
way["highway"](${bb});
way["natural"~"^(water|wood|scrub|wetland)$"](${bb});relation["natural"~"^(water|wood)$"](${bb});
way["waterway"~"^(river|riverbank|canal|stream|dock)$"](${bb});relation["waterway"="riverbank"](${bb});
way["landuse"~"^(forest|grass|meadow|farmland|orchard|recreation_ground|cemetery|village_green|allotments|reservoir|basin)$"](${bb});
relation["landuse"~"^(forest|farmland|meadow|grass|reservoir|basin)$"](${bb});
way["leisure"~"^(park|garden|pitch|golf_course|nature_reserve|common)$"](${bb});relation["leisure"="park"](${bb});
);out geom;`;
    // Fast path: OpenFreeMap tiles. If they fail, ask the Overpass servers.
    try { osm = await fetchTiles(s, w, n, e, progress); if (!osm.elements.length) throw new Error('empty'); }
    catch { osm = await overpass(q, progress); }
    try { dem = await elevationGrid(lat0, lon0, toLatLon, progress); } catch { dem = null; }
    await cachePut(key, { osm, dem });
  }
  progress('Building the map');
  const conv = (geom: any[]) => geom.map((p: any) => toUnits(p.lat, p.lon));
  const water: number[][][][] = [], wood: number[][][][] = [], park: number[][][][] = [], farm: number[][][][] = [];
  const roads: { pts: number[][]; w: number; bridge: boolean }[] = [], paths: number[][][] = [], rivers: { pts: number[][]; w: number }[] = [], streams: number[][][] = [];
  const B: Building[] = [];
  for (const el of osm.elements || []) {
    const t = el.tags || {};
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
      B.push({ p: ring, h: Math.max(buildingHeight(t, r), BT.minH || 0) / M_PER_UNIT, v: r, mat: bt === 'house' || bt === 'flats' ? buildingColour(t, hashf(el.id % 100000, 2, 9)) : BT.roof, btype: bt, name: t.name });
    } else if (t.highway) {
      if (t.tunnel && t.tunnel !== 'no') continue;
      if (PATHS.has(t.highway)) { paths.push(rings[0]); continue; }
      const m = ROAD_M[t.highway]; if (!m) continue;
      roads.push({ pts: rings[0], w: m / M_PER_UNIT, bridge: !!t.bridge && t.bridge !== 'no' });
    } else if (t.waterway === 'river' || t.waterway === 'canal') rivers.push({ pts: rings[0], w: (t.waterway === 'river' ? 14 : 9) / M_PER_UNIT });
    else if (t.waterway === 'stream') streams.push(rings[0]);
    else if (t.natural === 'water' || t.natural === 'wetland' || t.waterway === 'riverbank' || t.waterway === 'dock' || t.landuse === 'reservoir' || t.landuse === 'basin') water.push(rings);
    else if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest' || t.landuse === 'orchard') wood.push(rings);
    else if (t.landuse === 'farmland' || t.landuse === 'meadow') farm.push(rings);
    else if (t.leisure || t.landuse) park.push(rings);
  }

  const polys = (g: CanvasRenderingContext2D, list: number[][][][]) => { for (const rings of list) { g.beginPath(); for (const r of rings) { r.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); } g.fill('evenodd'); } };
  const lines = (g: CanvasRenderingContext2D, list: number[][][], w: number) => { g.lineWidth = w; for (const l of list) { g.beginPath(); l.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); } };
  const mask = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / C, 0, 0, 1 / C, 0, 0); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round'; draw(g);
    const d = g.getImageData(0, 0, GW, GH).data, m = new Uint8Array(GW * GH); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 60 ? 1 : 0; return m;
  };
  const mWater = mask(g => { polys(g, water); for (const r of rivers) lines(g, [r.pts], r.w); });
  const mRoad = mask(g => { for (const r of roads) lines(g, [r.pts], Math.max(r.w, C * .9)); });
  const mBridge = mask(g => { for (const r of roads) if (r.bridge) lines(g, [r.pts], Math.max(r.w, C) + 1); });
  const mWood = mask(g => polys(g, wood)), mPark = mask(g => polys(g, park)), mFarm = mask(g => polys(g, farm));
  const terr = new Uint8Array(GW * GH);
  for (let i = 0; i < terr.length; i++) terr[i] = mBridge[i] && mWater[i] ? T_BRIDGE : mWater[i] ? T_WATER : mRoad[i] ? T_ROAD : mWood[i] ? T_WOOD : mPark[i] ? T_PARK : T_GROUND;

  const VW = GW + 1, VH = GH + 1, baseH = new Float32Array(VW * VH).fill(3);
  if (dem) {
    let lo = 1e9, hi = -1e9; for (const v of dem) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    // True scale, the same as buildings and distances. Only very steep ground (over 150 m of rise) is squashed to fit.
    const k = Math.min(1 / M_PER_UNIT, 60 / Math.max(1, hi - lo));
    for (let i = 0; i < baseH.length; i++) baseH[i] = 3 + (dem[i] - lo) * k;
  }
  const paintOver = (g: CanvasRenderingContext2D) => {
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.fillStyle = 'rgba(84,106,62,.55)'; polys(g, park);
    g.fillStyle = 'rgba(50,86,106,.9)'; polys(g, water); g.strokeStyle = 'rgba(50,86,106,.9)'; for (const r of rivers) lines(g, [r.pts], r.w);
    g.strokeStyle = 'rgba(70,104,118,.8)'; lines(g, streams, 1.2);
    g.strokeStyle = 'rgba(96,92,80,.9)'; lines(g, paths, .7);
    g.strokeStyle = '#3a3832'; for (const r of roads) lines(g, [r.pts], r.w + .5);
    g.strokeStyle = '#4a4740'; for (const r of roads) lines(g, [r.pts], Math.max(.5, r.w - .6));
    g.strokeStyle = '#686254'; for (const r of roads) if (r.bridge) lines(g, [r.pts], r.w);
  };
  return { seed: Math.floor(Math.abs(lat0 * 1000 + lon0 * 1000)) % 100000, name: place.name.toUpperCase(), source: 'osm', credit: '© OpenStreetMap contributors · Elevation: AWS Terrain Tiles', terr, baseH, B, farm: mFarm, paintOver };
}
