import { NET } from '../state';
import { UPKEEP, HQ_HOLD, PLAY_R, M_PER_UNIT, MOVERS, PHASE_LEN, COST, TOOLS, INFO, KIND_NAME, T_BUILD, T_WATER, T_BRIDGE, T_ROAD, T_WOOD, T_PARK, HS, grid, fmtT, clamp } from '../config';
import { S, M, VIS0, SEEN0, logText } from '../state';
import { cellOf, bldNear, ENG_BUILD } from '../world';
import { aliveMembers, sqCenter, itemCost, left, canRemove, removeItem, SUPPORT_ROUND } from '../plan';
import { newBattle, phaseLimit } from '../sim';
import { actRemove, actOrders, actTime, actReady, actSpeed, actStance } from '../actions';
import { startReplay, seek, exitReplay, refreshReplayFog } from '../replay';
import { fit, cam, P } from '../render/camera';
import { paintFog, paintTerritory, viewOpts, applyViews } from '../render/scene';
import { BTYPES } from '../map/btypes';
import { toggleMute, isMuted } from '../audio';
import { isAllowed, MISSIONS, saveWin, GOAL_TEXT } from '../campaign';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
let toastT = 0, bannerT = 0;
export function toast(m: string) { const t = $('#toast'); t.textContent = m; t.hidden = false; toastT = 2.4; }
export function banner(big: string, small: string) { $('#bannerBig').textContent = big; $('#bannerSmall').textContent = small; $('#banner').hidden = false; bannerT = 2.2; }
export function tickHud(dt: number) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').hidden = true; }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').hidden = true; }
  quickBar(); autoSpeed();
  const fx = $('#fpvExit'); fx.hidden = S.fpv == null; fx.onclick = () => { S.fpv = null; renderInspector(); };
}
// Quick orders: a small bar that floats above the selected platoons.
function quickBar() {
  const el = $('#qbar'), mine = (S.selMany || []).filter((s: any) => s.team === NET.me && (MOVERS.includes(s.kind) || s.kind === 'engineers') && (!s.members || aliveMembers(s).length));
  if (!mine.length || S.phase !== 'plan') { el.hidden = true; return; }
  let x = 0, y = 0, n = 0; for (const s of mine) { const c = sqCenter(s); if (c) { x += c[0]; y += c[1]; n++; } }
  if (!n) { el.hidden = true; return; }
  // Above the unit, clear of its name tag, and kept on the screen.
  const [sx, sy] = P(x / n, y / n, 4); el.hidden = false; const hw = el.offsetWidth / 2 + 6;
  el.style.left = clamp(sx, hw + 190, window.innerWidth - hw) + 'px'; el.style.top = Math.max(el.offsetHeight + 46, sy - 46) + 'px';
  $('#qName').textContent = mine.length === 1 ? (mine[0].call || KIND_NAME[mine[0].kind]) : `${mine.length} UNITS`;
  $('#qInfo').textContent = mine.length === 1 ? `${KIND_NAME[mine[0].kind].toUpperCase()} · ${mine[0].members ? aliveMembers(mine[0]).length : mine[0].pos.length} MEN` : mine.map((s: any) => s.call).join(' ');
  const eng = mine.some((s: any) => s.kind === 'engineers'), st = mine[0].stance || 'normal', fb = mine.every((s: any) => s.fallback), key = eng + S.tool + mine.some((s: any) => s.order) + st + fb + mine.map((s: any) => s.id).join(',');
  if (el.dataset.k === key) return; el.dataset.k = key;
  el.querySelectorAll('.btn[data-st]').forEach((b: any) => {
    const v = b.dataset.st; b.classList.toggle('on', v === 'fallback' ? fb : v === st);
    b.onclick = () => { const ids = mine.map((s: any) => s.id); if (v === 'fallback') actStance(ids, undefined, !fb); else actStance(ids, v); el.dataset.k = ''; };
  });
  el.querySelectorAll('.btn[data-q]').forEach((b: any) => {
    const q = b.dataset.q; b.hidden = q === 'demolish' ? !eng : q === 'stop' ? !mine.some((s: any) => s.order) : false; b.classList.toggle('on', S.tool === q);
    b.onclick = () => {
      if (q === 'stop') { actOrders(S.selMany.map((s: any) => ({ id: s.id, type: null }))); renderInspector(); return; }
      if (S.tool === q) { setTool('select'); return; }
      closeTools(); setTool(q); toast(q === 'demolish' ? 'Click the bridge or building to blow up.' : q === 'suppress' ? 'Click the spot to fire on.' : q === 'follow' ? 'Click the unit to follow.' : 'Click the ground. Drag to set the way they face.');
    };
  });
}
const fogOn = () => S.phase === 'replay' ? S.replayFog : S.fog && (S.phase === 'plan' || S.phase === 'battle');

// Phase card: says which phase this is and what to do now.
// After a phase: what it cost, what it gained, what was seen, and the main events.
function phaseReport(r: number) {
  const rep = S.reports && S.reports[NET.me];
  let h = `<p>You have <b>${left(NET.me)}</b> supply.</p>`;
  if (rep) {
    const sg = (n: number) => (n > 0 ? '+' : '') + n;
    const pay = S.pay && S.pay[NET.me];
    h = `<dl class="kv"><dt>Lost</dt><dd style="color:var(--bad)">${rep.lost}</dd><dt>Killed</dt><dd>${rep.kills}</dd><dt>Ground</dt><dd>${sg(Math.round(rep.terr / 10))}</dd>${pay ? `<dt>Income</dt><dd style="color:var(--good)">+${pay.inc}</dd><dt>Upkeep</dt><dd style="color:var(--bad)">-${pay.up}</dd>` : ''}<dt>Supply</dt><dd>${left(NET.me)}</dd>${rep.seen.length ? `<dt>Seen</dt><dd>${rep.seen.join(', ')}</dd>` : ''}</dl>`
      + (rep.notes.length ? `<ul class="rep">${rep.notes.map((n: string) => `<li>${esc(logText(n))}</li>`).join('')}</ul>` : '<p class="hint">No contact this phase.</p>');
  }
  return h + `<p>Press <b>BEGIN PHASE ${r}</b> when ready.</p>`;
}
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function phaseCard() {
  const r = S.round, body = r === 1
    ? `<p><b>Take the enemy HQ. Hold your own.</b> An HQ falls when enemy troops hold its ground for 40 seconds.</p><p>Your ground is tinted blue. You can only build there.</p><p>Open <b>DEFENCES</b>, <b>UNITS</b> and <b>SUPPORT</b> below to buy. Select your units, then use <b>ORDERS</b> to send them.</p><p>You do not know where the enemy HQ is. A <b>SPY PLANE</b> or forward troops will find it.</p><p>Press <b>BEGIN PHASE 1</b> when ready.</p>`
    : phaseReport(r);
  const mi = S.campaign; if (r === 1 && mi != null) { const m = MISSIONS[mi]; $('#cardTitle').textContent = `MISSION ${mi + 1} · ${m.name}`; $('#cardBody').innerHTML = `<p><b>${m.brief}</b></p><p style="color:var(--gold)">GOAL: ${GOAL_TEXT[m.goal]} ${m.phases} phases.</p>` + body; $('#card').hidden = false; return; }
  $('#cardTitle').textContent = r === 1 ? 'PHASE 1 · DEPLOY' : `PHASE ${r - 1} REPORT`; $('#cardBody').innerHTML = body; $('#card').hidden = false;
}

// Tool tiles open above their command in the bottom strip, as in Mall Architect.
export function setTool(id: string) {
  if (id !== S.tool) S.via = null;
  S.tool = id; document.querySelectorAll('.tile').forEach((b: any) => b.classList.toggle('on', b.dataset.tool === id));
  $('#cv').style.cursor = id === 'select' ? 'default' : 'crosshair'; if (id === 'select') $('#cursorNote').hidden = true;
}
// The build menu: always open while planning, hidden during a phase. Only unlocked items are listed.
let buildKey = '';
export function showBuild(on: boolean) {
  const panel = $('#toolpanel');
  if (!on) { panel.hidden = true; buildKey = ''; return; }
  const locked = (id: string) => ['spy', 'barrage', 'para', 'demo', 'air'].includes(id) && S.round < SUPPORT_ROUND;
  const key = S.round + ':' + (S.allowed ? [...S.allowed].join(',') : 'all');
  if (key !== buildKey || panel.hidden) {
    buildKey = key;
    const groups = TOOLS.filter(t => t.g !== 'ORDERS').map(grp => ({ g: grp.g, items: grp.items.filter((t: any) => isAllowed(t[0])) })).filter(grp => grp.items.length);
    const tile = (t: any) => `<button class="btn tile${locked(t[0]) ? ' locked' : ''}" data-tool="${t[0]}"><span>${t[1]}</span><em>${COST[t[0]] ? (t[2] === 'line' && t[0] !== 'air' && t[0] !== 'spy' ? COST[t[0]] + '/c' : COST[t[0]]) : ''}</em></button>`;
    panel.innerHTML = `<div class="groups">${groups.map(grp => `<div><h3>${grp.g}</h3><div class="tiles">${grp.items.map(tile).join('')}</div></div>`).join('')}</div>`;
    panel.hidden = false;
    panel.querySelectorAll('.tile').forEach((b: any) => {
      b.onclick = () => { if (locked(b.dataset.tool)) { toast(`Support is ready from phase ${SUPPORT_ROUND}`); return; } setTool(S.tool === b.dataset.tool ? 'select' : b.dataset.tool); };
      b.onmouseenter = () => showInfo(b.dataset.tool, b); b.onmouseleave = () => { $('#info').hidden = true; };
    });
  }
  setTool(S.tool);
}
// The build menu stays open while planning; picking an order tool only changes the tool.
export function closeTools() { }
// Window beside the tool panel while hovering a tile: what it is and where it works.
function showInfo(id: string, tile: HTMLElement) {
  const def = TOOLS.flatMap(g => g.items).find(t => t[0] === id), inf = INFO[id]; if (!def || !inf) return;
  $('#info').innerHTML = `<div class="ph"><span>${def[1]}</span><span>${COST[id] ? COST[id] + (def[2] === 'line' && id !== 'air' && id !== 'spy' ? ' / CELL' : '') : ''}</span></div><div class="pb"><p class="hint">${inf[0]}</p>${inf[1] || UPKEEP[id] ? `<dl class="kv" style="margin-top:8px">${inf[1] ? `<dt>Best</dt><dd>${inf[1]}</dd>` : ''}${UPKEEP[id] ? `<dt>Upkeep</dt><dd>${UPKEEP[id]} a phase</dd>` : ''}</dl>` : ''}<p class="note">${def[2] === 'line' ? 'Drag a line.' : def[2] === 'order' ? 'Select units first.' : ['spy', 'barrage', 'para', 'demo', 'air', 'smoke'].includes(id) ? (S.round < SUPPORT_ROUND && id !== 'smoke' ? `Anywhere in the circle. Ready from phase ${SUPPORT_ROUND}.` : 'Anywhere in the circle.') : id === 'garrison' ? 'A building on your own ground.' : id === 'fob' ? 'Near your engineers. Ready next phase.' : ENG_BUILD.includes(id) ? 'In your start area, or round a finished FOB. Ready next phase.' : TOOLS.find(g => g.g === 'UNITS').items.some(i => i[0] === id) ? 'In your start area.' : 'On your own ground.'}</p></div>`;
  // A fixed spot just right of the tool panel, its bottom level with the panel's bottom.
  const el = $('#info'); el.hidden = false; el.style.left = $('#toolpanel').getBoundingClientRect().right + 6 + 'px';
}
function buildCommands() {
  $('#cmds').hidden = true;
}

// Selection: one item, or several of your units from a box.
export function setSel(it: any, many?: any[]) { S.sel = it; S.selMany = many || (it && it.pos ? [it] : []); renderInspector(); }

// A small note beside the cursor while a tool is in hand: grid square, ground type, height.
export function cursorNote(w: any, sx: number, sy: number) {
  const el = $('#cursorNote'); if (!w || !M || S.tool === 'select' || (S.phase !== 'plan' && S.phase !== 'battle')) { el.hidden = true; return; }
  const ci = cellOf(w.x, w.y); if (ci < 0) { el.hidden = true; return; }
  const t = M.terr[ci], m = Math.max(0, Math.round((M.hAt(w.x, w.y) - 3) * M_PER_UNIT)); let k: string;
  if (t === T_BUILD) k = 'BUILDING'; else if (t === T_WATER) k = 'WATER'; else if (t === T_BRIDGE) k = 'BRIDGE'; else if (t === T_ROAD) k = 'ROAD';
  else if (t === T_WOOD) k = 'WOODS'; else if (bldNear(w.x, w.y) >= 12) k = 'TOWN'; else if (t === T_PARK) k = 'PARK'; else k = 'OPEN';
  el.textContent = `${grid(w.x, w.y)} · ${k} · ${m} M`; el.hidden = false; el.style.left = sx + 16 + 'px'; el.style.top = sy + 18 + 'px';
}

const HINT: Record<string, string> = {
  mortar: 'Fires at enemies 26 to 155 away that your side can see.', at: 'Fires only at tanks. Range 85.',
  op: 'Sees far, spots for mortars and tightens artillery. Further from high ground.', garrison: 'Inside a building: 85% cover, fires from the roof, never moves.',
  tank: 'Fast on roads, slow in woods, stopped by tank traps. Only AT guns, shells, bombs and tanks hurt it.', sniper: 'Sees and shoots twice as far as a rifleman.',
};
export function renderInspector() {
  const it = S.sel, many = (S.selMany || []).filter((s: any) => !s.members || aliveMembers(s).length), panel = $('#insp'), body = $('#inspBody'), title = $('#inspTitle');
  if (S.phase === 'replay' || S.phase === 'menu' || (!it && !many.length)) { panel.hidden = true; return; }
  panel.hidden = false; let h = '';
  if (many.length > 1) {
    title.textContent = `${many.length} units selected`;
    const total = many.reduce((a: number, s: any) => a + (s.members ? aliveMembers(s).length : s.pos.length), 0);
    h = `<dl class="kv"><dt>Soldiers</dt><dd>${total}</dd><dt>Units</dt><dd>${many.map((s: any) => s.call || KIND_NAME[s.kind]).join(', ')}</dd></dl>`;
    if (S.phase === 'plan') h += `<p class="hint" style="margin-top:8px">Pick an order, then click the ground. Drag to set the way they face.</p><div class="row"><button class="btn" id="iMove">MOVE</button><button class="btn" id="iAtk">ATTACK</button><button class="btn" id="iDef">DEFEND</button>${many.some((s: any) => s.kind === 'engineers') ? '<button class="btn" id="iDemo">DEMOLISH</button>' : ''}<button class="btn" id="iClear">CLEAR ORDERS</button></div>`;
  } else if (it && it.pos) {
    const col = S.teams[it.team].color;
    title.textContent = it.call ? `${it.call} · ${it.temp ? 'Paratroopers' : KIND_NAME[it.kind]}` : KIND_NAME[it.kind];
    const alive = it.members ? aliveMembers(it).length : it.pos.length, kills = it.members ? it.members.reduce((a: number, i: number) => a + S.units[i].kills, 0) : 0, c = sqCenter(it);
    const mu = it.kind === 'mortar' && it.members ? S.units[it.members[0]] : null;
    const doing = mu && mu.alive && mu.reloading && mu.cd > 0 ? `RELOADING ${Math.ceil(mu.cd)} S` : it.members ? (it.state || 'hold').toUpperCase() : 'NOT DEPLOYED';
    const next = it.order ? `${it.order.type.toUpperCase()} ${grid(it.order.x, it.order.y)}` : (it.members ? 'CARRY ON' : (['mg', 'mortar', 'at', 'op', 'garrison'].includes(it.kind) ? 'FIXED' : 'HOLD'));
    h = `<dl class="kv"><dt>Team</dt><dd style="color:${col}">${S.teams[it.team].name}</dd><dt>Grid</dt><dd>${c ? grid(c[0], c[1]) : '-'}</dd><dt>Strength</dt><dd>${alive} / ${it.pos.length}</dd><dt>Now</dt><dd>${doing}</dd>${S.phase === 'plan' && it.team === NET.me ? `<dt>Next phase</dt><dd>${next}</dd>` : ''}${it.members ? `<dt>Kills</dt><dd>${kills}</dd>` : `<dt>Cost</dt><dd>${itemCost(it)}</dd>`}</dl>`;
    if (HINT[it.kind]) h += `<p class="hint" style="margin-top:8px">${HINT[it.kind]}</p>`;
    const mover = MOVERS.includes(it.kind);
    if (it.team === NET.me && it.members && MOVERS.includes(it.kind) && S.phase !== 'replay') h += `<div class="row"><button class="btn${S.fpv === it.id ? ' on' : ''}" id="iFpv">${S.fpv === it.id ? 'LEAVE FIRST PERSON' : 'FIRST PERSON'}</button></div>`;
    if (S.phase === 'plan' && it.team === NET.me) h += `<div class="row">${canRemove(it) ? '<button class="btn stop" id="iDel">REMOVE</button>' : ''}</div>`;
  } else if (it && it.building) {
    const bd = it.building, T = BTYPES[bd.btype || 'house'];
    title.textContent = bd.name || T.label;
    h = `<dl class="kv">${bd.name ? `<dt>Type</dt><dd>${T.label}</dd>` : ''}<dt>Grid</dt><dd>${grid(bd.cx, bd.cy)}</dd><dt>Height</dt><dd>${Math.round(bd.h * M_PER_UNIT)} M</dd><dt>Garrison cover</dt><dd>${Math.round((T.cover || .85) * 100)}%</dd>${T.sight ? `<dt>Extra sight</dt><dd>+${Math.round(T.sight * M_PER_UNIT)} M</dd>` : ''}</dl>${T.note ? `<p class="hint" style="margin-top:8px">${T.note}</p>` : ''}`;
  } else if (it && it.cells) {
    title.textContent = { trench: 'Trench', sandbag: 'Sandbags', wall: 'Wall', wire: 'Wire', tanktrap: 'Tank traps' }[it.type];
    h = `<dl class="kv"><dt>Length</dt><dd>${it.cells.length} cells</dd><dt>Effect</dt><dd>${{ trench: '70% cover', sandbag: '50% cover', wall: 'blocks sight', wire: '1/3 speed', tanktrap: 'stops tanks' }[it.type]}</dd><dt>Cost</dt><dd>${itemCost(it)}</dd></dl>` + (canRemove(it) ? `<div class="row"><button class="btn stop" id="iDel">REMOVE</button></div>` : '');
  } else if (it) {
    title.textContent = { barrage: 'Artillery', air: 'Air strike', para: 'Paradrop', demo: 'Demolition', spy: 'Spy plane', smoke: 'Smoke' }[it.type];
    h = `<dl class="kv"><dt>Target</dt><dd>${grid(it.a.x, it.a.y)}</dd><dt>At</dt><dd>T+${Math.floor(it.t)} s, phase ${it.round}</dd><dt>Cost</dt><dd>${itemCost(it)}</dd></dl>`
      + (it.type === 'barrage' ? `<p class="hint" style="margin-top:8px">Hits every team in the circle, yours too.</p>` : it.type === 'spy' ? `<p class="hint" style="margin-top:8px">Sees everything within 55 of its path while it flies.</p>` : '')
      + (canRemove(it) ? `<div class="row"><button class="btn" id="iEarly">-5 S</button><button class="btn" id="iLate">+5 S</button><button class="btn stop" id="iDel">REMOVE</button></div>` : '');
  }
  body.innerHTML = h;
  const b = (id: string, f: () => void) => { const x = body.querySelector(id) as HTMLElement; if (x) x.onclick = f; };
  b('#iDel', () => { actRemove(it.id); setSel(null); });
  b('#iFpv', () => { if (S.fpv === it.id) { S.fpv = null; renderInspector(); return; } S.fpv = it.id; toast('First person. Right drag to look round. Esc, WASD or the button to leave.'); renderInspector(); });
  b('#iClear', () => { actOrders(S.selMany.map((s: any) => ({ id: s.id, type: null }))); renderInspector(); });
  b('#iMove', () => { setTool('move'); toast('Click the ground to go to. Drag to set the way they face.'); });
  b('#iAtk', () => { closeTools(); setTool('attack'); toast('Click the ground to attack. Drag to set the way they face.'); });
  b('#iDemo', () => { setTool('demolish'); toast('Click the bridge or building the engineers should blow up.'); });
  b('#iDef', () => { closeTools(); setTool('defend'); toast('Click the ground to hold. Drag to set the way they face.'); });
  b('#iEarly', () => { actTime(it.id, Math.max(0, it.t - 5)); renderInspector(); }); b('#iLate', () => { actTime(it.id, Math.min(PHASE_LEN - 5, it.t + 5)); renderInspector(); });
}

// The replay scrubber. Planning and battle have no progress bar.
const tpos = (f: number) => `calc(8px + (100% - 16px) * ${clamp(f, 0, 1)})`;
const logVisible = (l: any) => !fogOn() || l.team < 0 || l.team === NET.me;
function renderTimeline() {
  const box = $('#timeline'); box.hidden = S.phase !== 'replay'; if (box.hidden) return;
  const el = $('#tl'), end = S.rec.end; el.classList.add('scrub');
  let h = `<div class="axis"></div><div class="fill" id="fill" style="width:calc((100% - 16px) * ${S.rt / end})"></div>`;
  for (const p of S.rec.phases) h += `<span class="ev" style="left:${tpos(p.t / end)}">PHASE ${p.round}</span>`;
  for (const m of S.rec.moments) h += `<span class="mk big" style="left:${tpos(m.t / end)}"></span>`;
  for (const l of S.log) { if (l.team < 0 || !/ lost at |blown|HQ found/.test(l.msg)) continue; h += `<span class="mk" style="left:${tpos(l.t / end)};background:${S.teams[l.team].color}"></span>`; }
  h += `<span class="tick" style="left:${tpos(1)};transform:translateX(-100%)">${fmtT(end)}</span><span class="now" id="now" style="left:${tpos(S.rt / end)}"></span>`;
  el.innerHTML = h;
}
// Radio: the last few messages for your side, bottom left. They fade after a while.
function renderRadio() {
  const el = $('#radio'); if (S.phase !== 'battle' && S.phase !== 'replay') { el.innerHTML = ''; return; }
  const now = S.phase === 'replay' ? S.rt : S.t;
  const items = S.log.filter((l: any) => logVisible(l) && l.t <= now && now - l.t < 12).slice(0, 5).reverse();
  el.innerHTML = items.map((l: any) => `<p style="border-left-color:${l.team >= 0 ? S.teams[l.team].color : 'var(--gold)'};opacity:${now - l.t > 9 ? .4 : 1}"><b>${fmtT(l.t)}</b>${logText(l.msg)}</p>`).join('');
}
// Auto speed (solo only, as two players must agree on speed): fast while your side is not fighting,
// normal speed from the first shot. Kept in this browser.
const AUTO_FAST = 4, CALM = 5;
let autoOn = (() => { try { return localStorage.getItem('fo-auto') !== '0'; } catch { return true; } })();
function setAuto(v: boolean) { autoOn = v; try { localStorage.setItem('fo-auto', v ? '1' : '0'); } catch { } syncSpeed(); }
function autoSpeed() {
  if (!autoOn || NET.mode !== 'solo' || S.phase !== 'battle' || S.paused || !S.fightT) return;
  const calm = S.t - (S.fightT[NET.me] ?? -99) > CALM, want = calm ? AUTO_FAST : 1;
  if (S.speed !== want) { S.speed = want; syncSpeed(); }
}
export function syncSpeed() {
  const a = $('#sAuto'); a.classList.toggle('on', autoOn); a.hidden = NET.mode !== 'solo';
  document.querySelectorAll('#speeds .btn[data-speed]').forEach((b: any) => { const v = +b.dataset.speed; b.classList.toggle('on', v === 0 ? S.paused : (!S.paused && v === S.speed)); }); }
export function syncFollow() { $('#bFollow').classList.toggle('on', S.follow); }
// Progress through the current phase, top middle, during a battle.
function syncPhaseBar() {
  const bar = $('#phasebar'); bar.hidden = S.phase !== 'battle'; if (bar.hidden) return;
  const f = clamp((S.t - S.phaseStart) / PHASE_LEN, 0, 1); $('#pbFill').style.width = f * 100 + '%';
  $('#pbLabel').textContent = `PHASE ${S.round} · ${Math.max(0, Math.ceil(PHASE_LEN - (S.t - S.phaseStart)))} S LEFT`;
}
function syncClock() {
  syncPhaseBar();
  const ph = S.phase;
  if (ph === 'plan') { $('#phaseName').textContent = `PHASE ${S.round} / ${phaseLimit()}`; $('#clock').textContent = S.round === 1 ? 'DEPLOY' : 'REINFORCE'; }
  else if (ph === 'battle') { $('#phaseName').textContent = `PHASE ${S.round} / ${phaseLimit()}`; $('#clock').textContent = `T+${Math.floor(S.t - S.phaseStart)}`; }
  else if (ph === 'replay') { $('#phaseName').textContent = 'REPLAY'; $('#clock').textContent = `${fmtT(S.rt)} / ${fmtT(S.rec.end)}`; }
  else if (ph === 'done') { $('#phaseName').textContent = 'DEBRIEF'; $('#clock').textContent = fmtT(S.t); }
  if (S.teams.length && S.bank.length) $('#supply').textContent = String(Math.max(0, left(NET.me)));
}
export function syncUI() {
  const ph = S.phase, plan = ph === 'plan', show = (id: string, v: boolean) => $(id).hidden = !v;
  // Plans lock when the phase begins: buying and orders only happen between phases.
  const live = plan;
  if (!plan) S.waiting = false;
  show('#bBegin', plan); $('#bBegin').textContent = S.waiting ? 'WAITING FOR FRIEND' : NET.mode === 'solo' ? `BEGIN PHASE ${S.round}` : `READY · PHASE ${S.round}`; show('#cmds', false); showBuild(plan); show('#supplyPlate', live);
  show('#bReplay', ph === 'done'); show('#bNew', ph === 'done'); show('#bExit', ph === 'replay'); show('#bFollow', ph === 'replay'); show('#bFromStart', ph === 'replay');
  if (!live) setTool('select');
  if (!plan) $('#card').hidden = true;
  if (!plan && ph !== 'battle') $('#quitAsk').hidden = true;
  if (ph !== 'done') $('#result').hidden = true;
  syncClock(); renderTimeline(); renderInspector(); syncSpeed(); syncFollow(); renderRadio();
}
export function refreshFogPaint() {
  if (S.phase === 'replay') { refreshReplayFog(); return; }
  const on = S.fog && (S.phase === 'plan' || S.phase === 'battle');
  paintFog(VIS0, SEEN0, on); paintTerritory(on ? SEEN0 : null, VIS0);
}
// Share of the battle circle (about 50 ground cells across).
const PLAY_CELLS = Math.PI * (PLAY_R / 4) ** 2;
const pct = (c: number) => Math.round(c / PLAY_CELLS * 100);
export function showResult() {
  const r = S.result, el = $('#result'), st = S.stats, w = r.winner >= 0 ? S.teams[r.winner] : null;
  // Campaign: a win saves progress and names what the next mission unlocks.
  const won = r.winner === NET.me, ci = S.campaign; let camp = '';
  if (ci != null) {
    if (won) saveWin(ci); window.dispatchEvent(new Event('fo-campaign'));
    const nx = MISSIONS[ci + 1];
    camp = won ? `<p class="hint" style="margin-top:8px">Mission ${ci + 1} won.${nx ? ` Unlocked for ${nx.name}: <b>${nx.adds.join(', ').toUpperCase()}</b>.` : ' Campaign complete.'}</p>` : `<p class="hint" style="margin-top:8px">Mission ${ci + 1} lost. Try a different plan.</p>`;
  }
  const rows = S.history.map((h: any) => `<tr><td>PHASE ${h.round}</td>${S.teams.map((t: any) => `<td style="color:${t.color}">${pct(h.terr[t.id])}%</td>`).join('')}</tr>`).join('');
  el.innerHTML = `<div class="ph"><span>After-action report · ${fmtT(S.t)}</span><button class="btn x" id="rHide" title="Hide">X</button></div><div class="pb"><div class="big" style="color:${w ? w.color : 'var(--muted)'}">${w ? w.name + ' WINS' : 'NO SURVIVORS'}</div><p class="hint" style="margin:0 0 8px">${r.byTime ? 'Phase limit reached. Most ground held wins.' : r.winner === NET.me ? 'You took the enemy HQ.' : S.teams[NET.me].lost ? 'Your HQ fell.' : 'The last HQ standing wins.'}</p>
  <table><tr><th>Team</th><th>Alive</th><th>Lost</th><th>Kills</th><th>Ground</th></tr>${S.teams.map((t: any) => `<tr><td style="color:${t.color}">${t.name}${t.id !== NET.me ? ' · ' + (t.human ? 'PLAYER' : t.per.label) : ' · YOU'}</td><td>${r.alive[t.id]}</td><td>${st[t.id].lost}</td><td>${st[t.id].kills}</td><td>${pct(r.terr[t.id])}%</td></tr>`).join('')}</table>
  ${rows ? `<table style="margin-top:10px"><tr><th>Ground by phase</th>${S.teams.map((t: any) => `<th>${t.name}</th>`).join('')}</tr>${rows}</table>` : ''}
  ${camp}<div class="row" style="margin-top:12px"><button class="btn go" id="rReplay">WATCH REPLAY</button>${S.campaign != null ? (won && S.campaign + 1 < MISSIONS.length ? '<button class="btn go" id="rNext">NEXT MISSION</button>' : '<button class="btn" id="rRetry">TRY AGAIN</button>') : '<button class="btn" id="rNew">NEW BATTLE</button>'}</div></div>`;
  el.hidden = false; refreshFogPaint(); // the end of the battle shows everything: no fog
  $('#rReplay').onclick = goReplay; const bn = el.querySelector('#rNew') as HTMLElement; if (bn) bn.onclick = () => { newBattle(); fit(); phaseCard(); };
  const bx = el.querySelector('#rNext') as HTMLElement; if (bx) bx.onclick = () => { el.hidden = true; window.dispatchEvent(new CustomEvent('fo-mission', { detail: ci + 1 })); };
  const br = el.querySelector('#rRetry') as HTMLElement; if (br) br.onclick = () => { el.hidden = true; window.dispatchEvent(new CustomEvent('fo-mission', { detail: ci })); }; $('#rHide').onclick = () => el.hidden = true;
}
function goReplay() { $('#result').hidden = true; startReplay(); syncUI(); }

export function bindStrip(toMenu: () => void) {
  buildCommands();
  $('#bBegin').onclick = () => {
    if (S.round === 1 && !S.squads.some((s: any) => s.team === NET.me)) { toast('Buy at least one unit first'); return; }
    // Units with nothing to do: warn once; a second press starts anyway.
    const idle = idleUnits(); if (idle.length && !(S.idleWarned && performance.now() - S.idleWarned < 8000)) { S.idleWarned = performance.now(); toast(`${idle.length} unit${idle.length > 1 ? 's have' : ' has'} no orders: ${idle.map((s: any) => s.call).join(', ')}. Press again to begin anyway.`); return; }
    S.idleWarned = 0; closeTools(); setSel(null); actReady(); if (NET.mode !== 'solo' && S.phase === 'plan') { S.waiting = true; syncUI(); } };
  $('#bReplay').onclick = goReplay;
  $('#bExit').onclick = () => { exitReplay(); syncUI(); showResult(); };
  $('#bFromStart').onclick = () => { seek(0); S.paused = false; syncSpeed(); };
  $('#bFollow').onclick = () => { S.follow = !S.follow; syncFollow(); };
  $('#bNew').onclick = () => { newBattle(); cam.userMoved = false; fit(); phaseCard(); };
  // A battle in progress asks first; a finished battle or a replay quits at once.
  const quit = () => { $('#quitAsk').hidden = true; toMenu(); };
  $('#bMenu').onclick = () => { if (S.phase === 'plan' || S.phase === 'battle') $('#quitAsk').hidden = false; else quit(); };
  $('#quitYes').onclick = quit;
  $('#quitNo').onclick = () => { $('#quitAsk').hidden = true; };
  $('#bHelp').onclick = () => { $('#help').hidden = !$('#help').hidden; };
  $('#helpClose').onclick = () => { $('#help').hidden = true; };
  $('#cardOk').onclick = () => { $('#card').hidden = true; };
  $('#inspClose').onclick = () => setSel(null);
  $('#vArea').onclick = () => { viewOpts.area = !viewOpts.area; $('#vArea').classList.toggle('on', viewOpts.area); refreshFogPaint(); };
  $('#vSound').classList.toggle('on', !isMuted()); $('#vSound').onclick = () => $('#vSound').classList.toggle('on', !toggleMute());
  $('#vXray').onclick = () => { viewOpts.xray = !viewOpts.xray; $('#vXray').classList.toggle('on', viewOpts.xray); applyViews(); };
  $('#sAuto').onclick = () => setAuto(!autoOn);
  // Picking a speed by hand during a battle turns auto speed off: the player has taken over.
  document.querySelectorAll('#speeds .btn[data-speed]').forEach((b: any) => b.onclick = () => { const v = +b.dataset.speed; if (S.phase === 'battle' && v !== 0 && autoOn) setAuto(false); if (S.phase === 'replay') { if (v === 0) S.paused = !S.paused; else { S.speed = v; S.paused = false; } } else actSpeed(v); syncSpeed(); });
  const tl = $('#tl'); let scrubbing = false;
  const at = (e: PointerEvent) => { const r = tl.getBoundingClientRect(); seek((e.clientX - r.left - 8) / (r.width - 16) * S.rec.end); };
  tl.addEventListener('pointerdown', e => { if (S.phase !== 'replay') return; scrubbing = true; tl.setPointerCapture(e.pointerId); at(e); });
  tl.addEventListener('pointermove', e => { if (scrubbing) at(e); }); tl.addEventListener('pointerup', () => scrubbing = false);
}
// Refreshes the parts of the HUD that change every few frames.
export function hudPulse() {
  syncClock(); renderRadio(); syncSpeedReq(); syncBegin(); syncHQBar(); renderRoster(); tutorialTick();
  if (S.phase === 'battle') renderInspector();
  else if (S.phase === 'replay') { const nw = $('#now'), fl = $('#fill'); if (nw) nw.style.left = tpos(S.rt / S.rec.end); if (fl) fl.style.width = `calc((100% - 16px) * ${S.rt / S.rec.end})`; }
}

// Two players: a speed or pause change waits until both ask for it. The bar shows what the other asked for.
const speedName = (v: number) => v === 0 ? 'PAUSE' : v === -1 ? 'PLAY' : v + 'X';
function syncSpeedReq() {
  if (NET.mode === 'guest' && (S.phase === 'battle' || S.phase === 'plan') && S.lastSnap && performance.now() - S.lastSnap > 2500) toast('Waiting for the host. Their game may be paused or slow.');
  const el = $('#speedReq'), req = S.speedReq || {}, live = S.phase === 'battle' && NET.mode !== 'solo';
  const other = Object.keys(req).map(Number).find(t => t !== NET.player), mine = req[NET.player];
  if (!live || (other == null && mine == null)) { el.hidden = true; return; }
  el.hidden = false;
  if (other != null && req[other] !== mine) { $('#srText').textContent = `FRIEND WANTS ${speedName(req[other])}`; $('#srAgree').hidden = false; $('#srAgree').onclick = () => actSpeed(req[other]); }
  else { $('#srText').textContent = `WAITING FOR FRIEND TO AGREE: ${speedName(mine)}`; $('#srAgree').hidden = true; }
}

// Movers that will just stand still next phase: no new order, and no order still under way.
export const idleUnits = () => S.squads.filter((s: any) => s.team === NET.me && MOVERS.includes(s.kind) && !s.order && (!s.members || (aliveMembers(s).length && s.state === 'hold')));
function syncBegin() {
  if (S.phase !== 'plan' || S.waiting) return; const n = idleUnits().length;
  $('#bBegin').textContent = (NET.mode === 'solo' ? `BEGIN PHASE ${S.round}` : `READY · PHASE ${S.round}`) + (n ? ` · ${n} IDLE` : '');
}

// HQ capture: a bar while any HQ is being held by the enemy. Your HQ falling shows red; one you are taking, green.
function syncHQBar() {
  const el = $('#hqBar'); if (S.phase !== 'battle' && S.phase !== 'plan') { el.hidden = true; return; }
  const t = S.teams.find((x: any) => !x.lost && x.hqHold > 0 && (x.id === NET.me || x.hqBy === NET.me)) || S.teams.find((x: any) => !x.lost && x.hqHold > 0 && S.hqKnown && S.hqKnown[NET.me] && S.hqKnown[NET.me].has(x.id));
  if (!t) { el.hidden = true; return; }
  const mine = t.id === NET.me, col = mine ? 'var(--bad)' : t.hqBy === NET.me ? 'var(--go)' : 'var(--gold)', by = S.teams[t.hqBy];
  $('#hqText').textContent = mine ? `YOUR HQ IS FALLING · ${Math.floor(t.hqHold)} / ${HQ_HOLD} S` : `${by && t.hqBy === NET.me ? 'TAKING' : (by ? by.name + ' TAKING' : 'TAKING')} ${t.name} HQ · ${Math.floor(t.hqHold)} / ${HQ_HOLD} S`;
  $('#hqText').style.color = col; ($('#hqFill') as HTMLElement).style.width = Math.min(100, t.hqHold / HQ_HOLD * 100) + '%'; ($('#hqFill') as HTMLElement).style.background = col; el.hidden = false;
}

// Roster, top left: every unit of yours, its strength, morale and what it is doing. Click a row to select the unit.
let rosterKey = '';
function renderRoster() {
  const el = $('#roster'); if (S.phase !== 'plan' && S.phase !== 'battle') { el.hidden = true; return; }
  const mine = S.squads.filter((s: any) => s.team === NET.me && (!s.members || aliveMembers(s).length));
  if (!mine.length) { el.hidden = true; return; } el.hidden = false;
  const rows = mine.map((s: any) => {
    const n = s.members ? aliveMembers(s).length : s.pos.length, N = s.pos.length, mo = s.morale ?? 1, plan = S.phase === 'plan';
    const st = s.readyRound > S.round ? 'BUILDING' : plan ? (s.order ? s.order.type.toUpperCase() : s.broken ? 'BROKEN' : MOVERS.includes(s.kind) && (!s.members || s.state === 'hold') ? 'NO ORDERS' : (s.state || '').toUpperCase()) : (s.status || '');
    const bad = st === 'PINNED' || st === 'BROKEN' || st === 'SHAKEN' || st === 'FALLING BACK' || st === 'NO ORDERS';
    return { id: s.id, html: `<button class="rrow${(S.selMany || []).includes(s) || S.sel === s ? ' on' : ''}" data-id="${s.id}"><b>${s.call || KIND_NAME[s.kind].toUpperCase()}</b><span class="rk">${s.call ? KIND_NAME[s.kind].toUpperCase() : ''}</span><span class="rbar"><i style="width:${Math.round(n / N * 100)}%"></i></span><span class="rn">${n}</span><span class="rmo" title="Morale"><i style="width:${Math.round(mo * 100)}%;background:${mo < .35 ? 'var(--bad)' : mo < .65 ? 'var(--warn)' : 'var(--good)'}"></i></span><span class="rs${bad ? ' bad' : ''}">${st}</span></button>` };
  });
  const key = rows.map((r: any) => r.html).join(''); if (key === rosterKey) return; rosterKey = key;
  el.innerHTML = `<div class="rhead"><span>YOUR UNITS</span><span>${mine.length}</span></div>` + key;
  el.querySelectorAll('.rrow').forEach((b: any) => b.onclick = () => { const s = S.squads.find((q: any) => q.id === +b.dataset.id); if (!s) return; setSel(s); const c = sqCenter(s); if (c) { cam.tx = c[0]; cam.ty = c[1]; cam.userMoved = true; } });
}

// Tutorial: a short list of steps over a real battle. Each step finishes when the player has done the thing.
const TUT: { text: string; done: () => boolean }[] = [
  { text: 'Buy a platoon: click <b>RIFLES</b> in the list at the bottom left, then click inside your start area (the green dashed ring).', done: () => S.squads.some((s: any) => s.team === NET.me && s.kind === 'rifles') },
  { text: 'Select it: click its name tag. A panel opens above it. Press <b>ATTACK</b>, then click the ground towards the middle of the map. The line shows how far it gets this phase.', done: () => S.squads.some((s: any) => s.team === NET.me && s.order) },
  { text: 'Buy an <b>MG NEST</b> and place it in the start area, facing the enemy. Guns take one phase to build.', done: () => S.squads.some((s: any) => s.team === NET.me && s.kind === 'mg') },
  { text: 'Press <b>BEGIN PHASE 1</b> (or Space). Plans are locked and the phase plays out for 60 seconds.', done: () => S.phase === 'battle' },
  { text: 'Watch. Each tag shows what the unit is doing. You see only what your troops can see. The list at the top left shows strength and morale.', done: () => S.phase === 'plan' && S.round >= 2 },
  { text: 'Read the report, then press GOT IT. Buy more, and give new orders. Try <b>SUPPRESS</b> on a spot where you saw the enemy, or set a unit to <b>CAREFUL</b>.', done: () => S.round >= 2 && S.phase === 'battle' },
  { text: 'To win, hold the ground at the enemy HQ for 40 seconds, or hold more ground when the last phase ends. That is all: good luck.', done: () => S.round >= 3 },
];
function tutorialTick() {
  const el = $('#tut'); if (S.tutorial == null || S.phase === 'menu' || S.phase === 'done' || S.phase === 'replay') { el.hidden = true; return; }
  while (S.tutorial < TUT.length && TUT[S.tutorial].done()) S.tutorial++;
  if (S.tutorial >= TUT.length) { S.tutorial = null; el.hidden = true; return; }
  el.hidden = false; const h = `<div class="ph"><span>TUTORIAL · ${S.tutorial + 1} / ${TUT.length}</span><button class="btn x" id="tutSkip" title="Stop the tutorial">X</button></div><div class="pb"><p>${TUT[S.tutorial].text}</p></div>`;
  if (el.dataset.k !== String(S.tutorial)) { el.dataset.k = String(S.tutorial); el.innerHTML = h; ($('#tutSkip') as HTMLElement).onclick = () => { S.tutorial = null; el.hidden = true; }; }
}
