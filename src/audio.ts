import { S } from './state';
import { cam, P, view } from './render/camera';
import { clamp } from './config';

// Sound, made in the browser with no sound files.
// A quiet bed of wind and far battle noise is always there; the far noise grows with the fighting.
// Each shot and blast is placed on the map: near the middle of the view and zoomed in it is loud and sharp,
// far away or zoomed out it is quiet and dull.
let ctx: AudioContext | null = null, master: GainNode, noise: AudioBuffer, rumble: GainNode, drone: GainNode, droneF: BiquadFilterNode, dronePan: StereoPannerNode;
let activity = 0, muted = false;
try { muted = localStorage.getItem('fo-mute') === '1'; } catch { }

function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = muted ? 0 : .7; master.connect(ctx.destination);
  const n = ctx.sampleRate * 2; noise = ctx.createBuffer(1, n, ctx.sampleRate); const d = noise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  // Wind: soft band of noise that slowly rises and falls.
  const wind = loop(), wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = .6;
  const wg = ctx.createGain(); wg.gain.value = .022; const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .07; lg.gain.value = .012; lfo.connect(lg); lg.connect(wg.gain); lfo.start();
  wind.connect(wf); wf.connect(wg); wg.connect(master);
  // Far battle: low rumble whose level follows how much fighting there is.
  const rb = loop(), rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 140; rumble = ctx.createGain(); rumble.gain.value = 0;
  rb.connect(rf); rf.connect(rumble); rumble.connect(master);
  // Aircraft engines: two close saw tones, louder as the nearest plane comes close.
  drone = ctx.createGain(); drone.gain.value = 0; droneF = ctx.createBiquadFilter(); droneF.type = 'lowpass'; droneF.frequency.value = 500; dronePan = ctx.createStereoPanner();
  for (const f of [72, 75.5, 144]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(droneF); o.start(); }
  droneF.connect(drone); drone.connect(dronePan); dronePan.connect(master);
}
function loop() { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(0, Math.random() * 2); return s; }
export function initAudio() {
  const go = () => start();
  window.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
}
export function toggleMute() {
  muted = !muted; try { localStorage.setItem('fo-mute', muted ? '1' : '0'); } catch { }
  if (ctx) master.gain.setTargetAtTime(muted ? 0 : .7, ctx.currentTime, .05); return muted;
}
export const isMuted = () => muted;

// How loud and how sharp a sound at (x, y) is from the current view. Returns [gain, cutoff Hz, pan].
function place(x: number, y: number): [number, number, number] {
  const zoom = clamp(150 / cam.dist, .3, 1.6), R = 70 + cam.dist * .9, d = Math.hypot(x - cam.tx, y - cam.ty);
  const near = clamp(1 - d / R, 0, 1), g = near * near * zoom;
  const cut = 500 + 9000 * near * clamp(zoom, 0, 1);
  const [sx] = P(x, y); const pan = sx < -1000 ? 0 : clamp((sx / view.cw) * 2 - 1, -1, 1) * .7;
  return [g, cut, pan];
}
function burst(t: number, g: number, cut: number, pan: number, len: number, hp: number, rate = 1) {
  const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = cut;
  const e = ctx.createGain(); e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(.0001, t + len);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  s.connect(f1); f1.connect(f2); f2.connect(e); e.connect(p); p.connect(master); s.start(t, Math.random() * 1.5, len + .05);
}
function thump(t: number, g: number, pan: number, f0: number, f1: number, len: number) {
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
  const e = ctx.createGain(); e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(.0001, t + len);
  const p = ctx.createStereoPanner(); p.pan.value = pan; o.connect(e); e.connect(p); p.connect(master); o.start(t); o.stop(t + len + .05);
}
// One sound event. Kinds: shot, mg, snipe, gun (tank or AT), boom (with size), launch (mortar).
function play(k: string, x: number, y: number, size: number) {
  const [g, cut, pan] = place(x, y), t = ctx.currentTime + Math.random() * .03;
  if (g < .004) return;
  if (k === 'shot') burst(t, g * .5, cut, pan, .07, 900, .9 + Math.random() * .3);
  else if (k === 'mg') burst(t, g * .42, cut * .8, pan, .05, 600, .7);
  else if (k === 'snipe') { burst(t, g * .8, cut, pan, .16, 700, .8); burst(t + .05, g * .15, cut * .4, pan, .5, 150, .5); }
  else if (k === 'gun') { burst(t, g * .9, cut * .6, pan, .35, 80, .6); thump(t, g * .9, pan, 90, 40, .4); }
  else if (k === 'launch') thump(t, g * .7, pan, 140, 55, .22);
  else if (k === 'boom') { const s = clamp(size / 6, .5, 1.6); burst(t, g * .9 * s, Math.min(cut, 2400), pan, .9 * s, 30, .45); thump(t, g * s, pan, 70, 28, .8 * s); }
}
// Called every frame: plays queued events (the loudest first, a few each frame) and moves the bed.
export function tickAudio(dt: number) {
  const q = S.snd; if (!q) return;
  if (!ctx || ctx.state !== 'running' || S.phase !== 'battle') { q.length = 0; if (ctx && rumble) { rumble.gain.setTargetAtTime(0, ctx.currentTime, .5); drone.gain.setTargetAtTime(0, ctx.currentTime, .3); } return; }
  for (const e of q) activity += e[0] === 'boom' ? 3 : e[0] === 'gun' ? 2 : .25;
  if (q.length > 14) { q.sort((a: any, b: any) => place(b[1], b[2])[0] * (b[0] === 'boom' ? 3 : 1) - place(a[1], a[2])[0] * (a[0] === 'boom' ? 3 : 1)); q.length = 14; }
  for (const e of q) play(e[0], e[1], e[2], e[3] || 0);
  q.length = 0;
  activity *= Math.exp(-dt * .8);
  const zoomOut = clamp(cam.dist / 300, .3, 1.2);
  rumble.gain.setTargetAtTime(clamp(activity / 60, 0, 1) * .35 * zoomOut, ctx.currentTime, .4);
  // Nearest plane drives the engine sound.
  let best = 0, bp = 0;
  for (const p of S.planes || []) { if (p.s < -60 || p.s > p.len + 60) continue; const x = p.ax + p.ux * p.s, y = p.ay + p.uy * p.s, [g, , pan] = place(x, y); const v = Math.max(g, .05); if (v > best) { best = v; bp = pan; } }
  drone.gain.setTargetAtTime(best * .09, ctx.currentTime, .3); dronePan.pan.setTargetAtTime(bp, ctx.currentTime, .3);
}
