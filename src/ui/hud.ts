import { IW, IH, PHASES, PHASE_LEN, COST, TOOLS, KIND_NAME, SUP_NAME, T_BUILD, T_WATER, T_BRIDGE, T_ROAD, T_WOOD, T_PARK, HS, grid, fmtT, clamp } from '../config';
import { S, M, VIS0, SEEN0 } from '../state';
import { cellOf, bldNear } from '../world';
import { aliveMembers, sqCenter, itemCost, left, canRemove, removeItem, clearMine } from '../plan';
import { beginRound, newBattle, income } from '../sim';
import { aiPlan } from '../ai';
import { startReplay, seek, exitReplay, refreshReplayFog } from '../replay';
import { fit, cam } from '../render/camera';
import { paintFog, paintTerritory } from '../render/scene';
import { mulberry32 } from '../config';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
let toastT = 0, bannerT = 0;
export function toast(m: string) { const t = $('#toast'); t.textContent = m; t.hidden = false; toastT = 2.4; }
export function banner(big: string, small: string) { $('#bannerBig').textContent = big; $('#bannerSmall').textContent = small; $('#banner').hidden = false; bannerT = 2.2; }
export function tickHud(dt: number) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').hidden = true; }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').hidden = true; }
}
export function setTool(id: string) { S.tool = id; document.querySelectorAll('.tile').forEach((b: any) => b.classList.toggle('on', b.dataset.tool === id)); $('#cv').style.cursor = id === 'select' ? 'grab' : 'crosshair'; }
export function setSel(it: any) { S.sel = it; renderInspector(); }
const fogOn = () => S.phase === 'replay' ? S.replayFog : S.fog && (S.phase === 'plan' || S.phase === 'battle');

export const metaDefault = () => M ? `1.0 x 0.65 KM · ${M.count} BUILDINGS` : '';
export function showTerrain(w: any) {
  const el = $('#mapmeta'); if (!w || !M) { el.textContent = metaDefault(); return; }
  const ci = cellOf(w.x, w.y); if (ci < 0) { el.textContent = metaDefault(); return; }
  const t = M.terr[ci], m = Math.max(0, Math.round((M.hAt(w.x, w.y) - 3) / HS)); let k: string, tip: string;
  if (t === T_BUILD) { k = 'BUILDING'; tip = 'garrison it'; } else if (t === T_WATER) { k = 'WATER'; tip = 'no crossing'; } else if (t === T_BRIDGE) { k = 'BRIDGE'; tip = 'can be blown'; }
  else if (t === T_ROAD) { k = 'ROAD'; tip = 'tanks fast'; } else if (t === T_WOOD) { k = 'WOODS'; tip = 'hidden, tanks slow'; } else if (bldNear(w.x, w.y) >= 12) { k = 'TOWN'; tip = 'cover from buildings'; }
  else if (t === T_PARK) { k = 'PARK'; tip = 'open'; } else { k = 'OPEN'; tip = 'dig trenches'; }
  el.textContent = `${grid(w.x, w.y)} · ${k} · ${m} M · ${tip.toUpperCase()}`;
}

export function buildTools() {
  $('#tools').innerHTML = `<div class="ph"><span>Your orders</span><span id="toolsPhase">PHASE 1</span></div><div class="supply"><span>SUPPLY LEFT</span><b id="supply">0</b></div><div class="meter"><span id="meter"></span></div>` +
    TOOLS.map(g => `<div class="grp"><h3>${g.g}</h3><div class="tiles">${g.items.map(t => `<button class="btn tile" data-tool="${t[0]}" title="${t[3]}"><span>${t[1]}</span><em>${COST[t[0]] ? (t[2] === 'line' && t[0] !== 'air' && t[0] !== 'spy' ? COST[t[0]] + '/c' : COST[t[0]]) : ''}</em></button>`).join('')}</div></div>`).join('');
  document.querySelectorAll('.tile').forEach((b: any) => b.onclick = () => { if (S.phase !== 'plan') { toast('Orders are locked until this phase ends'); return; } setTool(b.dataset.tool); });
}
const pct = (c: number) => Math.round(c / (IW * IH) * 100);
const aliveOf = (t: number) => S.units.filter((u: any) => u.alive && u.team === t).length;
function teamTable() {
  return `<dl class="kv">${S.teams.map((t: any) => `<dt style="color:${t.color}">${t.name}</dt><dd>${t.id && fogOn() ? '?' : aliveOf(t.id)} alive · ${pct(S.terrCount[t.id] || 0)}% ground</dd>`).join('')}</dl>`;
}
function intel() {
  const known = S.known[0] ? [...S.known[0].values()] : [], lines: string[] = [];
  const at = (k: string) => [...new Set(known.filter(e => e.kind === k).map(e => grid(e.x, e.y)))];
  lines.push(known.length ? `${known.length} enemy seen. Last positions shown faded.` : 'No enemy seen yet. A spy plane or forward troops will find them.');
  const mg = at('mg'), mo = at('mortar'), tk = at('tank'), atg = at('at');
  if (mg.length) lines.push(`MG at ${mg.join(', ')}.`); if (mo.length) lines.push(`Mortars at ${mo.join(', ')}.`); if (tk.length) lines.push(`Tanks at ${tk.join(', ')}.`); if (atg.length) lines.push(`AT guns at ${atg.join(', ')}.`);
  lines.push(`Ours: ${aliveOf(0)} alive. Supply this phase +${S.round > 1 ? income(0) : 0}.`);
  return lines.map(l => `<p class="hint" style="margin:0 0 4px">${l}</p>`).join('');
}
const HINT: Record<string, string> = {
  mortar: 'Fires at enemies 26 to 155 away that your side can see.', at: 'Fires only at tanks. Range 85.',
  op: 'Sees far, spots for mortars and tightens artillery. Further from high ground.', garrison: 'Inside a building: 85% cover, fires from the roof, never moves.',
  tank: 'Fast on roads, slow in woods, stopped by tank traps. Only AT guns, shells, bombs and tanks hurt it.', sniper: 'Sees and shoots twice as far as a rifleman.',
};
export function renderInspector() {
  const it = S.sel, body = $('#inspBody'), title = $('#inspTitle');
  if (S.phase === 'replay') { title.textContent = 'Replay'; body.innerHTML = `<p class="hint">Drag the timeline to jump. Click a log line to go there. FOLLOW ACTION keeps the camera on the fighting; pan, turn or zoom to take over.</p>`; return; }
  if (!it) {
    if (S.phase === 'plan') {
      title.textContent = S.round === 1 ? 'Deploy' : `Briefing · phase ${S.round}`;
      body.innerHTML = S.round === 1
        ? `<p class="hint">Build on your own ground, tinted blue. You only see what your troops and planes can see. Fit the plan to the ground; hover the map to read it.</p><p class="hint" style="margin-top:6px;color:var(--muted)">AI PLAN shows what the AI would do.</p>`
        : `${intel()}<p class="hint" style="margin-top:6px;color:var(--muted)">Platoons with no new order carry on.</p>`;
    } else { title.textContent = 'Battle'; body.innerHTML = `${teamTable()}<p class="hint" style="margin-top:8px">Orders are locked until the phase ends. Click a dot to see its unit.</p>`; }
    return;
  }
  const col = S.teams[it.team].color; let h = '';
  if (it.pos) {
    title.textContent = it.call ? `${it.call} · ${it.temp ? 'Paratroopers' : KIND_NAME[it.kind]}` : KIND_NAME[it.kind];
    const alive = it.members ? aliveMembers(it).length : it.pos.length, kills = it.members ? it.members.reduce((a: number, i: number) => a + S.units[i].kills, 0) : 0, c = sqCenter(it);
    const doing = it.members ? (it.state || 'hold').toUpperCase() : 'NOT DEPLOYED';
    const next = it.order ? `${it.order.type.toUpperCase()} ${grid(it.order.x, it.order.y)}` : (it.members ? 'CARRY ON' : (['mg', 'mortar', 'at', 'op', 'garrison'].includes(it.kind) ? 'FIXED' : 'HOLD'));
    h = `<dl class="kv"><dt>Team</dt><dd style="color:${col}">${S.teams[it.team].name}</dd><dt>Grid</dt><dd>${c ? grid(c[0], c[1]) : '-'}</dd><dt>Strength</dt><dd>${alive} / ${it.pos.length}</dd><dt>Now</dt><dd>${doing}</dd>${S.phase === 'plan' && it.team === 0 ? `<dt>Next phase</dt><dd>${next}</dd>` : ''}${it.members ? `<dt>Kills</dt><dd>${kills}</dd>` : `<dt>Cost</dt><dd>${itemCost(it)}</dd>`}</dl>`;
    if (HINT[it.kind]) h += `<p class="hint" style="margin-top:8px">${HINT[it.kind]}</p>`;
    if (S.phase === 'plan' && it.team === 0) h += `<div class="row">${it.order ? '<button class="btn" id="iClear">CLEAR ORDER</button>' : ''}${canRemove(it) ? '<button class="btn stop" id="iDel">REMOVE</button>' : ''}</div>`;
  } else if (it.cells) {
    title.textContent = { trench: 'Trench', sandbag: 'Sandbags', wall: 'Wall', wire: 'Wire', tanktrap: 'Tank traps' }[it.type];
    h = `<dl class="kv"><dt>Length</dt><dd>${it.cells.length} cells</dd><dt>Effect</dt><dd>${{ trench: '70% cover', sandbag: '50% cover', wall: 'blocks sight', wire: '1/3 speed', tanktrap: 'stops tanks' }[it.type]}</dd><dt>Cost</dt><dd>${itemCost(it)}</dd></dl>` + (canRemove(it) ? `<div class="row"><button class="btn stop" id="iDel">REMOVE</button></div>` : '');
  } else {
    title.textContent = { barrage: 'Artillery', air: 'Air strike', para: 'Paradrop', demo: 'Demolition', spy: 'Spy plane' }[it.type];
    h = `<dl class="kv"><dt>Target</dt><dd>${grid(it.a.x, it.a.y)}</dd><dt>At</dt><dd>T+${Math.floor(it.t)} s, phase ${it.round}</dd><dt>Cost</dt><dd>${itemCost(it)}</dd></dl>`
      + (it.type === 'barrage' ? `<p class="hint" style="margin-top:8px">Hits every team in the circle, yours too.</p>` : it.type === 'spy' ? `<p class="hint" style="margin-top:8px">Sees everything within 55 of its path while it flies.</p>` : '')
      + (canRemove(it) ? `<div class="row"><button class="btn" id="iEarly">-5 S</button><button class="btn" id="iLate">+5 S</button><button class="btn stop" id="iDel">REMOVE</button></div>` : '');
  }
  body.innerHTML = h;
  const b = (id: string, f: () => void) => { const x = $(id); if (x) x.onclick = f; };
  b('#iDel', () => { removeItem(it); setSel(null); }); b('#iClear', () => { it.order = null; renderInspector(); });
  b('#iEarly', () => { it.t = Math.max(0, it.t - 5); renderInspector(); renderTimeline(); }); b('#iLate', () => { it.t = Math.min(PHASE_LEN - 5, it.t + 5); renderInspector(); renderTimeline(); });
}
export function renderRoster() {
  $('#teamCount').textContent = String(S.nTeams);
  $('#roster').innerHTML = S.teams.map((t: any) => {
    const st = S.stats[t.id], alive = aliveOf(t.id), g = pct(S.terrCount[t.id] || 0), hidden = t.id && fogOn();
    const v = S.units.length ? `${hidden ? '?' : alive} · ${g}%` : `${g}% GROUND`, fr = hidden ? 1 : st && st.start ? alive / st.start : 1;
    return `<div class="team"><i style="background:${t.color}"></i><span>${t.name} · ${t.id === 0 ? 'YOU' : (t.per ? t.per.label : 'AI')}</span><span class="v">${v}</span><div class="bar"><span style="width:${Math.round(clamp(fr, 0, 1) * 100)}%;background:${t.color}"></span></div></div>`;
  }).join('');
}
const tpos = (f: number) => `calc(8px + (100% - 16px) * ${clamp(f, 0, 1)})`;
export function renderTimeline() {
  const el = $('#tl'); el.classList.toggle('scrub', S.phase === 'replay'); let h = '<div class="axis"></div>';
  if (S.phase === 'replay') {
    const end = S.rec.end; h += `<div class="fill" id="fill" style="width:calc((100% - 16px) * ${S.rt / end})"></div>`;
    for (const p of S.rec.phases) h += `<span class="ev" style="left:${tpos(p.t / end)}">PHASE ${p.round}</span>`;
    for (const l of S.log) { if (l.team < 0 || !logVisible(l)) continue; h += `<span class="mk" style="left:${tpos(l.t / end)};background:${S.teams[l.team].color}"></span>`; }
    h += `<span class="tick" style="left:${tpos(1)};transform:translateX(-100%)">${fmtT(end)}</span><span class="now" id="now" style="left:${tpos(S.rt / end)}"></span>`;
  } else if (S.phase === 'plan' || S.phase === 'battle') {
    h += `<span class="lbl">PHASE ${S.round}</span>`; for (let t = 15; t < PHASE_LEN; t += 15) h += `<span class="tick" style="left:${tpos(t / PHASE_LEN)}">T+${t}</span>`;
    for (const s of S.supports) { if (s.round !== S.round || s.team !== 0) continue; h += `<span class="ev" style="left:${tpos(s.t / PHASE_LEN)};border-color:${s.type === 'spy' ? '#b8c0cc' : '#e8892e'}">${SUP_NAME[s.type]} ${Math.floor(s.t)}</span>`; }
    if (S.phase === 'battle') h += `<span class="now" id="now" style="left:${tpos((S.t - S.phaseStart) / PHASE_LEN)}"></span>`;
  }
  el.innerHTML = h;
}
const logVisible = (l: any) => !fogOn() || l.team < 0 || l.team === 0;
export function renderLog(force?: boolean) {
  const el = $('#log'); el.hidden = S.phase === 'plan' && S.round === 1; if (!S.logDirty && !force) return; S.logDirty = false; const rp = S.phase === 'replay';
  const items = S.log.filter((l: any) => logVisible(l) && (!rp || l.t <= S.rt)).slice(0, rp ? 60 : 30);
  el.innerHTML = items.map((l: any) => `<p class="${rp ? 'seek' : ''}" data-t="${l.t}"><b>${fmtT(l.t)}</b><span style="color:${l.team >= 0 ? S.teams[l.team].color : 'var(--gold)'}">${l.msg}</span></p>`).join('');
  if (rp) el.querySelectorAll('p').forEach((p: any) => p.onclick = () => seek(+p.dataset.t - 2));
}
export function syncSpeed() { document.querySelectorAll('#speeds .btn').forEach((b: any) => { const v = +b.dataset.speed; b.classList.toggle('on', v === 0 ? S.paused : (!S.paused && v === S.speed)); }); }
export function syncFollow() { $('#bFollow').classList.toggle('on', S.follow); }
export function syncUI() {
  const ph = S.phase, plan = ph === 'plan';
  $('#phase').textContent = plan ? (S.round === 1 ? 'DEPLOY' : 'BRIEFING') : ph === 'battle' ? `PHASE ${S.round} / ${PHASES}` : ph === 'done' ? 'DEBRIEF' : 'REPLAY';
  $('#phase').style.color = plan ? 'var(--gold)' : ph === 'battle' ? 'var(--bad)' : ph === 'done' ? 'var(--good)' : 'var(--info)';
  const show = (id: string, v: boolean) => $(id).hidden = !v;
  show('#bBegin', plan); $('#bBegin').textContent = `BEGIN PHASE ${S.round}`; show('#bClear', plan); show('#bAuto', plan);
  show('#bReplay', ph === 'done'); show('#bNew', ph !== 'replay'); show('#bExit', ph === 'replay'); show('#bFollow', ph === 'replay'); show('#bFromStart', ph === 'replay');
  const fb = $('#bFog'), fo = ph === 'replay' ? S.replayFog : S.fog; fb.textContent = fo ? 'FOG ON' : 'FOG OFF'; fb.classList.toggle('on', fo); show('#bFog', ph !== 'done');
  document.querySelectorAll('.tile').forEach((b: any) => b.disabled = !plan); $('#toolsPhase').textContent = `PHASE ${S.round}`;
  $('#mapname').textContent = M ? M.name : ''; $('#mapmeta').textContent = metaDefault(); $('#credit').textContent = M && M.credit ? M.credit : '';
  if (ph !== 'done') $('#result').hidden = true;
  if (S.teams.length && S.bank.length) { $('#supply').textContent = String(left(0)); $('#meter').style.width = clamp(left(0) / Math.max(1, S.bank[0]) * 100, 0, 100) + '%'; }
  renderRoster(); renderTimeline(); renderInspector(); syncSpeed(); syncFollow(); renderLog(true);
}
export function refreshFogPaint() {
  if (S.phase === 'replay') { refreshReplayFog(); return; }
  const on = S.fog && (S.phase === 'plan' || S.phase === 'battle');
  paintFog(VIS0, SEEN0, on); paintTerritory(on ? SEEN0 : null);
}
export function showResult() {
  const r = S.result, el = $('#result'), st = S.stats, w = r.winner >= 0 ? S.teams[r.winner] : null;
  const rows = S.history.map((h: any) => `<tr><td>PHASE ${h.round}</td>${S.teams.map((t: any) => `<td style="color:${t.color}">${pct(h.terr[t.id])}%</td>`).join('')}</tr>`).join('');
  el.innerHTML = `<div class="ph"><span>After-action report · ${fmtT(S.t)}</span><button class="btn" id="rHide" title="Hide">X</button></div><div class="pb"><div class="big" style="color:${w ? w.color : 'var(--muted)'}">${w ? w.name + ' WINS' : 'NO SURVIVORS'}</div><p class="hint" style="margin:0 0 8px">${r.byTime ? 'All phases fought. Most ground held wins.' : 'Last team standing.'}</p>
  <table><tr><th>Team</th><th>Alive</th><th>Lost</th><th>Kills</th><th>Ground</th></tr>${S.teams.map((t: any) => `<tr><td style="color:${t.color}">${t.name}${t.id ? ' · ' + t.per.label : ''}</td><td>${r.alive[t.id]}</td><td>${st[t.id].lost}</td><td>${st[t.id].kills}</td><td>${pct(r.terr[t.id])}%</td></tr>`).join('')}</table>
  ${rows ? `<table style="margin-top:10px"><tr><th>Ground by phase</th>${S.teams.map((t: any) => `<th>${t.name}</th>`).join('')}</tr>${rows}</table>` : ''}
  <div class="row" style="margin-top:12px"><button class="btn go" id="rReplay">WATCH REPLAY</button><button class="btn" id="rNew">NEW BATTLE</button></div></div>`;
  el.hidden = false;
  $('#rReplay').onclick = goReplay; $('#rNew').onclick = () => { newBattle(); fit(); }; $('#rHide').onclick = () => el.hidden = true;
}
function goReplay() { $('#result').hidden = true; startReplay(); syncUI(); }

export function bindStrip(toMenu: () => void) {
  $('#bBegin').onclick = () => { if (S.round === 1 && !S.squads.some((s: any) => s.team === 0)) { toast('Place at least one unit first'); return; } beginRound(); };
  $('#bReplay').onclick = goReplay;
  $('#bExit').onclick = () => { exitReplay(); syncUI(); showResult(); };
  $('#bFromStart').onclick = () => { seek(0); S.paused = false; syncSpeed(); };
  $('#bFollow').onclick = () => { S.follow = !S.follow; syncFollow(); };
  $('#bNew').onclick = () => { newBattle(); cam.userMoved = false; fit(); };
  $('#bClear').onclick = () => { clearMine(0); setSel(null); syncUI(); toast('Removed what you placed this phase'); };
  $('#bAuto').onclick = () => { clearMine(0); S.teams[0].rng = mulberry32((Math.random() * 1e9) | 0); aiPlan(0); setSel(null); syncUI(); toast('AI plan loaded. Edit it or clear it.'); };
  $('#bFog').onclick = () => { if (S.phase === 'replay') S.replayFog = !S.replayFog; else S.fog = !S.fog; refreshFogPaint(); syncUI(); };
  $('#bView').onclick = () => { cam.userMoved = false; fit(); };
  $('#bMenu').onclick = toMenu;
  $('#bHelp').onclick = () => { $('#help').hidden = !$('#help').hidden; };
  $('#helpClose').onclick = () => { $('#help').hidden = true; };
  document.querySelectorAll('#speeds .btn').forEach((b: any) => b.onclick = () => { const v = +b.dataset.speed; if (v === 0) S.paused = !S.paused; else { S.speed = v; S.paused = false; } syncSpeed(); });
  const tl = $('#tl'); let scrubbing = false;
  const at = (e: PointerEvent) => { const r = tl.getBoundingClientRect(); seek((e.clientX - r.left - 8) / (r.width - 16) * S.rec.end); };
  tl.addEventListener('pointerdown', e => { if (S.phase !== 'replay') return; scrubbing = true; tl.setPointerCapture(e.pointerId); at(e); });
  tl.addEventListener('pointermove', e => { if (scrubbing) at(e); }); tl.addEventListener('pointerup', () => scrubbing = false);
}
// Refreshes the parts of the HUD that change every few frames.
export function hudPulse() {
  if (S.phase === 'battle') {
    $('#clock').textContent = `T+${Math.floor(S.t - S.phaseStart)} · ${fmtT(S.t)}`; renderRoster(); renderLog();
    const nw = $('#now'); if (nw) nw.style.left = tpos((S.t - S.phaseStart) / PHASE_LEN); renderInspector();
  } else if (S.phase === 'replay') {
    $('#clock').textContent = `${fmtT(S.rt)} / ${fmtT(S.rec.end)}`; const nw = $('#now'), fl = $('#fill');
    if (nw) nw.style.left = tpos(S.rt / S.rec.end); if (fl) fl.style.width = `calc((100% - 16px) * ${S.rt / S.rec.end})`; S.logDirty = true; renderLog();
  } else if (S.phase === 'plan') {
    $('#clock').textContent = `PHASE ${S.round} / ${PHASES}`; $('#supply').textContent = String(left(0)); $('#meter').style.width = clamp(left(0) / Math.max(1, S.bank[0]) * 100, 0, 100) + '%'; renderRoster(); renderTimeline();
  } else if (S.phase === 'done') $('#clock').textContent = fmtT(S.t);
}
