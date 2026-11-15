import { NET } from './state';
import { clamp } from './config';
import { S, OWN, VIS0, SEEN0 } from './state';
import { cam } from './render/camera';
import { paintTerritory, paintFog, type View } from './render/scene';

// What the player sees during planning and battle: their own side, plus what they have spotted.
export function liveView(): View {
  const fogOn = S.fog && (S.phase === 'plan' || S.phase === 'battle');
  const ghosts: any[] = [];
  if (fogOn && S.known[NET.me]) {
    const v0 = S.vis[NET.me];
    for (const g of S.known[NET.me].values()) { if (v0 && v0[g.i]) continue; if (S.phase === 'plan' || S.t - g.t < 20) ghosts.push(g); }
  }
  return { units: S.units, tracers: S.tracers, fx: S.fx, craters: S.craters, shells: S.shells, planes: S.planes, bombs: S.bombs, fogOn, isVis: u => !!(S.vis[NET.me] && S.vis[NET.me][u.i]), ghosts, seen: SEEN0, vis: VIS0 };
}

function lbT(arr: any[], t: number, key?: boolean) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if ((key ? arr[m].t : arr[m][0]) < t) lo = m + 1; else hi = m; } return lo; }
const RV: View = { units: [], tracers: [], fx: [], craters: [], shells: [], planes: [], bombs: [], fogOn: false, isVis: u => u.v, ghosts: [], seen: VIS0, vis: VIS0 };
const pool: any[] = []; let ownIdx = -1, fogKey = '';
export function replayView(): View {
  const R = S.rec, rt = S.rt, F = R.frames; let i = Math.max(0, lbT(F, rt, true) - 1); if (i < F.length - 1 && F[i + 1].t <= rt) i++;
  const f0 = F[i], f1 = F[Math.min(i + 1, F.length - 1)], a = f1.t > f0.t ? clamp((rt - f0.t) / (f1.t - f0.t), 0, 1) : 0;
  const us = RV.units; us.length = f0.n;
  for (let j = 0; j < f0.n; j++) {
    const o = pool[j] || (pool[j] = {}), m = R.meta[j], al = f0.al[j];
    o.team = m.team; o.kind = m.kind; o.alive = (al & 3) > 0; o.drop = (al & 3) === 2 ? .6 : 0; o.v = (al & 4) > 0;
    let x = f0.xy[j * 2], y = f0.xy[j * 2 + 1];
    if (j < f1.n && (f1.al[j] & 3) > 0 && o.alive) { const ex = f1.xy[j * 2] - x, ey = f1.xy[j * 2 + 1] - y; if (ex * ex + ey * ey > 1e-4) o.hd = Math.atan2(-ey, ex); x += ex * a; y += ey * a; }
    o.x = x; o.y = y; us[j] = o;
  }
  RV.tracers = []; for (let k = lbT(R.tracers, rt - .09); k < R.tracers.length && R.tracers[k][0] <= rt; k++) { const q = R.tracers[k]; RV.tracers.push({ x0: q[1], y0: q[2], x1: q[3], y1: q[4], team: q[5] }); }
  const bEnd = lbT(R.booms, rt + 1e-6); RV.fx = []; for (let k = lbT(R.booms, rt - .6); k < bEnd; k++) { const q = R.booms[k]; RV.fx.push({ x: q[1], y: q[2], r: q[3], life: .6 - (rt - q[0]), max: .6 }); }
  RV.craters = []; for (let k = Math.max(0, bEnd - 600); k < bEnd; k++) { const q = R.booms[k]; RV.craters.push({ x: q[1], y: q[2], r: q[3] * .55 }); }
  RV.shells = []; for (const q of R.shells) if (q[0] <= rt && rt < q[0] + q[5]) RV.shells.push({ x0: q[1], y0: q[2], x1: q[3], y1: q[4], t: rt - q[0], dur: q[5] });
  RV.planes = []; for (const p of R.planes) { if (p.t0 > rt) continue; const s = p.s0 + (rt - p.t0) * p.speed; if (s <= p.len + 90) RV.planes.push({ ...p, s }); }
  RV.fogOn = S.replayFog; RV.vis = RV.seen = f0.vis0;
  const oi = Math.max(0, lbT(R.own, rt + 1e-6, true) - 1), key = `${oi}|${i}|${S.replayFog}`;
  if (oi !== ownIdx || (S.replayFog && key !== fogKey)) { ownIdx = oi; fogKey = key; OWN.set(R.own[oi].o); paintTerritory(S.replayFog ? f0.vis0 : null); paintFog(f0.vis0, f0.vis0, S.replayFog); }
  return RV;
}
export function startReplay() { if (!S.rec || !S.rec.meta) return; S.phase = 'replay'; S.rt = 0; S.paused = false; S.speed = Math.max(S.speed, 2); ownIdx = -1; fogKey = ''; S.sel = null; S.follow = true; cam.userMoved = true; S.lastBannerRound = 0; paintFog(VIS0, SEEN0, false); }
export function seek(t: number) { S.rt = clamp(t, 0, S.rec.end); S.lastBannerRound = S.rec.phases.filter((p: any) => p.t <= S.rt).length; S.logDirty = true; }
export function exitReplay() { S.phase = 'done'; if (S.finalOwn) OWN.set(S.finalOwn); paintTerritory(null); paintFog(VIS0, SEEN0, false); }
export function refreshReplayFog() { fogKey = ''; ownIdx = -1; }
function lb2(arr: any[], t: number) { return lbT(arr, t); }
// Replay speed drops near an HQ falling so the moment can be seen.
export function replayRate() { const m = S.rec.moments.find((m: any) => m.big && S.rt > m.t - 3 && S.rt < m.t + 2); return m ? .35 : 1; }
export function followCam(dt: number) {
  const R = S.rec, rt = S.rt; let sx = 0, sy = 0, w = 0;
  // A key moment about to happen takes the camera there first.
  const mo = R.moments.find((m: any) => rt > m.t - 4 && rt < m.t + 3);
  if (mo) { const k = 1 - Math.exp(-dt * 2); cam.tx += (mo.x - cam.tx) * k; cam.ty += (mo.y - cam.ty) * k; cam.dist += ((mo.big ? 90 : 130) - cam.dist) * k; cam.pitch += (.8 - cam.pitch) * k * .5; return; }
  for (let k = lb2(R.booms, rt - 3); k < R.booms.length && R.booms[k][0] <= rt; k++) { const q = R.booms[k], f = 1 - (rt - q[0]) / 3; sx += q[1] * f * 4; sy += q[2] * f * 4; w += f * 4; }
  for (let k = lb2(R.tracers, rt - 1.5); k < R.tracers.length && R.tracers[k][0] <= rt; k += 3) { const q = R.tracers[k]; sx += (q[1] + q[3]) / 2; sy += (q[2] + q[4]) / 2; w += 1; }
  if (w < 1) for (const u of RV.units) if (u.alive) { sx += u.x; sy += u.y; w++; }
  if (!w) return;
  // A far jump is a cut; a near one is a smooth pan.
  if (Math.hypot(sx / w - cam.tx, sy / w - cam.ty) > 140) { cam.tx = sx / w; cam.ty = sy / w; }
  const k = 1 - Math.exp(-dt * 1.1); cam.tx += (sx / w - cam.tx) * k; cam.ty += (sy / w - cam.ty) * k; cam.dist += (175 - cam.dist) * k; cam.pitch += (.85 - cam.pitch) * k * .5; cam.yaw += dt * .04;
}
