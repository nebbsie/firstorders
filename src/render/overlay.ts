import { C, GW, IW, IC, COST, TOOLDEF, TEAM_COLORS, SUP_NAME, GRID_X0, GRID_Y0, grid } from '../config';
import { S, SEEN0 } from '../state';
import { canDeploy } from '../world';
import { sqCenter, left, lineCells } from '../plan';
import { P, view } from './camera';
import { input } from '../ui/input';

let ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement;
export function initOverlay(c: HTMLCanvasElement) { cv = c; ctx = c.getContext('2d'); }
export function resizeOverlay() { cv.width = Math.round(view.cw * view.dpr); cv.height = Math.round(view.ch * view.dpr); }

function plate(x: number, y: number, text: string, col: string) {
  if (x < -500) return; ctx.font = '11px Departure, ui-monospace, monospace';
  const w = Math.round(ctx.measureText(text).width + 10); x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(16,20,28,.92)'; ctx.fillRect(x - (w >> 1), y - 8, w, 16); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - (w >> 1) + .5, y - 7.5, w - 1, 15);
  ctx.fillStyle = '#f4f1e8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
}
function groundLine(a: any, b: any, col: string, dash: boolean, head: boolean) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6)); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash ? [6, 4] : []); ctx.beginPath();
  let last: number[] = null, prev: number[] = null;
  for (let i = 0; i <= n; i++) { const p = P(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, 1.5); if (p[0] < -500) continue; if (!last) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); prev = last; last = p; }
  ctx.stroke(); ctx.setLineDash([]);
  if (head && last && prev) { const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(last[0] - Math.cos(ang - .45) * 11, last[1] - Math.sin(ang - .45) * 11); ctx.lineTo(last[0] - Math.cos(ang + .45) * 11, last[1] - Math.sin(ang + .45) * 11); ctx.closePath(); ctx.fill(); }
}
function ring(x: number, y: number, r: number, col: string, dash: boolean, w?: number) {
  ctx.strokeStyle = col; ctx.lineWidth = w || 1.5; ctx.setLineDash(dash ? [4, 3] : []); ctx.beginPath(); let first = true;
  for (let i = 0; i <= 32; i++) { const a = i / 32 * 6.283, p = P(x + Math.cos(a) * r, y + Math.sin(a) * r, .6); if (p[0] < -500) { first = true; continue; } if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); }
  ctx.stroke(); ctx.setLineDash([]);
}

export function draw2D() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const plan = S.phase === 'plan';
  ctx.font = '11px Departure, ui-monospace, monospace'; ctx.fillStyle = 'rgba(232,197,71,.8)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) { const p = P(GRID_X0 + i * 40 + 20, GRID_Y0 - 8, 0); if (p[0] > -500) ctx.fillText('ABCDEFGHJK'[i], p[0], p[1]); }
  for (let j = 0; j < 10; j++) { const p = P(GRID_X0 - 9, GRID_Y0 + j * 40 + 20, 0); if (p[0] > -500) ctx.fillText(String(j + 1), p[0], p[1]); }
  if (S.phase === 'replay') return;
  // Enemy HQs show only once your side has seen that ground.
  const seenAt = (x: number, y: number) => !S.fog || SEEN0[Math.floor(y / IC) * IW + Math.floor(x / IC)];
  if (plan) for (const t of S.teams) { if (t.id !== 0 && !seenAt(t.zone.x, t.zone.y)) continue; const c = P(t.zone.x, t.zone.y, 12); plate(c[0], c[1], t.id === 0 ? 'YOUR HQ' : `${t.name} HQ`, t.color); }
  ctx.globalAlpha = plan ? 1 : .4;
  for (const s of S.squads) {
    if (s.team !== 0) continue; const o = plan ? s.order : s.cur; if (!o) continue; const c = sqCenter(s); if (!c) continue; const col = TEAM_COLORS[0];
    if (o.type === 'defend') ring(o.x, o.y, 16, col, true);
    groundLine({ x: c[0], y: c[1] }, o, col, o.type === 'defend', true);
    if (plan && (S.selMany || []).includes(s)) { const m = P(o.x, o.y, 3); plate(m[0], m[1] - 14, `${s.call || ''} ${o.type.toUpperCase()} ${grid(o.x, o.y)}`.trim(), col); }
  }
  for (const s of S.supports) {
    if (s.round !== S.round || s.team !== 0 || (!plan && s.fired)) continue;
    const col = s.type === 'spy' ? '#b8c0cc' : '#e8892e', lab = SUP_NAME[s.type] + ' T+' + Math.floor(s.t);
    if (s.b) { groundLine(s.a, s.b, col, true, true); const p = P(s.a.x, s.a.y, 4); if (plan) plate(p[0], p[1] - 12, lab, col); }
    else { ring(s.a.x, s.a.y, s.type === 'barrage' ? 14 : 9, col, false); const p = P(s.a.x, s.a.y, 6); if (plan) plate(p[0], p[1] - 12, lab, col); }
  }
  ctx.globalAlpha = 1;
  if (plan) for (const s of S.squads) { if (s.team !== 0 || !s.call) continue; const c = sqCenter(s); if (!c) continue; const p = P(c[0], c[1], 5); ctx.fillStyle = '#f4f1e8'; ctx.font = '11px Departure, monospace'; ctx.textAlign = 'center'; ctx.fillText(s.call, p[0], p[1] - 6); }
  if (S.sel) {
    const it = S.sel; let c: number[] = null, r = 8;
    if (it.pos) { c = sqCenter(it); r = it.kind === 'rifles' ? 9 : 4; }
    else if (it.cells) { c = [(it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2]; r = Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y) / 2 + 3; }
    else if (it.a) { c = it.b ? [(it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2] : [it.a.x, it.a.y]; r = it.b ? Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y) / 2 : 16; }
    if (c && !it.pos) ring(c[0], c[1], r, '#e8c547', false, 2);
  }
  for (const s of S.selMany || []) { const c = sqCenter(s); if (c) ring(c[0], c[1], s.kind === 'rifles' ? 9 : 4, '#e8c547', false, 2); }
  const b = input.box; if (b) { ctx.strokeStyle = '#e8c547'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(232,197,71,.08)'; const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0); ctx.fillRect(x, y, w, h); ctx.strokeRect(x + .5, y + .5, w, h); }
  drawGhost();
}
function drawGhost() {
  const hover = input.hover, ptr = input.ptr; if (S.phase !== 'plan' || !hover) return;
  const tool = TOOLDEF[S.tool]; if (tool.mode === 'select') return; const okC = '#8fe3a6', badC = '#f08a7a';
  if (ptr && ptr.mode === 'line') {
    let label: string, ok: boolean;
    if (S.tool === 'air' || S.tool === 'spy') { label = `${tool.name} ${COST[S.tool]}`; ok = left(0) >= COST[S.tool]; }
    else {
      const cells = lineCells(0, ptr.w0, ptr.w), c = cells.length * COST[S.tool]; ok = cells.length > 0 && left(0) >= c; label = `${cells.length} CELLS · ${c}`;
      ctx.fillStyle = ok ? 'rgba(143,227,166,.5)' : 'rgba(240,138,122,.5)';
      for (const ci of cells) { const x = (ci % GW) * C, y = Math.floor(ci / GW) * C; const q = [P(x, y, .3), P(x + C, y, .3), P(x + C, y + C, .3), P(x, y + C, .3)]; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.fill(); }
    }
    groundLine(ptr.w0, ptr.w, ok ? okC : badC, true, S.tool === 'air' || S.tool === 'spy'); const b = P(ptr.w.x, ptr.w.y, 3); plate(b[0], b[1] - 16, label, ok ? okC : badC); return;
  }
  if (ptr && ptr.mode === 'orderGroup') return;
  if (S.tool === 'attack' || S.tool === 'defend') { for (const s of S.selMany || []) { const c = sqCenter(s); if (c && ['rifles', 'sniper', 'tank'].includes(s.kind)) groundLine({ x: c[0], y: c[1] }, hover, 'rgba(232,197,71,.6)', S.tool === 'defend', true); } }
  if (ptr && ptr.mode === 'order') { const c = sqCenter(ptr.sq); if (!c) return; groundLine({ x: c[0], y: c[1] }, ptr.w, '#e8c547', S.tool === 'defend', true); const b = P(ptr.w.x, ptr.w.y, 3); plate(b[0], b[1] - 16, `${S.tool.toUpperCase()} ${grid(ptr.w.x, ptr.w.y)}`, '#e8c547'); return; }
  if (tool.mode === 'point') {
    const sup = S.tool === 'barrage' || S.tool === 'para' || S.tool === 'demo', mine = canDeploy(0, hover.x, hover.y), ok = (sup || mine) && left(0) >= COST[S.tool];
    ring(hover.x, hover.y, S.tool === 'barrage' ? 14 : S.tool === 'rifles' ? 6 : 3, ok ? okC : badC, false);
    const c = P(hover.x, hover.y, 4); plate(c[0], c[1] - 20, `${tool.name} ${COST[S.tool]}${!ok && !sup && !mine ? ' · NOT YOUR GROUND' : ''}`, ok ? okC : badC);
  }
}
