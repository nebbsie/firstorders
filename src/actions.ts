import { S, NET } from './state';
import { addSquad, addStruct, addSupport, removeItem } from './plan';
import { goLive, applyOrder, beginRound } from './sim';
import { M } from './state';

// Every player action goes through here. Solo and host apply it at once. A guest sends it to the host,
// which applies it for the guest's team and sends the new state back.
const live = (it: any) => { if (it && S.phase === 'battle') goLive(it); return it; };
const byId = (id: number) => S.squads.find((s: any) => s.id === id) || S.structs.find((s: any) => s.id === id) || S.supports.find((s: any) => s.id === id);

export function exec(team: number, m: any): any {
  switch (m.cmd) {
    case 'squad': return live(addSquad(team, m.kind, m.x, m.y));
    case 'struct': return live(addStruct(team, m.type, m.a, m.b));
    case 'support': { const s = addSupport(team, m.type, m.a, m.b, m.t); if (m.bridge != null) s.bridge = m.bridge; if (m.bld != null) s.bld = m.bld; return live(s); }
    case 'orders': for (const o of m.list) { const s = S.squads.find((q: any) => q.id === o.id && q.team === team); if (!s) continue; s.order = o.type ? { type: o.type, x: o.x, y: o.y, dir: o.dir } : null; if (S.phase === 'battle' && s.order) applyOrder(s); } return null;
    case 'remove': { const it = byId(m.id); if (it && it.team === team && it.round === S.round && !it.members && !it.live && S.phase === 'plan') removeItem(it); return null; }
    case 'time': { const it = byId(m.id); if (it && it.team === team && !it.fired) it.t = m.t; return null; }
    case 'ready': { S.ready = S.ready || {}; S.ready[team] = true; if (S.phase === 'plan' && S.teams.every((t: any) => !t.human || t.lost || S.ready[t.id])) { S.ready = {}; beginRound(); } return null; }
    case 'speed': if (m.v === 0) S.paused = !S.paused; else { S.speed = m.v; S.paused = false; } return null;
  }
  return null;
}
export function act(m: any) { if (NET.mode === 'guest') { NET.send(m); return null; } return exec(NET.me, m); }
export const actSquad = (kind: string, x: number, y: number) => act({ cmd: 'squad', kind, x, y });
export const actStruct = (type: string, a: any, b: any) => act({ cmd: 'struct', type, a, b });
export const actSupport = (type: string, a: any, b: any, t: number, bridge?: number, bld?: number) => act({ cmd: 'support', type, a, b, t, bridge, bld });
export const actOrders = (list: { id: number; type: string | null; x?: number; y?: number }[]) => act({ cmd: 'orders', list });
export const actRemove = (id: number) => act({ cmd: 'remove', id });
export const actTime = (id: number, t: number) => act({ cmd: 'time', id, t });
export const actReady = () => act({ cmd: 'ready' });
export const actSpeed = (v: number) => act({ cmd: 'speed', v });
export { M };
