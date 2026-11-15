import { IW, IH } from './config';
import type { MapData } from './map/types';

// One battle's state. The simulation, AI, renderer and HUD all read it.
export const S: any = {
  phase: 'menu', round: 1, t: 0, phaseStart: 0, speed: 1, paused: false, nTeams: 2,
  teams: [], bank: [], squads: [], structs: [], supports: [], units: [], cover: null,
  tool: 'select', sel: null, log: [],
  shells: [], bombs: [], fx: [], tracers: [], craters: [], planes: [], flow: new Map(),
  selMany: [], stats: [], rec: null, rt: 0, follow: true, nextId: 1, result: null, terrCount: [], history: [], callN: [],
  // Fog of war: per team, which units it sees now and where it last saw enemy units.
  fog: true, vis: [], known: [], contactT: [],
};
export let M: MapData = null as any;
export function setMap(m: MapData) { M = m; }
export const OWN = new Int8Array(IW * IH);
// What the player's side sees now (VIS0) and has ever seen (SEEN0), per ground cell.
export const VIS0 = new Uint8Array(IW * IH), SEEN0 = new Uint8Array(IW * IH);
// The simulation tells the interface about changes through these.
export const hooks = {
  banner: (_big: string, _small: string) => { },
  sync: () => { },
  result: () => { },
  ground: () => { },
  vision: () => { },
};
