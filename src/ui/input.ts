import { NET } from '../state';
import { C, GW, COST, TOOLDEF, MOVERS, CX, CY, segDist, clamp } from '../config';
import { S, M } from '../state';
import { nudge, canDeploy, bridgeNear, bridgeTouches, cellOf, canPlaceUnit, ENG_BUILD, ENG_R, FOB_R } from '../world';
import { SUPPORT_ROUND, spacingOk } from '../plan';
import { M_PER_UNIT as MPU } from '../config';
import { sqCenter, left, addSquad, addStruct, addSupport, lineCells, canRemove, removeItem } from '../plan';
import { cam, pick, panBy, P, fit, fpv } from '../render/camera';
import { setSel, setTool, toast, cursorNote, syncSpeed, syncFollow, closeTools } from './hud';
import { actSquad, actStruct, actSupport, actOrders, actRemove, actSpeed } from '../actions';

// Left button selects and uses tools. Middle button pans. Right button turns the camera; a right click drops the tool.
export const input: { ptr: any; hover: any; box: any } = { ptr: null, hover: null, box: null };
const keys = new Set<string>();

const visibleNow = (u: any) => u.team === NET.me || !S.fog || (S.vis[NET.me] && S.vis[NET.me][u.i]);
function hitTest(w: any, squadsOnly?: boolean) {
  let best: any = null, bd = 1e9; const consider = (it: any, d: number, lim: number) => { if (d < lim && d < bd) { bd = d; best = it; } };
  if (S.phase === 'plan') { for (const s of S.squads) { if (s.team !== NET.me) continue; const c = sqCenter(s); if (c) consider(s, Math.hypot(c[0] - w.x, c[1] - w.y), s.kind === 'rifles' ? 9 : 5); } }
  else { for (const u of S.units) { if (!u.alive || !visibleNow(u)) continue; const d = Math.hypot(u.x - w.x, u.y - w.y); if (d < 4 && d < bd) { bd = d; best = S.squads.find((s: any) => s.id === u.sq); } } if (best) return best; }
  if (squadsOnly || S.phase !== 'plan') return best;
  for (const s of S.supports) { if (s.team !== NET.me || s.round !== S.round) continue; if (s.b) consider(s, segDist(w, s.a, s.b), 5); else consider(s, Math.hypot(s.a.x - w.x, s.a.y - w.y), s.type === 'barrage' ? 14 : 9); }
  for (const s of S.structs) { if (s.team !== NET.me) continue; consider(s, segDist(w, s.a, s.b), 3); }
  return best;
}
// Your units whose centre falls inside the screen rectangle.
function boxSelect(b: any) {
  const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1), out: any[] = [];
  for (const s of S.squads) { if (s.team !== NET.me) continue; const c = sqCenter(s); if (!c) continue; const p = P(c[0], c[1], 1); if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) out.push(s); }
  return out;
}
// Orders for several units at once: spread them across the target, side by side.
// face: the way they face at the target, in radians; without it they face the way they walked.
function orderGroup(group: any[], type: string, w: any, face?: number) {
  const movers = group.filter(s => MOVERS.includes(s.kind) && (!s.members || s.members.some((i: number) => S.units[i].alive)));
  if (!movers.length) { toast('Select platoons, snipers or tanks to give them orders'); return; }
  let gx = 0, gy = 0; const cs = movers.map(s => sqCenter(s)); cs.forEach(c => { gx += c[0]; gy += c[1]; }); gx /= cs.length; gy /= cs.length;
  let dx = w.x - gx, dy = w.y - gy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  if (face != null) { dx = Math.cos(face); dy = Math.sin(face); }
  const dir = Math.atan2(dy, dx);
  const list: any[] = []; movers.forEach((s, k) => { const off = (k - (movers.length - 1) / 2) * 11, q = nudge(w.x - dy * off, w.y + dx * off); if (q) list.push({ id: s.id, type, x: q[0], y: q[1], dir, via: S.via ? { x: S.via.x - dy * off, y: S.via.y + dx * off } : null }); });
  S.via = null;
  actOrders(list);
  // Order given: clear the selection, ready for the next unit.
  setSel(null);
}
const stopFollow = () => { cam.userMoved = true; if (S.phase === 'replay' && S.follow) { S.follow = false; syncFollow(); } };
function hoverCursor(cv: HTMLCanvasElement, w: any) {
  if (S.tool !== 'select' && S.phase === 'plan') { cv.style.cursor = 'crosshair'; return; }
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
    const live = S.phase === 'plan';
    if (!live || tool.mode === 'select') { input.ptr = { mode: 'box', x0: sx, y0: sy, w, shift: e.shiftKey }; return; }
    if (!w) return;
    if (tool.mode === 'order') {
      // Press on the target for the selected units; drag from there to set the way they face.
      const sel = (S.selMany || []).filter((s: any) => S.tool === 'demolish' ? s.kind === 'engineers' : MOVERS.includes(s.kind));
      if (sel.length) { input.ptr = { mode: 'orderGroup', w0: w, w, shift: e.shiftKey }; return; }
      toast('Select your platoons, snipers or tanks first'); return;
    }
    input.ptr = { mode: tool.mode, w0: w, w };
  });
  cv.addEventListener('pointermove', e => {
    if (!M || S.phase === 'menu') return; const [sx, sy] = local(e), ptr = input.ptr;
    if (ptr && ptr.mode === 'rot') { const dx = sx - ptr.lx, dy = sy - ptr.ly; ptr.lx = sx; ptr.ly = sy; if (fpv.on && Math.abs(dx) + Math.abs(dy) > 0) { ptr.moved = true; fpv.look += dx * .005; fpv.pitch = clamp(fpv.pitch - dy * .004, -.9, .6); return; } if (Math.abs(dx) + Math.abs(dy) > 0) { ptr.moved = true; cam.yaw -= dx * .006; cam.pitch = clamp(cam.pitch + dy * .005, .3, 1.45); stopFollow(); } return; }
    if (ptr && ptr.mode === 'pan') { const dx = sx - ptr.lx, dy = sy - ptr.ly; ptr.lx = sx; ptr.ly = sy; if (dx || dy) { panBy(dx, dy); stopFollow(); } return; }
    if (ptr && ptr.mode === 'box') { if (Math.abs(sx - ptr.x0) + Math.abs(sy - ptr.y0) > 5) input.box = { x0: ptr.x0, y0: ptr.y0, x1: sx, y1: sy }; return; }
    const w = pick(sx, sy); input.hover = w; if (ptr && w) ptr.w = w;
    cursorNote(w, sx, sy); if (!ptr) hoverCursor(cv, w);
  });
  cv.addEventListener('pointerup', () => {
    const p = input.ptr; if (!p) return; input.ptr = null;
    if (p.mode === 'pan') { hoverCursor(cv, input.hover); return; }
    // A right click drops the tool in hand; the build menu stays open.
    if (p.mode === 'rot') { if (!p.moved) { if (S.tool !== 'select') setTool('select'); else setSel(null); } return; }
    if (p.mode === 'box') {
      const b = input.box; input.box = null;
      if (b) { const found = boxSelect(b); setSel(found.length === 1 ? found[0] : null, p.shift ? [...new Set([...(S.selMany || []), ...found])] : found); return; }
      // Nothing of yours under the click: a building there shows what it is.
      let hit = p.w ? hitTest(p.w) : null;
      if (!hit && p.w) { const ci = cellOf(p.w.x, p.w.y), id = ci >= 0 ? M.bldId[ci] : -1; if (id >= 0) hit = { building: M.B[M.B[id].parent ?? id] }; }
      if (p.shift && hit && hit.pos && hit.team === NET.me) { const many = new Set(S.selMany || []); many.has(hit) ? many.delete(hit) : many.add(hit); const arr = [...many]; setSel(arr.length === 1 ? arr[0] : null, arr); }
      else setSel(hit);
      return;
    }
    if (S.phase !== 'plan' && S.phase !== 'battle') return; const w = p.w, t = S.tool;
    // During a battle, whatever is placed acts at once.
    const done = (it: any) => setSel(it);
    if (p.mode === 'orderGroup' && t === 'demolish') {
      // Engineers: the click picks the bridge or building to blow up.
      const bi = bridgeNear(p.w0.x, p.w0.y), ci = cellOf(p.w0.x, p.w0.y), id = ci >= 0 ? M.bldId[ci] : -1;
      let x: number, y: number, extra: any;
      if (bi >= 0) { const br = M.bridges[bi]; const end = br.ends[0]; x = end != null ? (end % GW) * C + 1 : br.cx; y = end != null ? Math.floor(end / GW) * C + 1 : br.cy; extra = { bridge: bi }; }
      else if (id >= 0) { const bd = M.B[id], q = nudge(bd.cx, bd.cy); x = q ? q[0] : bd.cx; y = q ? q[1] : bd.cy; extra = { bld: id }; }
      else { toast('Click a bridge or a building'); return; }
      const eng = S.selMany.filter((s: any) => s.kind === 'engineers');
      actOrders(eng.map((s: any) => ({ id: s.id, type: 'demolish', x, y, ...extra }))); setTool('select'); setSel(null); toast('Engineers are on their way'); return;
    }
    if (p.mode === 'aim') {
      // Sniper: where it stands, and the way it watches (towards the centre if not dragged).
      const a = p.w0, dragged = Math.hypot(w.x - a.x, w.y - a.y) > 3, face = dragged ? Math.atan2(w.y - a.y, w.x - a.x) : Math.atan2(CY - a.y, CX - a.x);
      if (left(NET.me) < COST[t]) { toast('Not enough supply'); return; }
      if (!canPlaceUnit(NET.me, t, a.x, a.y)) { toast('New units go in your start area'); return; }
      if (!spacingOk(NET.me, t, a.x, a.y)) { toast('Too close to another unit. Spread them out.'); return; }
      done(actSquad(t, a.x, a.y, face)); return;
    }
    // Shift-click first sets a waypoint (to go round a flank); the next click sets the goal.
    if (p.mode === 'orderGroup' && p.shift && S.tool !== 'demolish') { S.via = { x: p.w0.x, y: p.w0.y }; toast('Waypoint set. Now click the goal.'); return; }
    if (p.mode === 'orderGroup') { const dragged = Math.hypot(w.x - p.w0.x, w.y - p.w0.y) > 4; orderGroup(S.selMany, t, p.w0, dragged ? Math.atan2(w.y - p.w0.y, w.x - p.w0.x) : undefined); setTool('select'); return; }
    if (p.mode === 'point') {
      if (left(NET.me) < COST[t]) { toast('Not enough supply'); return; }
      if (['demo', 'barrage', 'para'].includes(t) && S.round < SUPPORT_ROUND) { toast(`Support is ready from phase ${SUPPORT_ROUND}`); return; }
      if (t === 'demo') {
        const bi = bridgeNear(w.x, w.y);
        if (bi < 0) {
          // Not a bridge: a building on your own ground can be demolished too.
          const ci = cellOf(w.x, w.y), id = ci >= 0 ? M.bldId[ci] : -1;
          if (id < 0) { toast('Click a bridge or a building'); return; }
          const bd = M.B[id];
          if (S.supports.some((s: any) => s.type === 'demo' && s.bld === id)) { toast('Charges are already set on this building'); return; }
          done(actSupport('demo', { x: bd.cx, y: bd.cy }, null, 20, undefined, id)); return;
        }
        if (S.supports.some((s: any) => s.type === 'demo' && s.bridge === bi)) { toast('Charges are already set on this bridge'); return; }
        const br = M.bridges[bi]; done(actSupport('demo', { x: br.cx, y: br.cy }, null, 20, bi)); return;
      }
      if (t === 'barrage' || t === 'para' || t === 'smoke') { done(actSupport(t, { x: w.x, y: w.y }, null, t === 'barrage' ? 15 : t === 'smoke' ? 5 : 30)); return; }
      if (!canPlaceUnit(NET.me, t, w.x, w.y)) { toast(t === 'garrison' ? 'Pick a building on your own ground' : t === 'fob' ? `Engineers build FOBs: within ${Math.round(ENG_R * MPU)} m of your engineers` : ENG_BUILD.includes(t) ? `Start area, or within ${Math.round(FOB_R * MPU)} m of a finished FOB` : 'New units go in your start area'); return; }
      if (!spacingOk(NET.me, t, w.x, w.y)) { toast('Too close to another unit. Spread them out.'); return; }
      const s = actSquad(t, w.x, w.y); if (!s && NET.mode !== 'guest') { toast(t === 'garrison' ? 'Click a building on your ground that is not held yet' : 'No open ground there'); return; }
      done(s); return;
    }
    if (p.mode === 'line') {
      const a = p.w0, b = w; if (Math.hypot(b.x - a.x, b.y - a.y) < 2) { toast('Drag to draw a line'); return; }
      if ((t === 'air' || t === 'spy') && S.round < SUPPORT_ROUND) { toast(`Support is ready from phase ${SUPPORT_ROUND}`); return; }
      if (t === 'air' || t === 'spy') { if (left(NET.me) < COST[t]) { toast('Not enough supply'); return; } done(actSupport(t, { x: a.x, y: a.y }, { x: b.x, y: b.y }, t === 'spy' ? 5 : 25)); return; }
      const cells = lineCells(NET.me, a, b); if (!cells.length) { toast('Defences go on open ground you hold'); return; }
      if (left(NET.me) < cells.length * COST[t]) { toast('Not enough supply'); return; }
      done(actStruct(t, { x: a.x, y: a.y }, { x: b.x, y: b.y }));
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
    if (e.key === 'Escape' && S.fpv != null) { S.fpv = null; return; }
    if (e.key === 'Escape') { if (S.tool !== 'select') setTool('select'); else setSel(null); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && canRemove(S.sel)) { actRemove(S.sel.id); setSel(null); e.preventDefault(); }
    // Space begins the phase. Return at once, so the same key press does not also pause the battle it started.
    if (e.key === ' ' && S.phase === 'plan') { (document.getElementById('bBegin') as HTMLButtonElement).click(); e.preventDefault(); return; }
    if (e.key === ' ' && (S.phase === 'battle' || S.phase === 'replay')) { if (S.phase === 'replay') S.paused = !S.paused; else actSpeed(0); syncSpeed(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase())); window.addEventListener('blur', () => keys.clear());
}
export function keyCam(dt: number) {
  if (S.phase === 'menu') return; let dx = 0, dy = 0;
  if (keys.has('a')) dx += 1; if (keys.has('d')) dx -= 1; if (keys.has('w')) dy += 1; if (keys.has('s')) dy -= 1;
  if (dx || dy) { S.fpv = null; panBy(dx * 600 * dt, dy * 600 * dt); stopFollow(); }
  if (keys.has('q')) { cam.yaw += dt * 1.2; stopFollow(); } if (keys.has('e')) { cam.yaw -= dt * 1.2; stopFollow(); }
}
