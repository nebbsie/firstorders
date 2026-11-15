// Game rules and tuning. One map unit is 2.5 m. The map is 560 x 560 units (1.4 km square).
// Battles happen inside a circle of radius 200 units (1 km across); the ring outside is scenery only.
export const W = 560, H = 560, C = 2, GW = W / C, GH = H / C, GS = 2;
export const CX = W / 2, CY = H / 2, PLAY_R = 200;
export const inPlay = (x: number, y: number, margin = 0) => (x - CX) ** 2 + (y - CY) ** 2 <= (PLAY_R - margin) ** 2;
export function clampPlay(x: number, y: number, margin = 6) { const dx = x - CX, dy = y - CY, d = Math.hypot(dx, dy), r = PLAY_R - margin; return d <= r ? { x, y } : { x: CX + dx / d * r, y: CY + dy / d * r }; }
export const M_PER_UNIT = 2.5;
// A battle runs phase after phase until one HQ is left. PHASES is a safety limit.
export const DT = 0.05, BUDGET = 1500, PHASES = 8, PHASE_LEN = 60, HS = 0.3, HQ_HOLD = 5;
// Ground-control grid: 4 x 4 unit cells.
export const IW = 140, IH = 140, IC = 4;

export const TEAM_COLORS = ['#5aa8e6', '#ff7a72', '#e8c547', '#6ad38a', '#b48cff', '#5fd6d0'];
export const TEAM_NAMES = ['BLUE', 'RED', 'GOLD', 'GREEN', 'VIOLET', 'CYAN'];
export const CALLSIGNS = ['ABLE', 'BAKER', 'CHARLIE', 'DOG', 'EASY', 'FOX', 'GEORGE', 'HOW', 'ITEM', 'JIG', 'KING', 'LOVE', 'MIKE', 'NAN', 'OBOE', 'PETER', 'QUEEN', 'ROGER', 'SUGAR', 'TARE'];
export const TRGB = TEAM_COLORS.map(c => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]);

export const COST: Record<string, number> = { trench: 5, wire: 2, sandbag: 3, wall: 8, tanktrap: 6, rifles: 100, garrison: 110, mg: 80, mortar: 90, sniper: 60, at: 90, tank: 220, op: 70, air: 250, barrage: 120, para: 200, demo: 80, spy: 100 };
export const T_GROUND = 0, T_ROAD = 1, T_PARK = 2, T_WATER = 3, T_BRIDGE = 4, T_BUILD = 5, T_WOOD = 6;
export const COV: Record<string, number> = { sandbag: 1, trench: 2, wall: 3, wire: 4, tanktrap: 5 };

export interface KindStats { hp: number; range: number; cd: number; acc?: number; speed: number; min?: number; veh?: boolean; sight: number }
export const K: Record<string, KindStats> = {
  rifle: { hp: 1, range: 48, cd: 1.2, acc: .2, speed: 5.5, sight: 60 },
  mg: { hp: 3, range: 74, cd: .13, acc: .085, speed: 0, sight: 70 },
  mortar: { hp: 2, range: 155, min: 26, cd: 4.6, speed: 0, sight: 35 },
  sniper: { hp: 1, range: 118, cd: 2.8, acc: .7, speed: 5, sight: 120 },
  tank: { hp: 10, range: 70, cd: 3.2, acc: .55, speed: 4.5, veh: true, sight: 55 },
  at: { hp: 2, range: 85, cd: 3, acc: .5, speed: 0, sight: 60 },
  op: { hp: 1, range: 0, cd: 99, speed: 0, sight: 0 },
};
export const SPY_RADIUS = 55;

export type ToolMode = 'line' | 'point' | 'order' | 'select';
export const TOOLS: { g: string; items: [string, string, ToolMode, string][] }[] = [
  { g: 'DEFENCES', items: [
    ['trench', 'TRENCH', 'line', 'Drag a line on your ground. Strong cover from bullets. Best in open ground.'],
    ['wire', 'WIRE', 'line', 'Drag a line on your ground. Infantry cross at a third of the speed. Tanks drive over it.'],
    ['sandbag', 'SANDBAGS', 'line', 'Drag a line on your ground. Light, cheap cover.'],
    ['wall', 'WALL', 'line', 'Drag a line on your ground. Blocks movement and sight.'],
    ['tanktrap', 'TANK TRAPS', 'line', 'Drag a line on your ground. Stops tanks. Infantry walk through. Put them across roads.']] },
  { g: 'UNITS', items: [
    ['rifles', 'RIFLES', 'point', 'Click on your ground to place a platoon of 16. Takes orders.'],
    ['garrison', 'GARRISON', 'point', 'Click a building on your ground. Ten riflemen hold it: 85% cover, they fire from the roof. They never move.'],
    ['mg', 'MG NEST', 'point', 'Click on your ground. Fast, long, inaccurate fire. Hidden in woods.'],
    ['mortar', 'MORTAR', 'point', 'Click on your ground. Fires at enemies your side can see.'],
    ['sniper', 'SNIPER', 'point', 'Click on your ground. One sniper. Sees and shoots far. Takes orders.'],
    ['at', 'AT GUN', 'point', 'Click on your ground. Fires only at tanks. Range 85.'],
    ['tank', 'TANK', 'point', 'Click on your ground. Fast on roads, slow in woods, stopped by tank traps. Takes orders. Only AT guns, shells, bombs and tanks hurt it.'],
    ['op', 'OBS POST', 'point', 'Click on your ground, ideally high ground. Sees far, spots for mortars and makes artillery more accurate.']] },
  { g: 'SUPPORT', items: [
    ['spy', 'SPY PLANE', 'line', 'Drag the flight path anywhere. It sees everything within 55 of its path while it flies.'],
    ['barrage', 'ARTILLERY', 'point', 'Click anywhere. Twelve shells land at the time you set.'],
    ['air', 'AIR STRIKE', 'line', 'Drag the bomb run anywhere.'],
    ['para', 'PARADROP', 'point', 'Click anywhere. Sixteen riflemen land and hold the ground.'],
    ['demo', 'DEMOLISH', 'point', 'Click a bridge with one end on your ground. It blows at the time you set.']] },
  { g: 'ORDERS', items: [
    ['attack', 'ATTACK', 'order', 'With platoons, snipers or tanks selected, click the ground to take. Or drag from one of them.'],
    ['defend', 'DEFEND', 'order', 'With platoons, snipers or tanks selected, click the ground to hold. Infantry use trenches there.']] },
];
export const TOOLDEF: Record<string, { id: string; name: string; mode: ToolMode; tip: string }> = {};
TOOLS.forEach(g => g.items.forEach(t => TOOLDEF[t[0]] = { id: t[0], name: t[1], mode: t[2], tip: t[3] }));
TOOLDEF.select = { id: 'select', name: 'SELECT', mode: 'select', tip: '' };
export const KIND_NAME: Record<string, string> = { rifles: 'Platoon', garrison: 'Garrison', mg: 'MG nest', mortar: 'Mortar', sniper: 'Sniper', tank: 'Tank', at: 'AT gun', op: 'Obs post' };
export const SUP_NAME: Record<string, string> = { barrage: 'ARTILLERY', air: 'AIR', para: 'PARA', demo: 'DEMOLISH', spy: 'SPY' };
export const PERS = [
  { label: 'CAUTIOUS', aggr: .25, arty: .4 },
  { label: 'BALANCED', aggr: .5, arty: .45 },
  { label: 'AGGRESSIVE', aggr: .85, arty: .3 },
  { label: 'GUNNER', aggr: .45, arty: .85 },
];

export const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
export const mod = (a: number, b: number) => ((a % b) + b) % b;
// Map grid references over the battle circle: columns A to K (no I), rows 1 to 10, 40 units a square.
export const GRID_X0 = CX - PLAY_R, GRID_Y0 = CY - PLAY_R;
export const grid = (x: number, y: number) => 'ABCDEFGHJK'[clamp(Math.floor((x - GRID_X0) / 40), 0, 9)] + (clamp(Math.floor((y - GRID_Y0) / 40), 0, 9) + 1);
export const fmtT = (t: number) => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const vx = b.x - a.x, vy = b.y - a.y, l = vx * vx + vy * vy || 1, t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l, 0, 1);
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}
export function mulberry32(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function makeNoise(r: () => number) {
  const p = new Float32Array(65536); for (let i = 0; i < 65536; i++) p[i] = r();
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = p[y0 | x0], b = p[y0 | x1], c = p[y1 | x0], d = p[y1 | x1];
    return a + (b - a) * u + (c - a + (d - c - b + a) * u) * v;
  };
}
export const hashf = (a: number, b: number, c: number) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); };
