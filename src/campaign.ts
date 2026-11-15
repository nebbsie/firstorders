import { S } from './state';

// Campaign: a run of battles on fixed sample towns. Each win unlocks more of the arsenal for the next.
// Both sides use only what is unlocked, and the enemy gets a little more supply each mission.
// goal: 'hq' take the enemy HQ, most ground wins at the limit. 'hold' keep your HQ until the limit. 'ground' hold twice the enemy's ground, or more at the limit.
// 'assault' take the enemy HQ before the limit, or lose.
export interface Mission { name: string; brief: string; seed: number; adds: string[]; ai: number; goal: 'hq' | 'hold' | 'ground' | 'assault'; phases: number }
export const GOAL_TEXT: Record<string, string> = {
  hq: 'Take the enemy HQ. If time runs out, the side with more ground wins.', hold: 'Hold your HQ until the last phase ends. The enemy attacks from the start.',
  ground: 'Hold twice as much ground as the enemy, or more than them when time runs out.', assault: 'Take the enemy HQ before time runs out. If you do not, you lose.' };
const BASE = ['trench', 'wire', 'rifles', 'mg'];
export const MISSIONS: Mission[] = [
  { name: 'FIRST CONTACT', seed: 1101, ai: .8, goal: 'hq', phases: 8, adds: [], brief: 'Riflemen and MG nests only. Dig in, find the enemy HQ and take it.' },
  { name: 'HEAVY WEAPONS', seed: 2207, ai: 1.25, goal: 'hold', phases: 6, adds: ['mortar', 'sandbag', 'smoke'], brief: 'They are coming for your HQ. Mortars, sandbags and smoke are yours: dig in and hold.' },
  { name: 'SAPPERS', seed: 3313, ai: 1, goal: 'ground', phases: 8, adds: ['engineers', 'fob', 'wall', 'demo'], brief: 'A fight for the town itself. Engineers build FOBs to bring heavy weapons forward, and can blow bridges.' },
  { name: 'ARMOUR', seed: 4421, ai: 1.1, goal: 'hq', phases: 10, adds: ['tank', 'at', 'tanktrap'], brief: 'Tanks arrive, and so do AT guns and tank traps to stop them.' },
  { name: 'EYES AND EARS', seed: 5527, ai: 1.1, goal: 'assault', phases: 9, adds: ['sniper', 'op', 'spy', 'medics'], brief: 'Find their HQ and take it before they are reinforced. Snipers, observation posts, spy planes and medics.' },
  { name: 'STREET FIGHT', seed: 6631, ai: 1.45, goal: 'hold', phases: 7, adds: ['assault', 'garrison', 'barrage'], brief: 'A heavy attack through the streets. Hold your HQ with assault platoons, garrisons and artillery.' },
  { name: 'OVERLORD', seed: 7741, ai: 1.4, goal: 'assault', phases: 12, adds: ['air', 'para'], brief: 'Everything: air strikes and paradrops too. Win the war.' },
];
export function unlockedAt(i: number) { const s = new Set(BASE); for (let k = 0; k <= i; k++) for (const a of MISSIONS[k].adds) s.add(a); return s; }
export function progress() { try { return +(localStorage.getItem('fo-campaign') || 0); } catch { return 0; } }
export function saveWin(i: number) { try { if (i + 1 > progress()) localStorage.setItem('fo-campaign', String(i + 1)); } catch { } }
// Set up the rules for a mission, or clear them for a normal battle.
export function useMission(i: number | null) {
  S.campaign = i; S.allowed = i == null ? null : unlockedAt(i); S.aiMult = i == null ? 1 : MISSIONS[i].ai;
  S.goal = i == null ? 'hq' : MISSIONS[i].goal; S.maxPhases = i == null ? (S.skirmishPhases || 0) : MISSIONS[i].phases; S.tutorial = null;
}
export const isAllowed = (id: string) => !S.allowed || S.allowed.has(id) || id === 'attack' || id === 'defend' || id === 'select' || id === 'demolish';
