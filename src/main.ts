import './style.css';
import { DT } from './config';
import { S, hooks, setMap } from './state';
import { finishMap } from './map/finish';
import { sampleTown } from './map/procgen';
import { newBattle, step } from './sim';
import { liveView, replayView, followCam, replayRate } from './replay';
import { camera, cam, view, applyCam, fit } from './render/camera';
import { initRenderer, renderer, buildMap3D, update3D, render } from './render/scene';
import { initOverlay, resizeOverlay, draw2D } from './render/overlay';
import { initInput, keyCam } from './ui/input';
import { setTool, syncUI, banner, showResult, tickHud, hudPulse, bindStrip, refreshFogPaint, phaseCard } from './ui/hud';
import { makeTeams } from './plan';
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

function startMap(raw: RawMap) {
  const busy = document.getElementById('busy'); busy.hidden = false;
  setTimeout(() => {
    setMap(finishMap(raw)); buildMap3D(); cam.userMoved = false; fit();
    showMenu(false); busy.hidden = true;
    makeTeamsAndStart();
  }, 30);
}
function makeTeamsAndStart() { makeTeams(); newBattle(); refreshFogPaint(); phaseCard(); }
function toMenu() { S.phase = 'menu'; showMenu(true); syncUI(); }
bindStrip(toMenu);
initMenu(startMap, () => sampleTown(1000 + Math.floor(Math.random() * 9000)));

let last = performance.now(), acc = 0, pulse = 0;
function frame(now: number) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (S.phase !== 'menu' && S.teams.length) {
    if (S.phase === 'battle' && !S.paused) { acc += dt * S.speed; let n = 0; while (acc >= DT && n < 60 && S.phase === 'battle') { step(); acc -= DT; n++; } if (n >= 60) acc = 0; } else acc = 0;
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
