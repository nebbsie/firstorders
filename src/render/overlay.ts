import { NET } from '../state';
import { KIND_NAME, C, GW, K, M_PER_UNIT, PLATOONS, MOVERS, unitKind, CX, CY, COST, TOOLDEF, TEAM_COLORS, SUP_NAME, GRID_X0, GRID_Y0, grid } from '../config';
import { S, M } from '../state';
import { canDeploy, opRange, canPlaceUnit, ENG_BUILD, ENG_R, FOB_R } from '../world';
import { sqCenter, left, lineCells, spacingOk } from '../plan';
import { route, moveFactor } from '../sim';
import { PHASE_LEN } from '../config';
import { cellOf } from '../world';
import { P, Pa, view, fpv } from './camera';
import { input } from '../ui/input';

let ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement;
export function initOverlay(c: HTMLCanvasElement) { cv = c; ctx = c.getContext('2d'); }
export function resizeOverlay() { cv.width = Math.round(view.cw * view.dpr); cv.height = Math.round(view.ch * view.dpr); }

function plate(x: number, y: number, text: string, col: string) {
  if (x < -500) return; ctx.font = '11px Departure, ui-monospace, monospace';
  const w = Math.round(ctx.measureText(text).width + 10); x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(20,21,25,.94)'; ctx.fillRect(x - (w >> 1), y - 8, w, 16); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - (w >> 1) + .5, y - 7.5, w - 1, 15);
  ctx.fillStyle = '#f4f1e8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
}
// Small map symbols for each kind of unit, 14 by 10, in the style of military map marks.
function unitIcon(kind: string, x: number, y: number, col: string) {
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2; ctx.strokeRect(x + .5, y + .5, 14, 10); ctx.beginPath();
  if (kind === 'rifles' || kind === 'assault') { ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + 14, y + 10); ctx.moveTo(x + 14, y + 1); ctx.lineTo(x + 1, y + 10); }
  if (kind === 'assault') { ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + 7.5, y + 1); ctx.lineTo(x + 11, y + 3); }
  if (kind === 'engineers') { ctx.moveTo(x + 3, y + 8); ctx.lineTo(x + 3, y + 3.5); ctx.lineTo(x + 12, y + 3.5); ctx.lineTo(x + 12, y + 8); ctx.moveTo(x + 7.5, y + 3.5); ctx.lineTo(x + 7.5, y + 8); }
  if (kind === 'medics') { ctx.moveTo(x + 7.5, y + 2); ctx.lineTo(x + 7.5, y + 9); ctx.moveTo(x + 4, y + 5.5); ctx.lineTo(x + 11, y + 5.5); }
  if (kind === 'tank') { ctx.ellipse(x + 7.5, y + 5.5, 5, 2.6, 0, 0, Math.PI * 2); }
  if (kind === 'sniper') { ctx.arc(x + 7.5, y + 5.5, 2.6, 0, Math.PI * 2); ctx.moveTo(x + 2, y + 5.5); ctx.lineTo(x + 13, y + 5.5); }
  ctx.stroke();
}
// The order a unit is following: in planning, a new order, else one still under way from the last phase.
const ordOf = (s: any, plan: boolean) => plan ? (s.order || (s.members && s.state === 'attack' ? s.cur : null)) : s.cur;
// A line along the way the units will walk.
function routeLine(s: any, a: any, b: any, col: string, dash: boolean, head: boolean) {
  if (!MOVERS.includes(s.kind)) { groundLine(a, b, col, dash, head); return; }
  // A waypoint: the order's own, the one still ahead of a moving unit, or the one being set now.
  const via = b === s.order ? s.order.via : b === s.cur ? s.via : (S.selMany || []).includes(s) ? S.via : null;
  const k = K[unitKind(s.kind)], veh = !!k?.veh, r = via ? route(a.x, a.y, via.x, via.y, veh).concat(route(via.x, via.y, b.x, b.y, veh).slice(1)) : route(a.x, a.y, b.x, b.y, veh);
  if (via) { const p = P(via.x, via.y, 2); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 6.283); ctx.stroke(); }
  // How far the unit gets in the time left this phase. Beyond that the line turns grey: it arrives next phase or later.
  let time = S.phase === 'plan' ? PHASE_LEN : Math.max(0, PHASE_LEN - (S.t - S.phaseStart)), split: number[] = null, si = -1;
  for (let i = 0; i < r.length - 1 && !split; i++) {
    const L = Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]), n = Math.max(1, Math.ceil(L / 2));
    for (let j = 0; j < n; j++) {
      const f = (j + .5) / n, x = r[i][0] + (r[i + 1][0] - r[i][0]) * f, y = r[i][1] + (r[i + 1][1] - r[i][1]) * f;
      time -= L / n / (k.speed * moveFactor(cellOf(x, y), veh));
      if (time <= 0) { split = [x, y]; si = i; break; }
    }
  }
  const NEXT = 'rgba(160,166,176,.75)';
  for (let i = 0; i < r.length - 1; i++) {
    const p0 = { x: r[i][0], y: r[i][1] }, p1 = { x: r[i + 1][0], y: r[i + 1][1] }, last = i === r.length - 2;
    if (!split || i < si) groundLine(p0, p1, col, dash, head && last);
    else if (i === si) { const m = { x: split[0], y: split[1] }; groundLine(p0, m, col, dash, false); groundLine(m, p1, NEXT, true, head && last); }
    else groundLine(p0, p1, NEXT, true, head && last);
  }
  if (split) { const p = P(split[0], split[1], 2); ctx.fillStyle = col; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6); }
}
function groundLine(a: any, b: any, col: string, dash: boolean, head: boolean) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6)); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash ? [6, 4] : []); ctx.beginPath();
  let last: number[] = null, prev: number[] = null;
  for (let i = 0; i <= n; i++) { const p = P(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, 1.5); if (p[0] < -500) continue; if (!last) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); prev = last; last = p; }
  ctx.stroke(); ctx.setLineDash([]);
  if (head && last && prev) { const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(last[0] - Math.cos(ang - .45) * 11, last[1] - Math.sin(ang - .45) * 11); ctx.lineTo(last[0] - Math.cos(ang + .45) * 11, last[1] - Math.sin(ang + .45) * 11); ctx.closePath(); ctx.fill(); }
}
// A cone: a sniper's field of fire (filled red edge) and sight (dashed), round the way it faces.
function cone(x: number, y: number, face: number, arc: number, range: number, sight: number) {
  const h0 = M.hAt(x, y) + .6;
  for (const [R, col, dash] of [[sight, 'rgba(200,220,240,.7)', true], [range, 'rgba(255,122,114,.85)', false]] as [number, string, boolean][]) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash(dash ? [4, 3] : []); ctx.beginPath(); let s = Pa(x, y, h0); ctx.moveTo(s[0], s[1]);
    for (let i = 0; i <= 20; i++) { const a = face - arc / 2 + arc * i / 20; s = Pa(x + Math.cos(a) * R, y + Math.sin(a) * R, h0); ctx.lineTo(s[0], s[1]); }
    ctx.closePath(); ctx.stroke(); if (!dash) { ctx.fillStyle = 'rgba(255,122,114,.08)'; ctx.fill(); }
  }
  ctx.setLineDash([]);
}
function sightOfKind(s: any) { const k = K[unitKind(s.kind)]; return s.kind === 'op' ? opRange({ x: s.x, y: s.y }) : k.sight + (s.kind === 'garrison' ? 15 : 0); }
// A building and all its parts (towers, wings), with the spire if it has one.
function boxOutline(bd: any, col: string) {
  const root = M.B[bd.parent ?? bd.id];
  if (!root.parts) root.parts = M.B.filter(b => b.id === root.id || b.parent === root.id);
  for (const b of root.parts) if (b.down == null) partOutline(b, col);
  const sp = root.spire; if (!sp || root.down != null) return;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [root.cx + u * sp.half, root.cy + v * sp.half]), apex = Pa(root.cx, root.cy, sp.y2);
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
  c.forEach((q, i) => { const s = Pa(q[0], q[1], sp.y1); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }); const s0 = Pa(c[0][0], c[0][1], sp.y1); ctx.lineTo(s0[0], s0[1]);
  for (const q of c) { const a = Pa(q[0], q[1], root.top), b = Pa(q[0], q[1], sp.y1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(b[0], b[1]); ctx.lineTo(apex[0], apex[1]); }
  ctx.stroke();
}
function partOutline(bd: any, col: string) {
  const p = bd.p, top = bd.top + .05, bot = bd.base + .4; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
  for (const h of [top, bot]) { p.forEach((q: number[], i: number) => { const s = Pa(q[0], q[1], h); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }); const s0 = Pa(p[0][0], p[0][1], h); ctx.lineTo(s0[0], s0[1]); }
  for (const q of p) { const a = Pa(q[0], q[1], top), b = Pa(q[0], q[1], bot); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
}
function ring(x: number, y: number, r: number, col: string, dash: boolean, w?: number) {
  ctx.strokeStyle = col; ctx.lineWidth = w || 1.5; ctx.setLineDash(dash ? [4, 3] : []); ctx.beginPath(); let first = true;
  // Flat at the ground height of the centre, so the ring does not climb onto roofs.
  const h0 = M.hAt(x, y) + .6;
  for (let i = 0; i <= 32; i++) { const a = i / 32 * 6.283, p = Pa(x + Math.cos(a) * r, y + Math.sin(a) * r, h0); if (p[0] < -500) { first = true; continue; } if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); }
  ctx.stroke(); ctx.setLineDash([]);
}

export function draw2D() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (fpv.on) return; // first person: the view only
  const plan = S.phase === 'plan';
  ctx.font = '11px Departure, ui-monospace, monospace'; ctx.fillStyle = 'rgba(232,197,71,.8)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) { const p = P(GRID_X0 + i * 40 + 20, GRID_Y0 - 8, 0); if (p[0] > -500) ctx.fillText('ABCDEFGHJK'[i], p[0], p[1]); }
  for (let j = 0; j < 10; j++) { const p = P(GRID_X0 - 9, GRID_Y0 + j * 40 + 20, 0); if (p[0] > -500) ctx.fillText(String(j + 1), p[0], p[1]); }
  if (S.phase === 'replay') return;
  // Enemy HQs show only once your side has seen that ground.
  if (plan) for (const t of S.teams) { if (t.id !== NET.me && S.fog && !(S.hqKnown && S.hqKnown[NET.me].has(t.id))) continue; const c = P(t.zone.x, t.zone.y, 14); plate(c[0], c[1], t.id === NET.me ? 'YOUR HQ' : t.lost ? `${t.name} HQ · TAKEN` : `${t.name} HQ`, t.color); }
  ctx.globalAlpha = plan ? 1 : .4;
  for (const s of S.squads) {
    if (s.team !== NET.me) continue; const o = ordOf(s, plan); if (!o) continue; const c = sqCenter(s); if (!c) continue; const col = TEAM_COLORS[0];
    if (o.type === 'defend') ring(o.x, o.y, 16, col, true);
    if (o.dir != null) groundLine(o, { x: o.x + Math.cos(o.dir) * 10, y: o.y + Math.sin(o.dir) * 10 }, col, false, true);
    routeLine(s, { x: c[0], y: c[1] }, o, col, o.type === 'defend', true);
    if (plan && (S.selMany || []).includes(s)) { const m = P(o.x, o.y, 3); plate(m[0], m[1] - 14, `${s.call || ''} ${o.type.toUpperCase()} ${grid(o.x, o.y)}`.trim(), col); }
  }
  for (const s of S.supports) {
    if (s.round !== S.round || s.team !== NET.me || (!plan && s.fired)) continue;
    const col = s.type === 'spy' ? '#b8c0cc' : '#e8892e', lab = SUP_NAME[s.type] + ' T+' + Math.floor(s.t);
    if (s.b) { groundLine(s.a, s.b, col, true, true); const p = P(s.a.x, s.a.y, 4); if (plan) plate(p[0], p[1] - 12, lab, col); }
    else { ring(s.a.x, s.a.y, s.type === 'barrage' ? 14 : s.type === 'smoke' ? 20 : 9, col, false); const p = P(s.a.x, s.a.y, 6); if (plan) plate(p[0], p[1] - 12, lab, col); }
  }
  ctx.globalAlpha = 1;
  // Heavy weapons and FOBs still being built show when they will be ready.
  for (const s of S.squads) {
    if (s.team !== NET.me || !(s.readyRound > S.round)) continue; const c = sqCenter(s); if (!c) continue; const p = P(c[0], c[1], 4);
    plate(p[0], p[1] - 18, `${KIND_NAME[s.kind] || s.kind} · BUILDING · READY PHASE ${s.readyRound}`, '#e8c547');
  }
  // Name tags: a map symbol for the unit type, the call sign, and its order (or NO ORDERS while planning).
  // Hovering a unit shows its route and target brightly.
  const hv = input.hover && !input.ptr ? S.squads.find((s: any) => s.team === NET.me && s.call && (() => { const c = sqCenter(s); return c && Math.hypot(c[0] - input.hover.x, c[1] - input.hover.y) < 7; })()) : null;
  if (hv) { const o = ordOf(hv, plan), c = sqCenter(hv); if (o && c) { routeLine(hv, { x: c[0], y: c[1] }, o, '#ffffff', o.type === 'defend', true); const m = P(o.x, o.y, 3); plate(m[0], m[1] - 14, `${hv.call} ${o.type.toUpperCase()} ${grid(o.x, o.y)}`, '#ffffff'); } }
  const placed: number[][] = [];
  for (const s of S.squads) {
    if (s.team !== NET.me || !s.call) continue; const c = sqCenter(s); if (!c) continue; const p = P(c[0], c[1], 5); if (p[0] < -500) continue;
    const o = ordOf(s, plan), extra = (s.stance ? ' · ' + s.stance.toUpperCase() : '') + (s.fallback ? ' · FB' : '');
    // Planning: the order (or NO ORDERS) and how the unit will move. In battle: what it is doing now, and its strength.
    const tag = plan ? (o ? `${o.type.toUpperCase()} ${grid(o.x, o.y)}${!s.order ? ' CONT.' : ''}${extra}` : MOVERS.includes(s.kind) && (!s.members || s.state === 'hold') ? 'NO ORDERS' : s.members && s.state === 'defend' ? 'HOLDING' + extra : '')
      : s.members ? `${s.status || ''} ${s.alive ?? s.members.length}/${s.members.length}` : '';
    const tcol = plan ? (o ? '#e8c547' : '#8a8a80') : s.status === 'PINNED' || s.status === 'FALLING BACK' ? '#ff7a72' : s.status === 'ENGAGING' ? '#e8c547' : '#b8c0cc';
    ctx.font = '11px Departure, monospace'; const wn = ctx.measureText(s.call).width, wt = tag ? ctx.measureText(tag).width + 8 : 0, w = 20 + wn + wt + 6, x0 = Math.round(p[0] - w / 2); let y0 = Math.round(p[1] - 22);
    // Tags of units standing together stack upwards instead of covering each other.
    for (let tries = 0; tries < 8 && placed.some(r => x0 < r[0] + r[2] && r[0] < x0 + w && y0 < r[1] + 15 && r[1] < y0 + 15); tries++) y0 -= 16;
    placed.push([x0, y0, w]);
    ctx.fillStyle = s === hv ? 'rgba(40,44,52,.95)' : 'rgba(20,21,25,.8)'; ctx.fillRect(x0, y0, w, 14);
    unitIcon(s.kind, x0 + 3, y0 + 2, TEAM_COLORS[0]);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4f1e8'; ctx.fillText(s.call, x0 + 20, y0 + 7.5);
    if (tag) { ctx.fillStyle = tcol; ctx.fillText(tag, x0 + 20 + wn + 8, y0 + 7.5); }
  }
  if (S.sel) {
    const it = S.sel; let c: number[] = null, r = 8;
    if (it.pos) { c = sqCenter(it); r = PLATOONS.includes(it.kind) ? 9 : 4; }
    else if (it.cells) { c = [(it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2]; r = Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y) / 2 + 3; }
    else if (it.a) { c = it.b ? [(it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2] : [it.a.x, it.a.y]; r = it.b ? Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y) / 2 : 16; }
    if (it.building) {
      // The building as a box: roof outline, ground outline, and the corner edges.
      const bd = it.building, p = bd.p, top = bd.top + .05, bot = bd.base + .4;
      ctx.strokeStyle = '#f0b43c'; ctx.lineWidth = 2; ctx.beginPath();
      for (const h of [top, bot]) p.forEach((q: number[], i: number) => { const s = Pa(q[0], q[1], h); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); if (i === p.length - 1) { const s0 = Pa(p[0][0], p[0][1], h); ctx.lineTo(s0[0], s0[1]); } });
      for (const q of p) { const a = Pa(q[0], q[1], top), b = Pa(q[0], q[1], bot); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke(); ctx.fillStyle = 'rgba(240,180,60,.12)'; ctx.beginPath(); p.forEach((q: number[], i: number) => { const s = Pa(q[0], q[1], top); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }); ctx.fill(); c = null;
    }
    if (c && !it.pos) ring(c[0], c[1], r, '#e8c547', false, 2);
  }
  for (const s of S.selMany || []) { const c = sqCenter(s); if (c) ring(c[0], c[1], PLATOONS.includes(s.kind) ? 9 : 4, '#e8c547', false, 2); }
  // One unit selected: its firing range (solid) and how far it sees (dashed).
  const one = S.sel && S.sel.pos ? S.sel : (S.selMany && S.selMany.length === 1 ? S.selMany[0] : null);
  if (one) {
    const c = sqCenter(one), k = K[unitKind(one.kind)];
    if (c && k && k.arc) { const f = one.members ? (S.units[one.members[0]].face ?? one.face) : one.face; cone(c[0], c[1], f ?? 0, k.arc, k.range, sightOfKind(one)); }
    else if (c && k) {
      const sight = one.kind === 'op' ? opRange({ x: c[0], y: c[1] }) : k.sight + (one.kind === 'garrison' ? 15 : 0);
      if (k.range) { ring(c[0], c[1], k.range, 'rgba(255,122,114,.85)', false, 1.5); const p = P(c[0] + k.range, c[1], 1); plate(p[0], p[1], `RANGE ${Math.round(k.range * M_PER_UNIT)} M`, '#ff7a72'); }
      if (k.min) ring(c[0], c[1], k.min, 'rgba(255,122,114,.5)', true, 1);
      if (sight) { ring(c[0], c[1], sight, 'rgba(200,220,240,.7)', true, 1.5); const p = P(c[0] - sight, c[1], 1); plate(p[0], p[1], `SEES ${Math.round(sight * M_PER_UNIT)} M`, '#c8dcf0'); }
    }
  }
  const b = input.box; if (b) { ctx.strokeStyle = '#e8c547'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(232,197,71,.08)'; const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0); ctx.fillRect(x, y, w, h); ctx.strokeRect(x + .5, y + .5, w, h); }
  drawGhost();
}
function drawGhost() {
  const hover = input.hover, ptr = input.ptr; if ((S.phase !== 'plan' && S.phase !== 'battle') || !hover) return;
  const tool = TOOLDEF[S.tool]; if (tool.mode === 'select') return; const okC = '#8fe3a6', badC = '#f08a7a';
  if (ptr && ptr.mode === 'line') {
    let label: string, ok: boolean;
    if (S.tool === 'air' || S.tool === 'spy') { label = `${tool.name} ${COST[S.tool]}`; ok = left(NET.me) >= COST[S.tool]; }
    else {
      const cells = lineCells(NET.me, ptr.w0, ptr.w), c = cells.length * COST[S.tool]; ok = cells.length > 0 && left(NET.me) >= c; label = `${cells.length} CELLS · ${c}`;
      ctx.fillStyle = ok ? 'rgba(143,227,166,.5)' : 'rgba(240,138,122,.5)';
      for (const ci of cells) { const x = (ci % GW) * C, y = Math.floor(ci / GW) * C; const q = [P(x, y, .3), P(x + C, y, .3), P(x + C, y + C, .3), P(x, y + C, .3)]; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.fill(); }
    }
    groundLine(ptr.w0, ptr.w, ok ? okC : badC, true, S.tool === 'air' || S.tool === 'spy'); const b = P(ptr.w.x, ptr.w.y, 3); plate(b[0], b[1] - 16, label, ok ? okC : badC); return;
  }
  // Dragging an order: an arrow for the way they will face, from the target point.
  // Sniper being placed: the cone it will watch, towards the drag or the centre.
  if (S.tool === 'sniper') {
    const a = ptr && ptr.mode === 'aim' ? ptr.w0 : hover, w = ptr && ptr.mode === 'aim' ? ptr.w : null;
    const f = w && Math.hypot(w.x - a.x, w.y - a.y) > 3 ? Math.atan2(w.y - a.y, w.x - a.x) : Math.atan2(CY - a.y, CX - a.x);
    cone(a.x, a.y, f, K.sniper.arc, K.sniper.range, K.sniper.sight);
    const ok = canPlaceUnit(NET.me, 'sniper', a.x, a.y) && left(NET.me) >= COST.sniper, p = P(a.x, a.y, 4); plate(p[0], p[1] - 20, `SNIPER ${COST.sniper}${ptr ? '' : ' · DRAG TO AIM'}`, ok ? okC : badC); return;
  }
  // Engineers' demolish target: outline the building or mark the bridge under the cursor.
  if (S.tool === 'demolish') {
    const ci = Math.floor(hover.y / C) * GW + Math.floor(hover.x / C), id = ci >= 0 ? M.bldId[ci] : -1;
    if (id >= 0) boxOutline(M.B[id], '#ff7a72'); const p = P(hover.x, hover.y, 4); plate(p[0], p[1] - 20, 'DEMOLISH', '#ff7a72'); return;
  }
  if (ptr && ptr.mode === 'orderGroup') {
    const d = Math.hypot(ptr.w.x - ptr.w0.x, ptr.w.y - ptr.w0.y);
    for (const s of S.selMany || []) { const c = sqCenter(s); if (c && MOVERS.includes(s.kind)) routeLine(s, { x: c[0], y: c[1] }, ptr.w0, 'rgba(232,197,71,.5)', S.tool === 'defend', false); }
    if (d > 4) { const a = Math.atan2(ptr.w.y - ptr.w0.y, ptr.w.x - ptr.w0.x), px = -Math.sin(a), py = Math.cos(a), n = (S.selMany || []).length, half = Math.max(8, n * 6); groundLine({ x: ptr.w0.x - px * half, y: ptr.w0.y - py * half }, { x: ptr.w0.x + px * half, y: ptr.w0.y + py * half }, '#e8c547', false, false); groundLine(ptr.w0, { x: ptr.w0.x + Math.cos(a) * 14, y: ptr.w0.y + Math.sin(a) * 14 }, '#e8c547', false, true); }
    const p = P(ptr.w0.x, ptr.w0.y, 3); plate(p[0], p[1] - 16, `${S.tool.toUpperCase()} ${grid(ptr.w0.x, ptr.w0.y)}${d > 4 ? ' · FACING' : ''}`, '#e8c547'); return;
  }
  if ((S.tool === 'attack' || S.tool === 'defend') && !ptr) { for (const s of S.selMany || []) { const c = sqCenter(s); if (c && MOVERS.includes(s.kind)) routeLine(s, { x: c[0], y: c[1] }, hover, 'rgba(232,197,71,.6)', S.tool === 'defend', true); } }
  if (ptr && ptr.mode === 'order') { const c = sqCenter(ptr.sq); if (!c) return; routeLine(ptr.sq, { x: c[0], y: c[1] }, ptr.w, '#e8c547', S.tool === 'defend', true); const b = P(ptr.w.x, ptr.w.y, 3); plate(b[0], b[1] - 16, `${S.tool.toUpperCase()} ${grid(ptr.w.x, ptr.w.y)}`, '#e8c547'); return; }
  if (tool.mode === 'point') {
    // Placing a unit: show where it will shoot (solid red) and how far it will see (dashed).
    const k = K[unitKind(S.tool)];
    // Garrison: outline the building under the cursor, red if it cannot be held.
    if (S.tool === 'garrison') { const ci = Math.floor(hover.y / C) * GW + Math.floor(hover.x / C), id = ci >= 0 ? M.bldId[ci] : -1; if (id >= 0) boxOutline(M.B[id], canDeploy(NET.me, M.B[id].cx, M.B[id].cy) ? '#8fe3a6' : '#f08a7a'); }
    if (k) {
      const sight = S.tool === 'op' ? opRange(hover) : k.sight + (S.tool === 'garrison' ? 15 : 0);
      if (k.range) { ring(hover.x, hover.y, k.range, 'rgba(255,122,114,.8)', false, 1.5); const p = P(hover.x + k.range, hover.y, 1); plate(p[0], p[1], `RANGE ${Math.round(k.range * M_PER_UNIT)} M`, '#ff7a72'); }
      if (k.min) { ring(hover.x, hover.y, k.min, 'rgba(255,122,114,.5)', true, 1); const p = P(hover.x + k.min, hover.y, 1); plate(p[0], p[1], `MIN ${Math.round(k.min * M_PER_UNIT)} M`, '#ff7a72'); }
      if (sight) { ring(hover.x, hover.y, sight, 'rgba(200,220,240,.7)', true, 1.5); const p = P(hover.x - sight, hover.y, 1); plate(p[0], p[1], `SEES ${Math.round(sight * M_PER_UNIT)} M`, '#c8dcf0'); }
    }
    const sup = S.tool === 'barrage' || S.tool === 'para' || S.tool === 'demo' || S.tool === 'smoke', placeOk = canPlaceUnit(NET.me, S.tool, hover.x, hover.y), apart = sup || spacingOk(NET.me, S.tool, hover.x, hover.y), mine = placeOk && apart, ok = (sup || mine) && left(NET.me) >= COST[S.tool];
    // Where new units can go: the start area, and for mortars, MG nests and posts, round your engineers too.
    if (!sup && S.tool !== 'garrison') {
      const z = S.teams[NET.me].zone; if (S.tool !== 'fob') ring(z.x, z.y, z.r, 'rgba(143,227,166,.75)', true, 1.5);
      if (S.tool === 'fob') for (const s of S.squads) if (s.team === NET.me && s.kind === 'engineers' && s.members) { const c = sqCenter(s); if (c) ring(c[0], c[1], ENG_R, 'rgba(143,227,166,.75)', true, 1.5); }
      if (ENG_BUILD.includes(S.tool)) for (const s of S.squads) if (s.team === NET.me && s.kind === 'fob' && s.members && s.readyRound <= S.round) { const c = sqCenter(s); if (c) ring(c[0], c[1], FOB_R, 'rgba(143,227,166,.6)', true, 1.5); }
    }
    ring(hover.x, hover.y, S.tool === 'barrage' ? 14 : S.tool === 'smoke' ? 20 : PLATOONS.includes(S.tool) ? 6 : 3, ok ? okC : badC, false);
    const c = P(hover.x, hover.y, 4); plate(c[0], c[1] - 20, `${tool.name} ${COST[S.tool]}${!ok && !sup && !mine ? (!apart && placeOk ? ' · TOO CLOSE' : S.tool === 'garrison' ? ' · NOT YOUR GROUND' : S.tool === 'fob' ? ' · NEAR YOUR ENGINEERS' : ENG_BUILD.includes(S.tool) ? ' · START AREA OR FOB' : ' · START AREA ONLY') : ''}`, ok ? okC : badC);
  }
}
