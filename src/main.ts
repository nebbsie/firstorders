import './style.css';
import { DT, BUDGET } from './config';
import { S, M, hooks, setMap, VIS0, SEEN0, OWN } from './state';
import { finishMap } from './map/finish';
import { newBattle, step } from './sim';
import { liveView, replayView, followCam, replayRate } from './replay';
import { camera, cam, view, applyCam, fit, fpv } from './render/camera';
import { unitH } from './world';
import { initRenderer, renderer, buildMap3D, update3D, render, scene, THREE_, interp, snapUnits } from './render/scene';
import { initOverlay, resizeOverlay, draw2D } from './render/overlay';
import { initInput, keyCam } from './ui/input';
import { setTool, syncUI, banner, showResult, tickHud, hudPulse, bindStrip, refreshFogPaint, phaseCard, toast } from './ui/hud';
import { makeTeams, initOwn } from './plan';
import { exec } from './actions';
import { NET } from './state';
import { connected, sendMap, guestLoaded, closeNet, hostTick } from './net';
import { menuStatus, type MapSpec } from './ui/menu';
import { initMenu, showMenu, showLoading, afterPaint } from './ui/menu';
import { sampleTown } from './map/procgen';
import { CX, CY } from './config';
import type { RawMap } from './map/types';
import { initAudio, tickAudio } from './audio';
initAudio();

const gl = document.getElementById('gl') as HTMLCanvasElement, cv = document.getElementById('cv') as HTMLCanvasElement;
initRenderer(gl); initOverlay(cv); initInput(cv); setTool('select');

// A new planning phase gets the phase card; battle events get the short banner.
hooks.banner = (big, small) => { if (S.phase === 'plan') phaseCard(); else banner(big, small); }; hooks.sync = syncUI; hooks.result = showResult;
hooks.ground = () => refreshFogPaint(); hooks.vision = () => refreshFogPaint();

function resize() {
  const r = gl.getBoundingClientRect(); view.dpr = Math.min(2, window.devicePixelRatio || 1); view.cw = r.width; view.ch = r.height;
  renderer.setPixelRatio(view.dpr); renderer.setSize(view.cw, view.ch, false); camera.aspect = view.cw / Math.max(1, view.ch); camera.updateProjectionMatrix(); resizeOverlay();
}
new ResizeObserver(() => { const first = view.cw <= 1; resize(); if (first || !cam.userMoved) fit(); }).observe(gl);

function buildMap(raw: RawMap) { setMap(finishMap(raw)); buildMap3D(); cam.userMoved = false; fit(); }
let pending: (() => void) | null = null;
function startMap(raw: RawMap, spec: MapSpec) {
  // Hosting: wait for the friend, then have them load the same map before the battle starts.
  if (NET.mode === 'host' && !connected()) { showLoading(null); menuStatus('Waiting for your friend to join with your code.'); pending = () => startMap(raw, spec); return; }
  showLoading('BUILDING THE MAP');
  afterPaint(async () => {
    buildMap(raw); if (spec.spawn == null) spec.spawn = (Math.random() * 1e9) | 0; S.spawnSeed = spec.spawn;
    if (NET.mode === 'host') { showLoading('WAITING FOR YOUR FRIEND TO LOAD THE MAP'); await sendMap(spec, S.nTeams); }
    showMenu(false); showLoading(null); makeTeams(); newBattle(); refreshFogPaint(); phaseCard();
  });
}
// Guest: same map, same teams; the host's state fills everything else in.
function startGuest(raw: RawMap) {
  buildMap(raw); makeTeams(); initOwn();
  Object.assign(S, { phase: 'plan', round: 1, bank: S.teams.map(() => BUDGET), vis: [], known: [], squads: [], structs: [], supports: [], units: [], log: [], selMany: [], sel: null });
  S.hqKnown = S.teams.map((t: any) => new Set([t.id])); for (const t of S.teams) { t.lost = false; t.per = { label: '' }; }
  showMenu(false); guestLoaded(); refreshFogPaint(); phaseCard(); syncUI();
}
function toMenu() { closeNet(); S.phase = 'menu'; showMenu(true); syncUI(); refreshFogPaint(); }
bindStrip(toMenu);
initMenu(startMap, startGuest, () => { if (pending) { const p = pending; pending = null; p(); } }, () => { toast(NET.mode === 'guest' ? 'The host left the game' : 'Your friend left. The AI takes their side.'); if (NET.mode === 'guest') toMenu(); });

let last = performance.now(), acc = 0, pulse = 0, lastSim = performance.now();
// The battle and the network run here, from a worker timer as well as from each frame:
// browsers slow the frame loop of a hidden tab, and the host's friend must not freeze when the host looks away.
function tickSim(now: number) {
  const dt = Math.min(.25, (now - lastSim) / 1000); lastSim = now;
  if (S.phase === 'menu' || !S.teams.length) return;
  hostTick(now);
  if (S.phase === 'battle' && !S.paused && NET.mode !== 'guest') { acc += dt * S.speed; let n = 0; while (acc >= DT && n < 80 && S.phase === 'battle') { snapUnits(); step(); acc -= DT; n++; } if (n >= 80) acc = 0; } else acc = 0;
  // The figures are drawn between the last two ticks.
  interp.on = S.phase === 'battle' && NET.mode !== 'guest'; interp.a = Math.min(1, acc / DT);
}
const simTimer = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
simTimer.onmessage = () => tickSim(performance.now());
function frame(now: number) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (S.phase !== 'menu' && S.teams.length) {
    tickSim(now);
    let V = liveView();
    if (S.phase === 'replay') {
      if (!S.paused) { S.rt += dt * S.speed * replayRate(); if (S.rt >= S.rec.end) { S.rt = S.rec.end; S.paused = true; banner('THE END', 'Exit the replay for the report'); } }
      const pr = S.rec.phases.filter((p: any) => p.t <= S.rt).length; if (pr > (S.lastBannerRound || 0)) { S.lastBannerRound = pr; banner(`PHASE ${pr}`, pr === 1 ? 'Plans locked' : 'Reinforcements in'); }
      V = replayView(); if (S.follow) followCam(dt);
    }
    // The view keeps fitting the battle circle until the player moves the camera.
    if (!cam.userMoved) fit();
    // First person: ride with the first living member of the chosen unit.
    const fq = S.fpv != null && S.phase !== 'replay' ? S.squads.find((s: any) => s.id === S.fpv) : null, fu = fq && fq.members ? fq.members.map((i: number) => S.units[i]).find((u: any) => u && u.alive) : null;
    if (fu) {
      const tank = fu.kind === 'tank', want = -(fu.hd || 0), k = Math.min(1, dt * 4);
      if (!fpv.on) { fpv.dir = want; fpv.look = 0; fpv.x = fu.x; fpv.y = fu.y; }
      let d = want - fpv.dir; d = Math.atan2(Math.sin(d), Math.cos(d)); fpv.dir += d * k;
      // A tank's camera sits at the front of the hull so the hull does not fill the view.
      const ahead = tank ? 2.2 : .4, ex = fu.x + Math.cos(fpv.dir) * ahead, ey = fu.y + Math.sin(fpv.dir) * ahead;
      fpv.x += (ex - fpv.x) * Math.min(1, dt * 8); fpv.y += (ey - fpv.y) * Math.min(1, dt * 8); fpv.h = unitH(fpv.x, fpv.y) + (tank ? 2.9 : 1.5); fpv.on = true;
    } else { if (fpv.on) { cam.tx = fpv.x; cam.ty = fpv.y; cam.dist = Math.min(cam.dist, 120); } fpv.on = false; S.fpv = null; }
    keyCam(dt); applyCam(); update3D(V); render(); draw2D();
    tickAudio(dt); tickHud(dt); pulse -= dt; if (pulse <= 0) { pulse = .25; hudPulse(); }
  }
  // Menu: the camera circles slowly over the map behind it.
  else if (S.phase === 'menu' && M) { cam.tx = CX; cam.ty = CY; cam.dist = 250; cam.pitch = .5; cam.yaw += dt * .05; applyCam(); render(); }
  requestAnimationFrame(frame);
}
// A town to show behind the menu, built after the first paint so the loading screen shows first.
showMenu(true);
setTimeout(() => { try { setMap(finishMap(sampleTown(4242))); buildMap3D(); refreshFogPaint(); } finally { showLoading(null); } }, 60);
(document.fonts ? Promise.all([document.fonts.load('11px Departure'), document.fonts.load('16px KenneyMono')]).catch(() => { }) : Promise.resolve()).then(() => requestAnimationFrame(frame));
// Developer hook for checking state in the browser console (dev server only).
if (import.meta.env.DEV) (window as any).__fo = { S, NET, VIS0, SEEN0, OWN, renderer, exec, cam, fpv, step, refreshFogPaint, scene, THREE: THREE_, get M() { return M; } };
