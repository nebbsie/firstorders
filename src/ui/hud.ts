import { NET } from '../state';
import { PLAY_R, M_PER_UNIT, PHASE_LEN, COST, TOOLS, INFO, KIND_NAME, T_BUILD, T_WATER, T_BRIDGE, T_ROAD, T_WOOD, T_PARK, HS, grid, fmtT, clamp } from '../config';
import { S, M, VIS0, SEEN0 } from '../state';
import { cellOf, bldNear } from '../world';
import { aliveMembers, sqCenter, itemCost, left, canRemove, removeItem } from '../plan';
import { newBattle } from '../sim';
import { actRemove, actOrders, actTime, actReady, actSpeed } from '../actions';
import { startReplay, seek, exitReplay, refreshReplayFog } from '../replay';
import { fit, cam } from '../render/camera';
import { paintFog, paintTerritory, viewOpts, applyViews } from '../render/scene';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
let toastT = 0, bannerT = 0;
export function toast(m: string) { const t = $('#toast'); t.textContent = m; t.hidden = false; toastT = 2.4; }
export function banner(big: string, small: string) { $('#bannerBig').textContent = big; $('#bannerSmall').textContent = small; $('#banner').hidden = false; bannerT = 2.2; }
export function tickHud(dt: number) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').hidden = true; }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').hidden = true; }
}
const fogOn = () => S.phase === 'replay' ? S.replayFog : S.fog && (S.phase === 'plan' || S.phase === 'battle');

// Phase card: says which phase this is and what to do now.
export function phaseCard() {
  const r = S.round, body = r === 1
    ? `<p><b>Take the enemy HQ. Hold your own.</b> An HQ falls when enemy troops hold its ground for 5 seconds.</p><p>Your ground is tinted blue. You can only build there.</p><p>Open <b>DEFENCES</b>, <b>UNITS</b> and <b>SUPPORT</b> below to buy. Select your units, then use <b>ORDERS</b> to send them.</p><p>You do not know where the enemy HQ is. A <b>SPY PLANE</b> or forward troops will find it.</p><p>Press <b>BEGIN PHASE 1</b> when ready.</p>`
    : `<p>Phase ${r - 1} is over. You have <b>${left(NET.me)}</b> supply.</p><p>Build on the ground you now hold, buy more, and give new orders. Units with no new order carry on.</p><p>Faded dots are where you last saw the enemy.</p><p>Press <b>BEGIN PHASE ${r}</b> when ready.</p>`;
  $('#cardTitle').textContent = `PHASE ${r} · ${r === 1 ? 'DEPLOY' : 'REINFORCE'}`; $('#cardBody').innerHTML = body; $('#card').hidden = false;
}

// Tool tiles open above their command in the bottom strip, as in Mall Architect.
let openGroup = '';
export function setTool(id: string) {
  S.tool = id; document.querySelectorAll('.tile').forEach((b: any) => b.classList.toggle('on', b.dataset.tool === id));
  $('#cv').style.cursor = id === 'select' ? 'default' : 'crosshair'; if (id === 'select') $('#cursorNote').hidden = true;
}
function openTools(g: string) {
  openGroup = openGroup === g ? '' : g; const panel = $('#toolpanel');
  document.querySelectorAll('.cmd').forEach((b: any) => b.classList.toggle('on', b.dataset.g === openGroup));
  if (!openGroup) { panel.hidden = true; setTool('select'); return; }
  const grp = TOOLS.find(t => t.g === g);
  panel.innerHTML = `<h3>${grp.g}</h3><div class="tiles">${grp.items.map(t => `<button class="btn tile" data-tool="${t[0]}" ><span>${t[1]}</span><em>${COST[t[0]] ? (t[2] === 'line' && t[0] !== 'air' && t[0] !== 'spy' ? COST[t[0]] + '/c' : COST[t[0]]) : ''}</em></button>`).join('')}</div>`;
  const btn = document.querySelector(`.cmd[data-g="${g}"]`) as HTMLElement; panel.hidden = false; panel.style.left = Math.max(10, btn.getBoundingClientRect().left) + 'px';
  panel.querySelectorAll('.tile').forEach((b: any) => {
    b.onclick = () => setTool(S.tool === b.dataset.tool ? 'select' : b.dataset.tool);
    b.onmouseenter = () => showInfo(b.dataset.tool); b.onmouseleave = () => { $('#info').hidden = true; };
  });
  setTool(S.tool);
}
export function closeTools() { if (openGroup) openTools(openGroup); }
// Right-hand window while hovering a tool tile: what it is, where it works, what beats it.
function showInfo(id: string) {
  const def = TOOLS.flatMap(g => g.items).find(t => t[0] === id), inf = INFO[id]; if (!def || !inf) return;
  $('#info').innerHTML = `<div class="ph"><span>${def[1]}</span><span>${COST[id] ? COST[id] + (def[2] === 'line' && id !== 'air' && id !== 'spy' ? ' / CELL' : '') : ''}</span></div><div class="pb"><p class="hint">${inf[0]}</p>${inf[1] ? `<dl class="kv" style="margin-top:8px"><dt>Best</dt><dd>${inf[1]}</dd><dt>Beaten by</dt><dd>${inf[2]}</dd></dl>` : ''}<p class="note">${def[2] === 'line' ? 'Drag a line.' : def[2] === 'order' ? 'Select units first.' : ['spy', 'barrage', 'para', 'demo', 'air'].includes(id) ? 'Anywhere in the circle.' : 'On your own ground.'}</p></div>`;
  $('#info').hidden = false;
}
function buildCommands() {
  $('#cmds').innerHTML = TOOLS.map(t => `<button class="btn cmd" data-g="${t.g}">${t.g}</button>`).join('');
  document.querySelectorAll('.cmd').forEach((b: any) => b.onclick = () => openTools(b.dataset.g));
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
    if (S.phase === 'plan') h += `<p class="hint" style="margin-top:8px">Pick ATTACK or DEFEND, then click the ground.</p><div class="row"><button class="btn" id="iAtk">ATTACK</button><button class="btn" id="iDef">DEFEND</button><button class="btn" id="iClear">CLEAR ORDERS</button></div>`;
  } else if (it && it.pos) {
    const col = S.teams[it.team].color;
    title.textContent = it.call ? `${it.call} · ${it.temp ? 'Paratroopers' : KIND_NAME[it.kind]}` : KIND_NAME[it.kind];
    const alive = it.members ? aliveMembers(it).length : it.pos.length, kills = it.members ? it.members.reduce((a: number, i: number) => a + S.units[i].kills, 0) : 0, c = sqCenter(it);
    const doing = it.members ? (it.state || 'hold').toUpperCase() : 'NOT DEPLOYED';
    const next = it.order ? `${it.order.type.toUpperCase()} ${grid(it.order.x, it.order.y)}` : (it.members ? 'CARRY ON' : (['mg', 'mortar', 'at', 'op', 'garrison'].includes(it.kind) ? 'FIXED' : 'HOLD'));
    h = `<dl class="kv"><dt>Team</dt><dd style="color:${col}">${S.teams[it.team].name}</dd><dt>Grid</dt><dd>${c ? grid(c[0], c[1]) : '-'}</dd><dt>Strength</dt><dd>${alive} / ${it.pos.length}</dd><dt>Now</dt><dd>${doing}</dd>${S.phase === 'plan' && it.team === NET.me ? `<dt>Next phase</dt><dd>${next}</dd>` : ''}${it.members ? `<dt>Kills</dt><dd>${kills}</dd>` : `<dt>Cost</dt><dd>${itemCost(it)}</dd>`}</dl>`;
    if (HINT[it.kind]) h += `<p class="hint" style="margin-top:8px">${HINT[it.kind]}</p>`;
    const mover = ['rifles', 'sniper', 'tank'].includes(it.kind);
    if (S.phase === 'plan' && it.team === NET.me) h += `<div class="row">${mover ? '<button class="btn" id="iAtk">ATTACK</button><button class="btn" id="iDef">DEFEND</button>' : ''}${it.order ? '<button class="btn" id="iClear">CLEAR ORDER</button>' : ''}${canRemove(it) ? '<button class="btn stop" id="iDel">REMOVE</button>' : ''}</div>`;
  } else if (it && it.cells) {
    title.textContent = { trench: 'Trench', sandbag: 'Sandbags', wall: 'Wall', wire: 'Wire', tanktrap: 'Tank traps' }[it.type];
    h = `<dl class="kv"><dt>Length</dt><dd>${it.cells.length} cells</dd><dt>Effect</dt><dd>${{ trench: '70% cover', sandbag: '50% cover', wall: 'blocks sight', wire: '1/3 speed', tanktrap: 'stops tanks' }[it.type]}</dd><dt>Cost</dt><dd>${itemCost(it)}</dd></dl>` + (canRemove(it) ? `<div class="row"><button class="btn stop" id="iDel">REMOVE</button></div>` : '');
  } else if (it) {
    title.textContent = { barrage: 'Artillery', air: 'Air strike', para: 'Paradrop', demo: 'Demolition', spy: 'Spy plane' }[it.type];
    h = `<dl class="kv"><dt>Target</dt><dd>${grid(it.a.x, it.a.y)}</dd><dt>At</dt><dd>T+${Math.floor(it.t)} s, phase ${it.round}</dd><dt>Cost</dt><dd>${itemCost(it)}</dd></dl>`
      + (it.type === 'barrage' ? `<p class="hint" style="margin-top:8px">Hits every team in the circle, yours too.</p>` : it.type === 'spy' ? `<p class="hint" style="margin-top:8px">Sees everything within 55 of its path while it flies.</p>` : '')
      + (canRemove(it) ? `<div class="row"><button class="btn" id="iEarly">-5 S</button><button class="btn" id="iLate">+5 S</button><button class="btn stop" id="iDel">REMOVE</button></div>` : '');
  }
  body.innerHTML = h;
  const b = (id: string, f: () => void) => { const x = body.querySelector(id) as HTMLElement; if (x) x.onclick = f; };
  b('#iDel', () => { actRemove(it.id); setSel(null); });
  b('#iClear', () => { actOrders(S.selMany.map((s: any) => ({ id: s.id, type: null }))); renderInspector(); });
  b('#iAtk', () => { if (openGroup !== 'ORDERS') openTools('ORDERS'); setTool('attack'); });
  b('#iDef', () => { if (openGroup !== 'ORDERS') openTools('ORDERS'); setTool('defend'); });
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
  el.innerHTML = items.map((l: any) => `<p style="border-left-color:${l.team >= 0 ? S.teams[l.team].color : 'var(--gold)'};opacity:${now - l.t > 9 ? .4 : 1}"><b>${fmtT(l.t)}</b>${l.msg}</p>`).join('');
}
export function syncSpeed() { document.querySelectorAll('#speeds .btn').forEach((b: any) => { const v = +b.dataset.speed; b.classList.toggle('on', v === 0 ? S.paused : (!S.paused && v === S.speed)); }); }
export function syncFollow() { $('#bFollow').classList.toggle('on', S.follow); }
function syncClock() {
  const ph = S.phase;
  if (ph === 'plan') { $('#phaseName').textContent = `PHASE ${S.round}`; $('#clock').textContent = S.round === 1 ? 'DEPLOY' : 'REINFORCE'; }
  else if (ph === 'battle') { $('#phaseName').textContent = `PHASE ${S.round}`; $('#clock').textContent = `T+${Math.floor(S.t - S.phaseStart)}`; }
  else if (ph === 'replay') { $('#phaseName').textContent = 'REPLAY'; $('#clock').textContent = `${fmtT(S.rt)} / ${fmtT(S.rec.end)}`; }
  else if (ph === 'done') { $('#phaseName').textContent = 'DEBRIEF'; $('#clock').textContent = fmtT(S.t); }
  if (S.teams.length && S.bank.length) $('#supply').textContent = String(Math.max(0, left(NET.me)));
}
export function syncUI() {
  const ph = S.phase, plan = ph === 'plan', show = (id: string, v: boolean) => $(id).hidden = !v;
  const live = plan || ph === 'battle';
  if (!plan) S.waiting = false;
  show('#bBegin', plan); $('#bBegin').textContent = S.waiting ? 'WAITING FOR FRIEND' : NET.mode === 'solo' ? `BEGIN PHASE ${S.round}` : `READY · PHASE ${S.round}`; show('#cmds', live); show('#supplyPlate', live);
  show('#bReplay', ph === 'done'); show('#bNew', ph === 'done'); show('#bExit', ph === 'replay'); show('#bFollow', ph === 'replay'); show('#bFromStart', ph === 'replay');
  if (!live) { closeTools(); setTool('select'); }
  if (!plan) $('#card').hidden = true;
  if (ph !== 'done') $('#result').hidden = true;
  syncClock(); renderTimeline(); renderInspector(); syncSpeed(); syncFollow(); renderRadio();
}
export function refreshFogPaint() {
  if (S.phase === 'replay') { refreshReplayFog(); return; }
  const on = S.fog && (S.phase === 'plan' || S.phase === 'battle');
  paintFog(VIS0, SEEN0, on); paintTerritory(on ? SEEN0 : null);
}
// Share of the battle circle (about 50 ground cells across).
const PLAY_CELLS = Math.PI * (PLAY_R / 4) ** 2;
const pct = (c: number) => Math.round(c / PLAY_CELLS * 100);
export function showResult() {
  const r = S.result, el = $('#result'), st = S.stats, w = r.winner >= 0 ? S.teams[r.winner] : null;
  const rows = S.history.map((h: any) => `<tr><td>PHASE ${h.round}</td>${S.teams.map((t: any) => `<td style="color:${t.color}">${pct(h.terr[t.id])}%</td>`).join('')}</tr>`).join('');
  el.innerHTML = `<div class="ph"><span>After-action report · ${fmtT(S.t)}</span><button class="btn x" id="rHide" title="Hide">X</button></div><div class="pb"><div class="big" style="color:${w ? w.color : 'var(--muted)'}">${w ? w.name + ' WINS' : 'NO SURVIVORS'}</div><p class="hint" style="margin:0 0 8px">${r.byTime ? 'Phase limit reached. Most ground held wins.' : r.winner === NET.me ? 'You took the enemy HQ.' : S.teams[NET.me].lost ? 'Your HQ fell.' : 'The last HQ standing wins.'}</p>
  <table><tr><th>Team</th><th>Alive</th><th>Lost</th><th>Kills</th><th>Ground</th></tr>${S.teams.map((t: any) => `<tr><td style="color:${t.color}">${t.name}${t.id !== NET.me ? ' · ' + (t.human ? 'PLAYER' : t.per.label) : ' · YOU'}</td><td>${r.alive[t.id]}</td><td>${st[t.id].lost}</td><td>${st[t.id].kills}</td><td>${pct(r.terr[t.id])}%</td></tr>`).join('')}</table>
  ${rows ? `<table style="margin-top:10px"><tr><th>Ground by phase</th>${S.teams.map((t: any) => `<th>${t.name}</th>`).join('')}</tr>${rows}</table>` : ''}
  <div class="row" style="margin-top:12px"><button class="btn go" id="rReplay">WATCH REPLAY</button><button class="btn" id="rNew">NEW BATTLE</button></div></div>`;
  el.hidden = false;
  $('#rReplay').onclick = goReplay; $('#rNew').onclick = () => { newBattle(); fit(); phaseCard(); }; $('#rHide').onclick = () => el.hidden = true;
}
function goReplay() { $('#result').hidden = true; startReplay(); syncUI(); }

export function bindStrip(toMenu: () => void) {
  buildCommands();
  $('#bBegin').onclick = () => { if (S.round === 1 && !S.squads.some((s: any) => s.team === NET.me)) { toast('Buy at least one unit first'); return; } closeTools(); setSel(null); actReady(); if (NET.mode !== 'solo' && S.phase === 'plan') { S.waiting = true; syncUI(); } };
  $('#bReplay').onclick = goReplay;
  $('#bExit').onclick = () => { exitReplay(); syncUI(); showResult(); };
  $('#bFromStart').onclick = () => { seek(0); S.paused = false; syncSpeed(); };
  $('#bFollow').onclick = () => { S.follow = !S.follow; syncFollow(); };
  $('#bNew').onclick = () => { newBattle(); cam.userMoved = false; fit(); phaseCard(); };
  $('#bMenu').onclick = toMenu;
  $('#bHelp').onclick = () => { $('#help').hidden = !$('#help').hidden; };
  $('#helpClose').onclick = () => { $('#help').hidden = true; };
  $('#cardOk').onclick = () => { $('#card').hidden = true; };
  $('#inspClose').onclick = () => setSel(null);
  $('#vArea').onclick = () => { viewOpts.area = !viewOpts.area; $('#vArea').classList.toggle('on', viewOpts.area); refreshFogPaint(); };
  $('#vBld').onclick = () => { viewOpts.buildings = !viewOpts.buildings; $('#vBld').classList.toggle('on', viewOpts.buildings); applyViews(); };
  document.querySelectorAll('#speeds .btn').forEach((b: any) => b.onclick = () => { const v = +b.dataset.speed; if (S.phase === 'replay') { if (v === 0) S.paused = !S.paused; else { S.speed = v; S.paused = false; } } else actSpeed(v); syncSpeed(); });
  const tl = $('#tl'); let scrubbing = false;
  const at = (e: PointerEvent) => { const r = tl.getBoundingClientRect(); seek((e.clientX - r.left - 8) / (r.width - 16) * S.rec.end); };
  tl.addEventListener('pointerdown', e => { if (S.phase !== 'replay') return; scrubbing = true; tl.setPointerCapture(e.pointerId); at(e); });
  tl.addEventListener('pointermove', e => { if (scrubbing) at(e); }); tl.addEventListener('pointerup', () => scrubbing = false);
}
// Refreshes the parts of the HUD that change every few frames.
export function hudPulse() {
  syncClock(); renderRadio();
  if (S.phase === 'battle') renderInspector();
  else if (S.phase === 'replay') { const nw = $('#now'), fl = $('#fill'); if (nw) nw.style.left = tpos(S.rt / S.rec.end); if (fl) fl.style.width = `calc((100% - 16px) * ${S.rt / S.rec.end})`; }
}
