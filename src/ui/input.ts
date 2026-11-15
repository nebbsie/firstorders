import { COST, TOOLDEF, segDist, clamp } from '../config';
import { S, M } from '../state';
import { nudge, canDeploy, bridgeNear, bridgeTouches } from '../world';
import { sqCenter, left, addSquad, addStruct, addSupport, lineCells, canRemove, removeItem } from '../plan';
import { cam, pick, panBy, P, fit } from '../render/camera';
import { setSel, setTool, toast, cursorNote, syncSpeed, syncFollow, closeTools } from './hud';
import { goLive, applyOrder } from '../sim';

// Left button selects and uses tools. Middle button pans. Right button turns the camera; a right click drops the tool.
export const input: { ptr: any; hover: any; box: any } = { ptr: null, hover: null, box: null };
const keys = new Set<string>();
const MOVERS = ['rifles', 'sniper', 'tank'];

const visibleNow = (u: any) => u.team === 0 || !S.fog || (S.vis[0] && S.vis[0][u.i]);
function hitTest(w: any, squadsOnly?: boolean) {
  let best: any = null, bd = 1e9; const consider = (it: any, d: number, lim: number) => { if (d < lim && d < bd) { bd = d; best = it; } };
  if (S.phase === 'plan') { for (const s of S.squads) { if (s.team !== 0) continue; const c = sqCenter(s); if (c) consider(s, Math.hypot(c[0] - w.x, c[1] - w.y), s.kind === 'rifles' ? 9 : 5); } }
  else { for (const u of S.units) { if (!u.alive || !visibleNow(u)) continue; const d = Math.hypot(u.x - w.x, u.y - w.y); if (d < 4 && d < bd) { bd = d; best = S.squads.find((s: any) => s.id === u.sq); } } if (best) return best; }
  if (squadsOnly || S.phase !== 'plan') return best;
  for (const s of S.supports) { if (s.team !== 0 || s.round !== S.round) continue; if (s.b) consider(s, segDist(w, s.a, s.b), 5); else consider(s, Math.hypot(s.a.x - w.x, s.a.y - w.y), s.type === 'barrage' ? 14 : 9); }
  for (const s of S.structs) { if (s.team !== 0) continue; consider(s, segDist(w, s.a, s.b), 3); }
  return best;
}
// Your units whose centre falls inside the screen rectangle.
function boxSelect(b: any) {
  const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1), out: any[] = [];
  for (const s of S.squads) { if (s.team !== 0) continue; const c = sqCenter(s); if (!c) continue; const p = P(c[0], c[1], 1); if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) out.push(s); }
  return out;
}
// Orders for several units at once: spread them across the target, side by side.
function orderGroup(group: any[], type: string, w: any) {
  const movers = group.filter(s => MOVERS.includes(s.kind) && (!s.members || s.members.some((i: number) => S.units[i].alive)));
  if (!movers.length) { toast('Select platoons, snipers or tanks to give them orders'); return; }
  let gx = 0, gy = 0; const cs = movers.map(s => sqCenter(s)); cs.forEach(c => { gx += c[0]; gy += c[1]; }); gx /= cs.length; gy /= cs.length;
  let dx = w.x - gx, dy = w.y - gy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  movers.forEach((s, k) => { const off = (k - (movers.length - 1) / 2) * 11, q = nudge(w.x - dy * off, w.y + dx * off); if (q) { s.order = { type, x: q[0], y: q[1] }; if (S.phase === 'battle') applyOrder(s); } });
  setSel(movers.length === 1 ? movers[0] : null, movers);
}
const stopFollow = () => { cam.userMoved = true; if (S.phase === 'replay' && S.follow) { S.follow = false; syncFollow(); } };
function hoverCursor(cv: HTMLCanvasElement, w: any) {
  if (S.tool !== 'select' && (S.phase === 'plan' || S.phase === 'battle')) { cv.style.cursor = 'crosshair'; return; }
  cv.style.cursor = w && S.phase !== 'replay' && hitTest(w) ? 'pointer' : 'default';
}

export function initInput(cv: HTMLCanvasElement) {
  const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    if (!M || S.phase === 'menu') return; cv.setPointerCapture(e.pointerId); const [sx, sy] = local(e);
    if (e.button === 1) { e.preventDefault(); input.ptr = { mode: 'pan', lx: sx, ly: sy }; cv.style.cursor = 'move'; return; }
    if (e.button === 2) { input.ptr = { mode: 'rot', lx: sx, ly: sy, moved: false }; return; }
    if (S.phase === 'replay') return;
    const w = pick(sx, sy), tool = TOOLDEF[S.tool];
    const live = S.phase === 'plan' || S.phase === 'battle';
    if (!live || tool.mode === 'select') { input.ptr = { mode: 'box', x0: sx, y0: sy, w, shift: e.shiftKey }; return; }
    if (!w) return;
    if (tool.mode === 'order') {
      const own = hitTest(w, true), sel = (S.selMany || []).filter((s: any) => MOVERS.includes(s.kind));
      // Drag from one of your units to order just that unit; otherwise the click is the target for the selection.
      if (own && MOVERS.includes(own.kind) && !sel.includes(own)) { input.ptr = { mode: 'order', sq: own, w0: w, w }; setSel(own); return; }
      if (sel.length) { input.ptr = { mode: 'orderGroup', w }; return; }
      toast('Select your platoons, snipers or tanks first'); return;
    }
    input.ptr = { mode: tool.mode, w0: w, w };
  });
  cv.addEventListener('pointermove', e => {
    if (!M || S.phase === 'menu') return; const [sx, sy] = local(e), ptr = input.ptr;
    if (ptr && ptr.mode === 'rot') { const dx = sx - ptr.lx, dy = sy - ptr.ly; ptr.lx = sx; ptr.ly = sy; if (Math.abs(dx) + Math.abs(dy) > 0) { ptr.moved = true; cam.yaw -= dx * .006; cam.pitch = clamp(cam.pitch + dy * .005, .3, 1.45); stopFollow(); } return; }
    if (ptr && ptr.mode === 'pan') { const dx = sx - ptr.lx, dy = sy - ptr.ly; ptr.lx = sx; ptr.ly = sy; if (dx || dy) { panBy(dx, dy); stopFollow(); } return; }
    if (ptr && ptr.mode === 'box') { if (Math.abs(sx - ptr.x0) + Math.abs(sy - ptr.y0) > 5) input.box = { x0: ptr.x0, y0: ptr.y0, x1: sx, y1: sy }; return; }
    const w = pick(sx, sy); input.hover = w; if (ptr && w) ptr.w = w;
    cursorNote(w, sx, sy); if (!ptr) hoverCursor(cv, w);
  });
  cv.addEventListener('pointerup', () => {
    const p = input.ptr; if (!p) return; input.ptr = null;
    if (p.mode === 'pan') { hoverCursor(cv, input.hover); return; }
    if (p.mode === 'rot') { if (!p.moved) { if (S.tool !== 'select') { closeTools(); setTool('select'); } else setSel(null); } return; }
    if (p.mode === 'box') {
      const b = input.box; input.box = null;
      if (b) { const found = boxSelect(b); setSel(found.length === 1 ? found[0] : null, p.shift ? [...new Set([...(S.selMany || []), ...found])] : found); return; }
      const hit = p.w ? hitTest(p.w) : null;
      if (p.shift && hit && hit.pos && hit.team === 0) { const many = new Set(S.selMany || []); many.has(hit) ? many.delete(hit) : many.add(hit); const arr = [...many]; setSel(arr.length === 1 ? arr[0] : null, arr); }
      else setSel(hit);
      return;
    }
    if (S.phase !== 'plan' && S.phase !== 'battle') return; const w = p.w, t = S.tool;
    // During a battle, whatever is placed acts at once.
    const done = (it: any) => { if (it && S.phase === 'battle') goLive(it); setSel(it); };
    if (p.mode === 'orderGroup') { orderGroup(S.selMany, t, w); return; }
    if (p.mode === 'order') {
      const c = sqCenter(p.sq); if (c && Math.hypot(w.x - c[0], w.y - c[1]) < 5) { if (S.selMany.length > 1) orderGroup(S.selMany, t, w); return; }
      orderGroup([p.sq], t, w); return;
    }
    if (p.mode === 'point') {
      if (left(0) < COST[t]) { toast('Not enough supply'); return; }
      if (t === 'demo') {
        const bi = bridgeNear(w.x, w.y); if (bi < 0) { toast('Click on a bridge'); return; }
        if (!bridgeTouches(bi, 0)) { toast('One end of the bridge must be on your ground'); return; }
        if (S.supports.some((s: any) => s.type === 'demo' && s.bridge === bi)) { toast('Charges are already set on this bridge'); return; }
        const br = M.bridges[bi], s = addSupport(0, 'demo', { x: br.cx, y: br.cy }, null, 20); s.bridge = bi; done(s); return;
      }
      if (t === 'barrage' || t === 'para') { done(addSupport(0, t, { x: w.x, y: w.y }, null, t === 'barrage' ? 15 : 30)); return; }
      if (!canDeploy(0, w.x, w.y)) { toast('You can only build on your own ground'); return; }
      const s = addSquad(0, t, w.x, w.y); if (!s) { toast(t === 'garrison' ? 'Click a building on your ground that is not held yet' : 'No open ground there'); return; }
      done(s); return;
    }
    if (p.mode === 'line') {
      const a = p.w0, b = w; if (Math.hypot(b.x - a.x, b.y - a.y) < 2) { toast('Drag to draw a line'); return; }
      if (t === 'air' || t === 'spy') { if (left(0) < COST[t]) { toast('Not enough supply'); return; } done(addSupport(0, t, { x: a.x, y: a.y }, { x: b.x, y: b.y }, t === 'spy' ? 5 : 25)); return; }
      const cells = lineCells(0, a, b); if (!cells.length) { toast('Defences go on open ground you hold'); return; }
      if (left(0) < cells.length * COST[t]) { toast('Not enough supply'); return; }
      done(addStruct(0, t, { x: a.x, y: a.y }, { x: b.x, y: b.y }));
    }
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); if (!M || S.phase === 'menu') return; const [sx, sy] = local(e), w = pick(sx, sy), old = cam.dist;
    cam.dist = clamp(cam.dist * Math.pow(1.0015, e.deltaY), 25, 900);
    if (w && e.deltaY < 0) { const f = 1 - cam.dist / old; cam.tx += (w.x - cam.tx) * f; cam.ty += (w.y - cam.ty) * f; }
    stopFollow();
  }, { passive: false });
  cv.addEventListener('pointerleave', () => { input.hover = null; cursorNote(null, 0, 0); });
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).closest && (e.target as HTMLElement).closest('input,textarea')) return; keys.add(e.key.toLowerCase());
    if (e.key === 'Home') { cam.userMoved = false; fit(); }
    if (e.key === 'Escape') { if (S.tool !== 'select') { closeTools(); setTool('select'); } else setSel(null); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && canRemove(S.sel)) { removeItem(S.sel); setSel(null); e.preventDefault(); }
    if (e.key === ' ' && (S.phase === 'battle' || S.phase === 'replay')) { S.paused = !S.paused; syncSpeed(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase())); window.addEventListener('blur', () => keys.clear());
}
export function keyCam(dt: number) {
  if (S.phase === 'menu') return; let dx = 0, dy = 0;
  if (keys.has('a')) dx += 1; if (keys.has('d')) dx -= 1; if (keys.has('w')) dy += 1; if (keys.has('s')) dy -= 1;
  if (dx || dy) { panBy(dx * 600 * dt, dy * 600 * dt); stopFollow(); }
  if (keys.has('q')) { cam.yaw += dt * 1.2; stopFollow(); } if (keys.has('e')) { cam.yaw -= dt * 1.2; stopFollow(); }
}
