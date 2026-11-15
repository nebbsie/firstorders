// Game rules and tuning. One map unit is 2.5 m. The map is 560 x 560 units (1.4 km square).
// Battles happen inside a circle of radius 200 units (1 km across); the ring outside is scenery only.
export const W = 560, H = 560, C = 2, GW = W / C, GH = H / C, GS = 4;
export const CX = W / 2, CY = H / 2, PLAY_R = 200;
export const inPlay = (x: number, y: number, margin = 0) => (x - CX) ** 2 + (y - CY) ** 2 <= (PLAY_R - margin) ** 2;
export function clampPlay(x: number, y: number, margin = 6) { const dx = x - CX, dy = y - CY, d = Math.hypot(dx, dy), r = PLAY_R - margin; return d <= r ? { x, y } : { x: CX + dx / d * r, y: CY + dy / d * r }; }
// Battle size: 1, 2 or 3 km across. The grid stays the same; a bigger battle puts more metres in each unit.
export let M_PER_UNIT = 2.5, BATTLE_KM = 1;
export function setBattleSize(km: number) { BATTLE_KM = km; M_PER_UNIT = 2.5 * km; }
// A battle runs phase after phase until one HQ is left. PHASES is a safety limit.
export const DT = 0.05, BUDGET = 500, PHASES = 10, PHASE_LEN = 60, HS = 0.3, HQ_HOLD = 40;
// Ground-control grid: 4 x 4 unit cells.
export const IW = 140, IH = 140, IC = 4;

export const TEAM_COLORS = ['#5aa8e6', '#ff7a72', '#e8c547', '#6ad38a', '#b48cff', '#5fd6d0'];
export const TEAM_NAMES = ['BLUE', 'RED', 'GOLD', 'GREEN', 'VIOLET', 'CYAN'];
export const CALLSIGNS = ['ABLE', 'BAKER', 'CHARLIE', 'DOG', 'EASY', 'FOX', 'GEORGE', 'HOW', 'ITEM', 'JIG', 'KING', 'LOVE', 'MIKE', 'NAN', 'OBOE', 'PETER', 'QUEEN', 'ROGER', 'SUGAR', 'TARE'];
export const TRGB = TEAM_COLORS.map(c => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]);

export const COST: Record<string, number> = { trench: 5, wire: 2, sandbag: 3, wall: 8, tanktrap: 6, rifles: 100, assault: 130, engineers: 120, medics: 90, garrison: 110, mg: 90, mortar: 120, sniper: 70, at: 110, tank: 320, op: 80, fob: 150, air: 480, barrage: 340, para: 400, demo: 160, spy: 180, smoke: 90 };
// Upkeep: supply each unit costs at the end of every phase, in proportion to the men still alive.
// A big army eats the income, so every unit bought is a cost you keep paying.
export const UPKEEP: Record<string, number> = { rifles: 15, assault: 20, engineers: 15, medics: 10, garrison: 12, mg: 10, mortar: 15, sniper: 8, at: 12, tank: 45, op: 6, fob: 20 };
export const T_GROUND = 0, T_ROAD = 1, T_PARK = 2, T_WATER = 3, T_BRIDGE = 4, T_BUILD = 5, T_WOOD = 6;
export const COV: Record<string, number> = { sandbag: 1, trench: 2, wall: 3, wire: 4, tanktrap: 5 };

// arc: a unit with an arc (the sniper) sees and shoots only inside a cone that wide, in radians, round the way it faces.
export interface KindStats { hp: number; range: number; cd: number; acc?: number; speed: number; min?: number; veh?: boolean; sight: number; arc?: number; salvo?: number; reload?: number }
export const K: Record<string, KindStats> = {
  // Speeds are map units a second. A phase is 60 s: riflemen walk about 50 in one, tanks about 100 (more on roads).
  rifle: { hp: 1, range: 48, cd: 1.2, acc: .16, speed: .85, sight: 60 },
  mg: { hp: 3, range: 74, cd: .13, acc: .07, speed: 0, sight: 70 },
  mortar: { hp: 2, range: 155, min: 26, cd: 4, salvo: 2, reload: 32, speed: 0, sight: 35 },
  sniper: { hp: 1, range: 118, cd: 2.8, acc: .6, speed: .8, sight: 120, arc: 1.22 },
  assault: { hp: 1, range: 30, cd: .5, acc: .16, speed: .95, sight: 55 },
  engineer: { hp: 1, range: 40, cd: 1.3, acc: .13, speed: .75, sight: 55 },
  medic: { hp: 1, range: 30, cd: 1.6, acc: .08, speed: .85, sight: 55 },
  tank: { hp: 10, range: 70, cd: 4.5, acc: .5, speed: 1.65, veh: true, sight: 42 },
  at: { hp: 2, range: 85, cd: 3, acc: .5, speed: 0, sight: 60 },
  op: { hp: 1, range: 0, cd: 99, speed: 0, sight: 0 },
  fob: { hp: 14, range: 0, cd: 99, speed: 0, sight: 30 },
};
export const SPY_RADIUS = 55;

export type ToolMode = 'line' | 'point' | 'aim' | 'order' | 'select';
// Platoons: the infantry squads that take orders. Each maps to the kind of soldier it holds.
export const PLATOONS = ['rifles', 'assault', 'engineers', 'medics'];
export const MOVERS = [...PLATOONS, 'sniper', 'tank'];
export const PLATOON_SIZE: Record<string, number> = { rifles: 16, assault: 16, engineers: 12, medics: 8 };
export const unitKind = (sq: string) => ({ rifles: 'rifle', garrison: 'rifle', assault: 'assault', engineers: 'engineer', medics: 'medic' } as Record<string, string>)[sq] || sq;
export const TOOLS: { g: string; items: [string, string, ToolMode, string][] }[] = [
  { g: 'DEFENCES', items: [
    ['trench', 'TRENCH', 'line', 'Drag a line on your ground. Strong cover from bullets. Best in open ground.'],
    ['wire', 'WIRE', 'line', 'Drag a line on your ground. Infantry cross at a third of the speed. Tanks drive over it.'],
    ['sandbag', 'SANDBAGS', 'line', 'Drag a line on your ground. Light, cheap cover.'],
    ['wall', 'WALL', 'line', 'Drag a line on your ground. Blocks movement and sight.'],
    ['tanktrap', 'TANK TRAPS', 'line', 'Drag a line on your ground. Stops tanks. Infantry walk through. Put them across roads.']] },
  { g: 'UNITS', items: [
    ['rifles', 'RIFLES', 'point', 'A platoon of 16 riflemen.'],
    ['assault', 'ASSAULT', 'point', 'A platoon of 16 with sub-machine guns. Fast and deadly up close.'],
    ['engineers', 'ENGINEERS', 'point', 'A platoon of 12 engineers. They can demolish bridges and buildings.'],
    ['medics', 'MEDICS', 'point', 'A platoon of 8 medics. Troops near them often survive wounds.'],
    ['garrison', 'GARRISON', 'point', 'Click a building on your ground. Ten riflemen hold it.'],
    ['mg', 'MG NEST', 'point', 'Click on your ground. Fast, long, inaccurate fire. Hidden in woods.'],
    ['mortar', 'MORTAR', 'point', 'Click on your ground. Fires at enemies your side can see.'],
    ['sniper', 'SNIPER', 'aim', 'Press on your ground and drag the way it should watch.'],
    ['at', 'AT GUN', 'point', 'Click on your ground. Fires only at tanks. Range 85.'],
    ['tank', 'TANK', 'point', 'Click on your ground. Fast on roads, slow in woods, stopped by tank traps. Takes orders. Only AT guns, shells, bombs and tanks hurt it.'],
    ['op', 'OBS POST', 'point', 'Click on your ground, ideally high ground. Sees far, spots for mortars and makes artillery more accurate.'],
    ['fob', 'FOB', 'point', 'Forward base. Engineers build it near where they stand; ready next phase. Mortars, MGs, AT guns and posts can then be set up round it.']] },
  { g: 'SUPPORT', items: [
    ['spy', 'SPY PLANE', 'line', 'Drag the flight path anywhere. It sees everything within 55 of its path while it flies.'],
    ['barrage', 'ARTILLERY', 'point', 'Click anywhere. Twelve shells land at the time you set.'],
    ['air', 'AIR STRIKE', 'line', 'Drag the bomb run anywhere.'],
    ['para', 'PARADROP', 'point', 'Click anywhere. Sixteen riflemen land and hold the ground.'],
    ['smoke', 'SMOKE', 'point', 'Click anywhere. A smoke screen blocks sight for about 30 s. Ready from phase 1.']] },
  { g: 'ORDERS', items: [
    ['move', 'MOVE', 'order', 'With platoons, snipers or tanks selected, click the ground to go to. They keep walking under fire and hold when they get there.'],
    ['attack', 'ATTACK', 'order', 'With platoons, snipers or tanks selected, click the ground to take. Or drag from one of them.'],
    ['defend', 'DEFEND', 'order', 'With platoons, snipers or tanks selected, click the ground to hold. Infantry use trenches there.']] },
];
export const TOOLDEF: Record<string, { id: string; name: string; mode: ToolMode; tip: string }> = {};
TOOLS.forEach(g => g.items.forEach(t => TOOLDEF[t[0]] = { id: t[0], name: t[1], mode: t[2], tip: t[3] }));
TOOLDEF.select = { id: 'select', name: 'SELECT', mode: 'select', tip: '' };
TOOLDEF.demolish = { id: 'demolish', name: 'DEMOLISH', mode: 'order', tip: '' };
TOOLDEF.suppress = { id: 'suppress', name: 'SUPPRESS', mode: 'order', tip: '' };
TOOLDEF.follow = { id: 'follow', name: 'FOLLOW', mode: 'order', tip: '' };
// Hover window text for each tool: what it is, where it works, what beats it.
export const INFO: Record<string, [string, string, string]> = {
  smoke: ['Six mortar smoke rounds make a screen about 100 m wide. No one sees through it for about 30 s. Cover an advance or blind an MG.', 'Between your attack and their guns', 'Wind of time: it thins out'],
  trench: ['A dug line. Infantry inside get 70% cover from bullets and some from blasts. Slows movement.', 'Open ground', 'Mortars, artillery'],
  wire: ['Barbed wire. No cover, but infantry cross it at a third of the speed. Tanks drive over it.', 'In front of MGs and trenches', 'Going round it, tanks'],
  sandbag: ['A low wall of sandbags. 50% cover. Cheap.', 'Roads, corners', 'Mortars, flanks'],
  wall: ['A solid wall. Blocks movement and sight.', 'Gaps you want closed', 'Going round it'],
  tanktrap: ['Steel hedgehogs. Tanks cannot pass. Infantry walk through.', 'Across roads', 'Infantry'],
  rifles: ['A platoon of 16 riflemen. Takes ATTACK and DEFEND orders and takes ground.', 'Anywhere', 'MG nests, mortars'],
  assault: ['16 soldiers with sub-machine guns: short range, very fast fire, quick on their feet.', 'Clearing towns and woods', 'MGs at range'],
  engineers: ['12 engineers. Select them, press DEMOLISH, and click a bridge or building: they go there, set charges, and it blows 5 seconds later.', 'Cutting bridges, flattening strongpoints', 'Anything; they are weak fighters'],
  medics: ['8 medics. Your troops within 45 m of a medic survive a fatal wound one time in three.', 'Behind an attack', 'Mortars, artillery'],
  garrison: ['Ten riflemen inside a building. 85% cover, fire from the roof and see over lower roofs. Never move.', 'Tall buildings in town', 'Artillery, tanks'],
  mg: ['Machine gun nest. Long, fast, inaccurate fire. Never moves.', 'Woods, covering a road', 'Mortars, snipers'],
  mortar: ['Fires salvos of 3 shells, then reloads for about 30 s. Hits enemies 26 to 155 away that your side can see.', 'Behind your line', 'Artillery, rushes'],
  sniper: ['One soldier. Sees and shoots twice as far as a rifleman, but only in the 70 degree cone it faces.', 'High ground, covering a road', 'Mortars, MGs'],
  at: ['Anti-tank gun. Fires only at tanks, range 85.', 'Facing roads and open ground', 'Infantry, mortars'],
  tank: ['Heavy gun, armour. Small arms cannot hurt it. Takes orders.', 'Roads, open ground', 'AT guns, tank traps, shells'],
  op: ['Observation post. Sees far, spots for mortars and tightens artillery.', 'The highest ground you hold', 'Snipers, artillery'],
  fob: ['Forward base. Only engineers can build one, near where they stand. It takes the next phase to build. Heavy weapons can then be set up within 90 m of it.', 'Behind your front line', 'Artillery, air strikes'],
  spy: ['A plane that sees everything within 55 of its path while it flies. Finds the enemy HQ.', 'Over unknown ground', 'Nothing; it only looks'],
  barrage: ['Twelve shells into a circle at the time you set. Hits everyone, your troops too.', 'Enemy trenches, the HQ before an attack', 'Spread-out troops'],
  air: ['A bomb run along the line you draw.', 'Columns on roads, dense groups', 'Spread-out troops'],
  para: ['Sixteen riflemen land at a point and hold the ground there.', 'Behind the enemy, near their HQ', 'MG nests'],
  demo: ['Engineers blow up a bridge or a building at the time you set.', 'Bridges the enemy needs, buildings they hold', ''],
  move: ['Selected units go to the ground you click and hold there. Infantry keep walking under fire.', '', ''],
  attack: ['Selected units move to the ground you click and take it. They stop to fight on the way.', '', ''],
  defend: ['Selected units hold the ground you click. Infantry use trenches there.', '', ''],
};
export const KIND_NAME: Record<string, string> = { fob: 'FOB', rifles: 'Platoon', assault: 'Assault', engineers: 'Engineers', medics: 'Medics', garrison: 'Garrison', mg: 'MG nest', mortar: 'Mortar', sniper: 'Sniper', tank: 'Tank', at: 'AT gun', op: 'Obs post' };
export const SUP_NAME: Record<string, string> = { barrage: 'ARTILLERY', air: 'AIR', para: 'PARA', demo: 'DEMOLISH', spy: 'SPY', smoke: 'SMOKE' };
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
