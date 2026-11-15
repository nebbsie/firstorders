import { S } from './state';

// Campaign: a run of battles on fixed sample towns. Each win unlocks more of the arsenal for the next.
// Both sides use only what is unlocked, and the enemy gets a little more supply each mission.
export interface Mission { name: string; brief: string; seed: number; adds: string[]; ai: number }
const BASE = ['trench', 'wire', 'rifles', 'mg'];
export const MISSIONS: Mission[] = [
  { name: 'FIRST CONTACT', seed: 1101, ai: .8, adds: [], brief: 'Riflemen and MG nests only. Dig in, find the enemy HQ and take it.' },
  { name: 'HEAVY WEAPONS', seed: 2207, ai: .9, adds: ['mortar', 'sandbag', 'smoke'], brief: 'Mortars, sandbags and smoke. Pin them down, then move.' },
  { name: 'SAPPERS', seed: 3313, ai: 1, adds: ['engineers', 'fob', 'wall', 'demo'], brief: 'Engineers build FOBs to bring heavy weapons forward, and can blow bridges.' },
  { name: 'ARMOUR', seed: 4421, ai: 1.1, adds: ['tank', 'at', 'tanktrap'], brief: 'Tanks arrive, and so do AT guns and tank traps to stop them.' },
  { name: 'EYES AND EARS', seed: 5527, ai: 1.2, adds: ['sniper', 'op', 'spy', 'medics'], brief: 'Snipers, observation posts, spy planes and medics.' },
  { name: 'STREET FIGHT', seed: 6631, ai: 1.3, adds: ['assault', 'garrison', 'barrage'], brief: 'Assault platoons, garrisons and artillery for a fight through town.' },
  { name: 'OVERLORD', seed: 7741, ai: 1.45, adds: ['air', 'para'], brief: 'Everything: air strikes and paradrops too. Win the war.' },
];
export function unlockedAt(i: number) { const s = new Set(BASE); for (let k = 0; k <= i; k++) for (const a of MISSIONS[k].adds) s.add(a); return s; }
export function progress() { try { return +(localStorage.getItem('fo-campaign') || 0); } catch { return 0; } }
export function saveWin(i: number) { try { if (i + 1 > progress()) localStorage.setItem('fo-campaign', String(i + 1)); } catch { } }
// Set up the rules for a mission, or clear them for a normal battle.
export function useMission(i: number | null) {
  S.campaign = i; S.allowed = i == null ? null : unlockedAt(i); S.aiMult = i == null ? 1 : MISSIONS[i].ai;
}
export const isAllowed = (id: string) => !S.allowed || S.allowed.has(id) || id === 'attack' || id === 'defend' || id === 'select' || id === 'demolish';
