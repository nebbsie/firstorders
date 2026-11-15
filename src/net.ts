import Peer, { type DataConnection } from 'peerjs';
import { COV, T_WATER } from './config';
import { S, M, OWN, VIS0, SEEN0, NET, hooks } from './state';
import { exec } from './actions';
import { collapse } from './sim';

// Peer-to-peer play for two people. The host runs the battle and sends its state ten times a second.
// The guest draws that state and sends its actions back as commands. Signalling uses the public PeerJS server.
const PREFIX = 'first-orders-';
let peer: Peer | null = null, conn: DataConnection | null = null;
const KINDS = ['rifle', 'mg', 'mortar', 'sniper', 'tank', 'at', 'op'];

// Typed arrays travel as tagged ArrayBuffers and are rebuilt on arrival.
const TYPES: Record<string, any> = { f32: Float32Array, u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i32: Int32Array };
function pack(v: any): any {
  if (v == null || typeof v !== 'object') return v;
  for (const k in TYPES) if (v instanceof TYPES[k]) return { __t: k, b: v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) };
  if (Array.isArray(v)) return v.map(pack);
  if (v instanceof Set || v instanceof Map) return undefined;
  const o: any = {}; for (const k in v) { const p = pack(v[k]); if (p !== undefined) o[k] = p; } return o;
}
function unpack(v: any): any {
  if (v == null || typeof v !== 'object') return v;
  if (v.__t) return new TYPES[v.__t](v.b);
  if (Array.isArray(v)) return v.map(unpack);
  const o: any = {}; for (const k in v) o[k] = unpack(v[k]); return o;
}
const code = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
function send(m: any) { if (conn && conn.open) conn.send(pack(m)); }
NET.send = (m: any) => send({ t: 'cmd', m });

export interface NetEvents { status: (s: string) => void; joined?: () => void; map?: (spec: any) => void; left: () => void }
let ev: NetEvents;
export function closeNet() { try { conn?.close(); peer?.destroy(); } catch { } conn = null; peer = null; NET.mode = 'solo'; NET.me = 0; }

export function host(events: NetEvents) {
  closeNet(); ev = events; NET.mode = 'host'; NET.me = 0;
  const id = code(); peer = new Peer(PREFIX + id.toLowerCase());
  peer.on('open', () => ev.status(`Your code: ${id}. Send it to your friend, then pick a map.`));
  peer.on('error', e => ev.status(`Connection problem: ${e.type}`));
  peer.on('connection', c => {
    if (conn) { c.close(); return; }
    conn = c; c.on('open', () => { ev.status('Friend connected.'); ev.joined && ev.joined(); });
    c.on('data', (d: any) => onHostData(unpack(d)));
    c.on('close', () => { conn = null; if (S.teams[1]) S.teams[1].human = false; ev.left(); });
  });
  return id;
}
export function join(id: string, events: NetEvents) {
  closeNet(); ev = events; NET.mode = 'guest'; NET.me = 1;
  peer = new Peer();
  peer.on('error', e => ev.status(`Could not connect: ${e.type}`));
  peer.on('open', () => {
    ev.status('Connecting');
    conn = peer.connect(PREFIX + id.trim().toLowerCase(), { reliable: true });
    conn.on('open', () => ev.status('Connected. Waiting for the host to pick a map.'));
    conn.on('data', (d: any) => onGuestData(unpack(d)));
    conn.on('close', () => { conn = null; ev.left(); });
  });
}
export const connected = () => !!(conn && conn.open);

// ---- host side ----
let mapSpec: any = null, onGuestReady: (() => void) | null = null;
export function sendMap(spec: any, nTeams: number): Promise<void> {
  mapSpec = spec; send({ t: 'map', spec, nTeams });
  return new Promise(res => { onGuestReady = res; });
}
function onHostData(m: any) {
  if (m.t === 'loaded' && onGuestReady) { onGuestReady(); onGuestReady = null; }
  if (m.t === 'cmd' && S.teams[1]) exec(1, m.m);
}
let lastSnap = 0, structSent = '', ownSent = -1, recSent = false;
export function hostTick(now: number) {
  if (NET.mode !== 'host' || !connected() || S.phase === 'menu' || !S.teams.length) return;
  if (now - lastSnap < 100) return; lastSnap = now;
  const g = 1, U = S.units, n = U.length, f = new Float32Array(n * 4), b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const u = U[i]; f[i * 4] = u.x; f[i * 4 + 1] = u.y; f[i * 4 + 2] = u.hd || 0; f[i * 4 + 3] = u.drop || 0; b[i * 4] = u.team; b[i * 4 + 1] = KINDS.indexOf(u.kind); b[i * 4 + 2] = u.alive ? 1 : 0; b[i * 4 + 3] = u.gar ? 1 : 0; }
  const sk = S.structs.map((s: any) => s.id + ':' + (s.placedAt ?? '')).join(',');
  const ownKey = S.rec ? S.rec.own.length : 0;
  const snap: any = {
    t: 'snap', phase: S.phase, round: S.round, time: S.t, phaseStart: S.phaseStart, speed: S.speed, paused: S.paused, bank: S.bank, ready: S.ready || {}, speedReq: S.speedReq || {},
    teams: S.teams.map((t: any) => ({ lost: t.lost, hqBy: t.hqBy, hqHold: t.hqHold, label: t.per ? t.per.label : '', human: t.human })),
    f, b, squads: S.squads.map((q: any) => ({ id: q.id, team: q.team, kind: q.kind, call: q.call, x: q.x, y: q.y, pos: q.pos, members: q.members, state: q.state, tx: q.tx, ty: q.ty, order: q.team === g ? q.order : null, cur: q.team === g ? q.cur : null, round: q.round, live: q.live, temp: q.temp, bld: q.bld })),
    supports: S.supports.filter((s: any) => s.team === g).map((s: any) => ({ ...s })),
    shells: S.shells, bombs: S.bombs, fx: S.fx, tracers: S.tracers.map((t: any) => ({ ...t })), planes: S.planes.map((p: any) => ({ kind: p.kind, team: p.team, ax: p.ax, ay: p.ay, ux: p.ux, uy: p.uy, len: p.len, s: p.s })), craters: S.craters,
    vis: S.vis[g], visG: S.visG ? S.visG[g] : null, seenG: S.seenG ? S.seenG[g] : null,
    known: S.known[g] ? [...S.known[g].values()] : [], hqKnown: S.hqKnown ? [...S.hqKnown[g]] : [],
    log: S.log.slice(0, 80), terrCount: S.terrCount, stats: S.stats, history: S.history, result: S.result,
    blown: M.bridges.map(br => br.blown), downs: M.B.filter(b => b.down != null).map(b => b.id), banner: S.netBanner,
  };
  if (S.sndNet && S.sndNet.length) { snap.snd = S.sndNet; S.sndNet = []; }
  if (sk !== structSent) { snap.structs = S.structs.map((s: any) => ({ id: s.id, team: s.team, type: s.type, a: s.a, b: s.b, cells: s.cells, round: s.round, placedAt: s.placedAt, live: s.live })); structSent = sk; }
  if (ownKey !== ownSent || S.phase === 'plan') { snap.own = OWN; ownSent = ownKey; }
  if (S.phase === 'done' && S.rec && !recSent) { snap.rec = S.rec; recSent = true; }
  if (S.phase !== 'done') recSent = false;
  send(snap);
}

// ---- guest side ----
function onGuestData(m: any) {
  if (m.t === 'map') { S.nTeams = m.nTeams; S.spawnSeed = m.spec.spawn; ev.map && ev.map(m.spec); }
  if (m.t === 'snap') applySnap(m);
}
export function guestLoaded() { send({ t: 'loaded' }); }
function applySnap(m: any) {
  const was = S.phase, wasRound = S.round, wasLost = S.teams.map((t: any) => t.lost);
  Object.assign(S, { phase: m.phase, round: m.round, t: m.time, phaseStart: m.phaseStart, speed: m.speed, paused: m.paused, bank: m.bank, ready: m.ready, speedReq: m.speedReq });
  m.teams.forEach((t: any, i: number) => { const T = S.teams[i]; if (!T) return; T.lost = t.lost; T.hqBy = t.hqBy; T.hqHold = t.hqHold; T.human = t.human; T.per = { label: t.label }; });
  const n = m.f.length / 4; S.units.length = n;
  for (let i = 0; i < n; i++) {
    const u = S.units[i] || (S.units[i] = { i, kills: 0 }); u.i = i;
    u.x = m.f[i * 4]; u.y = m.f[i * 4 + 1]; u.hd = m.f[i * 4 + 2]; u.drop = m.f[i * 4 + 3];
    u.team = m.b[i * 4]; u.kind = KINDS[m.b[i * 4 + 1]]; u.alive = m.b[i * 4 + 2] === 1; u.gar = m.b[i * 4 + 3] === 1;
  }
  const selIds = new Set((S.selMany || []).map((s: any) => s.id)), selId = S.sel ? S.sel.id : null;
  S.squads = m.squads; S.supports = m.supports;
  if (m.structs) { S.structs = m.structs; S.cover = new Uint8Array(M.terr.length); for (const s of S.structs) if (s.placedAt != null) for (const c of s.cells) S.cover[c] = COV[s.type]; }
  Object.assign(S, { shells: m.shells, bombs: m.bombs, fx: m.fx, tracers: m.tracers, planes: m.planes, craters: m.craters, log: m.log, terrCount: m.terrCount, stats: m.stats, history: m.history, result: m.result });
  S.logDirty = true;
  S.vis[NET.me] = m.vis; if (m.visG) { VIS0.set(m.visG); SEEN0.set(m.seenG); }
  S.known[NET.me] = new Map(m.known.map((k: any) => [k.i, k])); if (!S.hqKnown) S.hqKnown = S.teams.map((t: any) => new Set([t.id])); S.hqKnown[NET.me] = new Set(m.hqKnown);
  m.blown.forEach((v: any, i: number) => { const br = M.bridges[i]; if (v != null && br.blown == null) for (const c of br.cells) { M.terr[c] = T_WATER; M.deck[c] = -99; } br.blown = v; });
  for (const id of m.downs || []) if (M.B[id].down == null) collapse(id, -1, false);
  if (m.own) OWN.set(m.own);
  if (m.rec) S.rec = m.rec;
  if (m.snd) { if (!S.snd) S.snd = []; S.snd.push(...m.snd); }
  S.sel = selId != null ? (S.squads.find((s: any) => s.id === selId) || S.structs.find((s: any) => s.id === selId) || S.supports.find((s: any) => s.id === selId) || null) : null;
  S.selMany = S.squads.filter((s: any) => selIds.has(s.id));
  hooks.vision();
  if (was !== S.phase || wasRound !== S.round) {
    if (S.phase === 'plan' && S.round > 1) hooks.banner('', '');
    else if (S.phase === 'battle') hooks.banner(`PHASE ${S.round}`, S.round === 1 ? 'Plans locked' : 'Reinforcements in');
    if (S.phase === 'done') hooks.result();
    hooks.sync();
  }
  S.teams.forEach((t: any, i: number) => { if (t.lost && !wasLost[i]) hooks.banner(`${t.name} HQ TAKEN`, `${S.teams[t.hqBy] ? S.teams[t.hqBy].name : ''} holds it`); });
}

