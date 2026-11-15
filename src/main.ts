import './style.css';
import { DT, BUDGET } from './config';
import { S, hooks, setMap, VIS0, SEEN0, OWN } from './state';
import { finishMap } from './map/finish';
import { newBattle, step } from './sim';
import { liveView, replayView, followCam, replayRate } from './replay';
import { camera, cam, view, applyCam, fit } from './render/camera';
import { initRenderer, renderer, buildMap3D, update3D, render } from './render/scene';
import { initOverlay, resizeOverlay, draw2D } from './render/overlay';
import { initInput, keyCam } from './ui/input';
import { setTool, syncUI, banner, showResult, tickHud, hudPulse, bindStrip, refreshFogPaint, phaseCard, toast } from './ui/hud';
import { makeTeams, initOwn } from './plan';
import { exec } from './actions';
import { NET } from './state';
import { connected, sendMap, guestLoaded, closeNet, hostTick } from './net';
import { menuStatus, type MapSpec } from './ui/menu';
import { initMenu, showMenu } from './ui/menu';
import type { RawMap } from './map/types';

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
  if (NET.mode === 'host' && !connected()) { menuStatus('Waiting for your friend to join with your code.'); pending = () => startMap(raw, spec); return; }
  const busy = document.getElementById('busy'); busy.hidden = false;
  setTimeout(async () => {
    buildMap(raw);
    if (NET.mode === 'host') { busy.textContent = 'WAITING FOR YOUR FRIEND TO LOAD THE MAP'; await sendMap(spec, S.nTeams); busy.textContent = 'BUILDING MAP'; }
    showMenu(false); busy.hidden = true; makeTeams(); newBattle(); refreshFogPaint(); phaseCard();
  }, 30);
}
// Guest: same map, same teams; the host's state fills everything else in.
function startGuest(raw: RawMap) {
  buildMap(raw); makeTeams(); initOwn();
  Object.assign(S, { phase: 'plan', round: 1, bank: S.teams.map(() => BUDGET), vis: [], known: [], squads: [], structs: [], supports: [], units: [], log: [], selMany: [], sel: null });
  S.hqKnown = S.teams.map((t: any) => new Set([t.id])); for (const t of S.teams) { t.lost = false; t.per = { label: '' }; }
  showMenu(false); guestLoaded(); refreshFogPaint(); phaseCard(); syncUI();
}
function toMenu() { closeNet(); S.phase = 'menu'; showMenu(true); syncUI(); }
bindStrip(toMenu);
initMenu(startMap, startGuest, () => { if (pending) { const p = pending; pending = null; p(); } }, () => { toast(NET.mode === 'guest' ? 'The host left the game' : 'Your friend left. The AI takes their side.'); if (NET.mode === 'guest') toMenu(); });

let last = performance.now(), acc = 0, pulse = 0;
function frame(now: number) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (S.phase !== 'menu' && S.teams.length) {
    hostTick(now);
    if (S.phase === 'battle' && !S.paused && NET.mode !== 'guest') { acc += dt * S.speed; let n = 0; while (acc >= DT && n < 60 && S.phase === 'battle') { step(); acc -= DT; n++; } if (n >= 60) acc = 0; } else acc = 0;
    let V = liveView();
    if (S.phase === 'replay') {
      if (!S.paused) { S.rt += dt * S.speed * replayRate(); if (S.rt >= S.rec.end) { S.rt = S.rec.end; S.paused = true; banner('THE END', 'Exit the replay for the report'); } }
      const pr = S.rec.phases.filter((p: any) => p.t <= S.rt).length; if (pr > (S.lastBannerRound || 0)) { S.lastBannerRound = pr; banner(`PHASE ${pr}`, pr === 1 ? 'Plans locked' : 'Reinforcements in'); }
      V = replayView(); if (S.follow) followCam(dt);
    }
    // The view keeps fitting the battle circle until the player moves the camera.
    if (!cam.userMoved) fit();
    keyCam(dt); applyCam(); update3D(V); render(); draw2D();
    tickHud(dt); pulse -= dt; if (pulse <= 0) { pulse = .25; hudPulse(); }
  }
  requestAnimationFrame(frame);
}
(document.fonts ? Promise.all([document.fonts.load('11px Departure'), document.fonts.load('16px KenneyMono')]).catch(() => { }) : Promise.resolve()).then(() => requestAnimationFrame(frame));
// Developer hook for checking state in the browser console (dev server only).
if (import.meta.env.DEV) (window as any).__fo = { S, NET, VIS0, SEEN0, OWN, renderer, exec };
