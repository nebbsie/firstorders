import { S, NET } from './state';
import { addSquad, addStruct, addSupport, removeItem } from './plan';
import { goLive, applyOrder, beginRound } from './sim';
import { M } from './state';

// Every player action goes through here. Solo and host apply it at once. A guest sends it to the host,
// which applies it for the guest's team and sends the new state back.
const live = (it: any) => { if (it && S.phase === 'battle') goLive(it); return it; };
const byId = (id: number) => S.squads.find((s: any) => s.id === id) || S.structs.find((s: any) => s.id === id) || S.supports.find((s: any) => s.id === id);

// player: 0 the host (or solo), 1 the guest. In co-op both players command the same team.
export function exec(team: number, m: any, player = 0): any {
  // Plans are locked while a phase runs.
  if (S.phase !== 'plan' && ['squad', 'struct', 'support', 'orders', 'remove', 'time', 'stance'].includes(m.cmd)) return null;
  switch (m.cmd) {
    case 'squad': return live(addSquad(team, m.kind, m.x, m.y, m.face));
    case 'struct': return live(addStruct(team, m.type, m.a, m.b));
    case 'support': { const s = addSupport(team, m.type, m.a, m.b, m.t); if (!s) return null; if (m.bridge != null) s.bridge = m.bridge; if (m.bld != null) s.bld = m.bld; return live(s); }
    case 'orders': for (const o of m.list) { const s = S.squads.find((q: any) => q.id === o.id && q.team === team); if (!s) continue; s.order = o.type ? { type: o.type, x: o.x, y: o.y, dir: o.dir, bridge: o.bridge, bld: o.bld, via: o.via || null } : null; if (S.phase === 'battle' && s.order) applyOrder(s); } return null;
    // How a unit moves and fights: normal, careful, rush or ambush; and whether it falls back when badly hurt.
    case 'stance': for (const id of m.ids) { const s = S.squads.find((q: any) => q.id === id && q.team === team); if (!s) continue; if (m.stance) s.stance = m.stance === 'normal' ? undefined : m.stance; if (m.fallback != null) s.fallback = m.fallback; } return null;
    case 'remove': { const it = byId(m.id); if (it && it.team === team && it.round === S.round && !it.members && !it.live && S.phase === 'plan') removeItem(it); return null; }
    case 'time': { const it = byId(m.id); if (it && it.team === team && !it.fired) it.t = m.t; return null; }
    case 'ready': { S.ready = S.ready || {}; S.ready[player] = true; if (S.phase === 'plan' && players().every(p => S.ready[p.id] || S.teams[p.team].lost)) { S.ready = {}; S.speedReq = {}; beginRound(); } return null; }
    case 'speed': {
      // v: 0 pause, -1 play, else the speed. With two people, it changes only when both ask for the same.
      const apply = (v: number) => { if (v === 0) S.paused = true; else if (v === -1) S.paused = false; else { S.speed = v; S.paused = false; } };
      const ps = players();
      if (ps.length < 2) { apply(m.v); return null; }
      S.speedReq = S.speedReq || {}; S.speedReq[player] = m.v;
      if (ps.every(p => S.speedReq[p.id] === m.v)) { apply(m.v); S.speedReq = {}; }
      return null;
    }
  }
  return null;
}
// The people in this game: the host, and the guest while connected.
export const players = () => [{ id: 0, team: 0 }, ...(S.guestOn ? [{ id: 1, team: S.coop ? 0 : 1 }] : [])];
export function act(m: any) { if (NET.mode === 'guest') { NET.send(m); return null; } return exec(NET.me, m); }
export const actSquad = (kind: string, x: number, y: number, face?: number) => act({ cmd: 'squad', kind, x, y, face });
export const actStruct = (type: string, a: any, b: any) => act({ cmd: 'struct', type, a, b });
export const actSupport = (type: string, a: any, b: any, t: number, bridge?: number, bld?: number) => act({ cmd: 'support', type, a, b, t, bridge, bld });
export const actOrders = (list: { id: number; type: string | null; x?: number; y?: number }[]) => act({ cmd: 'orders', list });
export const actStance = (ids: number[], stance?: string, fallback?: boolean) => act({ cmd: 'stance', ids, stance, fallback });
export const actRemove = (id: number) => act({ cmd: 'remove', id });
export const actTime = (id: number, t: number) => act({ cmd: 'time', id, t });
export const actReady = () => act({ cmd: 'ready' });
export const actSpeed = (v: number) => act({ cmd: 'speed', v: v === 0 ? (S.paused ? -1 : 0) : v });
export { M };
