import { COST, TOOLDEF, segDist, clamp } from '../config';
import { S, M } from '../state';
import { nudge, canDeploy, bridgeNear, bridgeTouches } from '../world';
import { sqCenter, left, addSquad, addStruct, addSupport, lineCells, canRemove, removeItem } from '../plan';
import { cam, pick, panBy } from '../render/camera';
import { setSel, setTool, toast, showTerrain, syncSpeed, syncFollow } from './hud';

export const input: { ptr: any; hover: any } = { ptr: null, hover: null };
const keys = new Set<string>();

function hitTest(w: any, squadsOnly?: boolean) {
  let best: any = null, bd = 1e9; const consider = (it: any, d: number, lim: number) => { if (d < lim && d < bd) { bd = d; best = it; } };
  if (S.phase === 'plan') { for (const s of S.squads) { if (s.team !== 0) continue; const c = sqCenter(s); if (c) consider(s, Math.hypot(c[0] - w.x, c[1] - w.y), s.kind === 'rifles' ? 9 : 5); } }
  else {
    const v0 = S.vis[0];
    for (const u of S.units) { if (!u.alive || (u.team !== 0 && S.fog && !(v0 && v0[u.i]))) continue; const d = Math.hypot(u.x - w.x, u.y - w.y); if (d < 4 && d < bd) { bd = d; best = S.squads.find((s: any) => s.id === u.sq); } }
    if (best) return best;
  }
  if (squadsOnly || S.phase !== 'plan') return best;
  for (const s of S.supports) { if (s.team !== 0 || s.round !== S.round) continue; if (s.b) consider(s, segDist(w, s.a, s.b), 5); else consider(s, Math.hypot(s.a.x - w.x, s.a.y - w.y), s.type === 'barrage' ? 14 : 9); }
  for (const s of S.structs) { if (s.team !== 0) continue; consider(s, segDist(w, s.a, s.b), 3); }
  return best;
}
const stopFollow = () => { cam.userMoved = true; if (S.phase === 'replay' && S.follow) { S.follow = false; syncFollow(); } };

export function initInput(cv: HTMLCanvasElement) {
  const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    if (!M || S.phase === 'menu') return; cv.setPointerCapture(e.pointerId); const [sx, sy] = local(e);
    if (e.button === 1 || e.button === 2) { input.ptr = { mode: 'rot', lx: sx, ly: sy, moved: false, btn: e.button }; return; }
    const w = pick(sx, sy); if (!w || S.phase === 'replay') { input.ptr = { mode: 'pan', lx: sx, ly: sy, click: !w }; return; }
    const tool = TOOLDEF[S.tool];
    if (S.phase !== 'plan' || tool.mode === 'select') { const hit = hitTest(w); if (hit) { setSel(hit); input.ptr = { mode: 'none' }; } else input.ptr = { mode: 'pan', lx: sx, ly: sy, click: true }; return; }
    if (tool.mode === 'order') {
      const s = hitTest(w, true);
      if (!s || !(s.kind === 'rifles' || s.kind === 'sniper' || s.kind === 'tank')) { toast('Start the drag on one of your platoons, snipers or tanks'); input.ptr = { mode: 'none' }; return; }
      input.ptr = { mode: 'order', sq: s, w0: w, w }; setSel(s); return;
    }
    input.ptr = { mode: tool.mode, w0: w, w };
  });
  cv.addEventListener('pointermove', e => {
    if (!M || S.phase === 'menu') return; const [sx, sy] = local(e), ptr = input.ptr;
    if (ptr && ptr.mode === 'rot') { const dx = sx - ptr.lx, dy = sy - ptr.ly; ptr.lx = sx; ptr.ly = sy; if (dx || dy) { ptr.moved = true; cam.yaw -= dx * .006; cam.pitch = clamp(cam.pitch + dy * .005, .3, 1.45); stopFollow(); } return; }
    if (ptr && ptr.mode === 'pan') { const dx = sx - ptr.lx, dy = sy - ptr.ly; ptr.lx = sx; ptr.ly = sy; if (Math.abs(dx) + Math.abs(dy) > 1) { ptr.click = false; panBy(dx, dy); stopFollow(); } return; }
    const w = pick(sx, sy); input.hover = w; if (ptr && w) ptr.w = w; showTerrain(w);
  });
  cv.addEventListener('pointerup', () => {
    const p = input.ptr; if (!p) return; input.ptr = null;
    if (p.mode === 'rot') { if (!p.moved && p.btn === 2 && S.tool !== 'select') setTool('select'); return; }
    if (p.mode === 'pan') { if (p.click) setSel(null); return; }
    if (S.phase !== 'plan' || p.mode === 'none') return; const w = p.w, t = S.tool;
    if (p.mode === 'order') {
      const tg = nudge(w.x, w.y); if (!tg) { toast('No ground there'); return; } const c = sqCenter(p.sq);
      if (c && Math.hypot(tg[0] - c[0], tg[1] - c[1]) < 5) { p.sq.order = null; toast('Order cleared'); } else p.sq.order = { type: t, x: tg[0], y: tg[1] };
      setSel(p.sq); return;
    }
    if (p.mode === 'point') {
      if (left(0) < COST[t]) { toast('Not enough supply'); return; }
      if (t === 'demo') {
        const bi = bridgeNear(w.x, w.y); if (bi < 0) { toast('Click on a bridge'); return; }
        if (!bridgeTouches(bi, 0)) { toast('One end of the bridge must be on your ground'); return; }
        if (S.supports.some((s: any) => s.type === 'demo' && s.bridge === bi)) { toast('Charges are already set on this bridge'); return; }
        const br = M.bridges[bi], s = addSupport(0, 'demo', { x: br.cx, y: br.cy }, null, 20); s.bridge = bi; setSel(s); return;
      }
      if (t === 'barrage' || t === 'para') { setSel(addSupport(0, t, { x: w.x, y: w.y }, null, t === 'barrage' ? 15 : 30)); return; }
      if (!canDeploy(0, w.x, w.y)) { toast('You can only build on your own ground'); return; }
      const s = addSquad(0, t, w.x, w.y); if (!s) { toast(t === 'garrison' ? 'Click a building on your ground that is not held yet' : 'No open ground there'); return; }
      setSel(s); return;
    }
    if (p.mode === 'line') {
      const a = p.w0, b = w; if (Math.hypot(b.x - a.x, b.y - a.y) < 2) { toast('Drag to draw a line'); return; }
      if (t === 'air' || t === 'spy') { if (left(0) < COST[t]) { toast('Not enough supply'); return; } setSel(addSupport(0, t, { x: a.x, y: a.y }, { x: b.x, y: b.y }, t === 'spy' ? 5 : 25)); return; }
      const cells = lineCells(0, a, b); if (!cells.length) { toast('Defences go on open ground you hold'); return; }
      if (left(0) < cells.length * COST[t]) { toast('Not enough supply'); return; }
      setSel(addStruct(0, t, { x: a.x, y: a.y }, { x: b.x, y: b.y }));
    }
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); if (!M || S.phase === 'menu') return; const [sx, sy] = local(e), w = pick(sx, sy), old = cam.dist;
    cam.dist = clamp(cam.dist * Math.pow(1.0015, e.deltaY), 25, 700);
    if (w && e.deltaY < 0) { const f = 1 - cam.dist / old; cam.tx += (w.x - cam.tx) * f; cam.ty += (w.y - cam.ty) * f; }
    stopFollow();
  }, { passive: false });
  cv.addEventListener('pointerleave', () => { input.hover = null; showTerrain(null); });
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).closest && (e.target as HTMLElement).closest('input,textarea')) return; keys.add(e.key.toLowerCase());
    if (e.key === 'Escape') setTool('select');
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
