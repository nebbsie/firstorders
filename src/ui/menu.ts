import { S, NET } from '../state';
import { setBattleSize, BATTLE_KM } from '../config';
import { searchPlaces, importPlace, type Place } from '../map/osm';
import { sampleTown } from '../map/procgen';
import { host, join, closeNet } from '../net';
import type { RawMap } from '../map/types';
import { MISSIONS, progress, useMission } from '../campaign';
import { toggleMute, isMuted } from '../audio';
import { setShadows, shadowsOn } from '../render/scene';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export type MapSpec = ({ kind: 'sample'; seed: number } | { kind: 'osm'; place: Place }) & { km: number; spawn?: number };

// Load the map a spec names. The guest uses this to load the same map as the host.
export async function loadSpec(spec: MapSpec, status: (s: string) => void): Promise<RawMap> {
  setBattleSize(spec.km || 1);
  return spec.kind === 'sample' ? sampleTown(spec.seed) : importPlace(spec.place, status);
}
export function menuStatus(s: string, bad?: boolean) { const el = $('#mStatus'); el.textContent = s; el.style.color = bad ? 'var(--bad)' : 'var(--soft)'; }
function netStatus(s: string) { $('#mNet').textContent = s; }

// The start screen: the map, the number of teams, and playing a friend.
export function initMenu(start: (raw: RawMap, spec: MapSpec) => void, guestMap: (raw: RawMap) => void, onJoined: () => void, onLeft: () => void) {
  let places: Place[] = [], chosen: Place | null = null;
  const teams = () => { document.querySelectorAll('#mTeams .btn').forEach((b: any) => b.classList.toggle('on', +b.dataset.n === S.nTeams)); };
  document.querySelectorAll('#mTeams .btn').forEach((b: any) => b.onclick = () => { S.nTeams = +b.dataset.n; teams(); });
  teams();
  const sizes = () => document.querySelectorAll('#mSize .btn').forEach((b: any) => b.classList.toggle('on', +b.dataset.km === BATTLE_KM));
  document.querySelectorAll('#mSize .btn').forEach((b: any) => b.onclick = () => { setBattleSize(+b.dataset.km); sizes(); });
  sizes();
  const render = () => {
    $('#mResults').innerHTML = places.map((p, i) => `<button class="btn place${chosen === p ? ' on' : ''}" data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.full)}</span></button>`).join('');
    document.querySelectorAll('#mResults .place').forEach((b: any) => b.onclick = () => { chosen = places[+b.dataset.i]; render(); ($('#mImport') as HTMLButtonElement).disabled = false; });
  };
  const search = async () => {
    const q = ($('#mQuery') as HTMLInputElement).value.trim(); if (!q) return;
    menuStatus('Searching'); chosen = null; ($('#mImport') as HTMLButtonElement).disabled = true;
    try { places = await searchPlaces(q); render(); menuStatus(places.length ? `Pick a place. The battle is a ${BATTLE_KM} km circle around it.` : 'No places found. Try a town and country, or a postcode.', !places.length); }
    catch (e: any) { menuStatus(e.message || 'Search failed', true); }
  };
  $('#mSearch').onclick = search;
  ($('#mQuery') as HTMLInputElement).addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  const busy = (v: boolean) => document.querySelectorAll('#menu .mapbtn').forEach((b: any) => b.disabled = v || (b.id === 'mImport' && !chosen));
  $('#mImport').onclick = async () => {
    if (!chosen) return; useMission(null); busy(true); const spec: MapSpec = { kind: 'osm', place: chosen, km: BATTLE_KM };
    showLoading('GETTING THE MAP');
    try { const raw = await loadSpec(spec, s => { menuStatus(s); showLoading(s.toUpperCase()); }); menuStatus('Ready'); start(raw, spec); }
    catch (e: any) { showLoading(null); menuStatus(e.message || 'Import failed', true); }
    finally { busy(false); }
  };
  $('#mSample').onclick = () => { useMission(null); const spec: MapSpec = { kind: 'sample', seed: 1000 + Math.floor(Math.random() * 9000), km: BATTLE_KM }; start(sampleTown(spec.seed), spec); };

  // Campaign: fixed sample towns at 1 km, one after another.
  const KIT_NAME: Record<string, string> = { mortar: 'mortars', sandbag: 'sandbags', smoke: 'smoke', engineers: 'engineers', fob: 'FOBs', wall: 'walls', demo: 'charges', tank: 'tanks', at: 'AT guns', tanktrap: 'tank traps', sniper: 'snipers', op: 'obs posts', spy: 'spy planes', medics: 'medics', assault: 'assault', garrison: 'garrisons', barrage: 'artillery', air: 'air strikes', para: 'paradrops' };
  const mission = (i: number) => { useMission(i); setBattleSize(1); sizes(); S.nTeams = 2; teams(); const m = MISSIONS[i], spec: MapSpec = { kind: 'sample', seed: m.seed, km: 1 }; start(sampleTown(m.seed), spec); };
  const camp = () => {
    const p = progress();
    $('#mCampaign').innerHTML = MISSIONS.map((m, i) => `<button class="btn${i < p ? ' done' : ''}" data-i="${i}"${i > p ? ' disabled' : ''} title="${m.brief}${m.adds.length ? ' New: ' + m.adds.map(a => KIT_NAME[a] || a).join(', ') + '.' : ''}"><span>${i + 1}. ${m.name}</span><em>${i < p ? 'WON' : i === p ? 'NEXT' : 'LOCKED'}</em></button>`).join('');
    document.querySelectorAll('#mCampaign .btn').forEach((b: any) => b.onclick = () => mission(+b.dataset.i));
  };
  camp();
  window.addEventListener('fo-mission', (e: any) => { if (e.detail < MISSIONS.length) mission(e.detail); });
  window.addEventListener('fo-campaign', camp);
  document.querySelectorAll('#mSideRow .btn').forEach((b: any) => b.onclick = () => { S.coop = b.dataset.side === 'with'; document.querySelectorAll('#mSideRow .btn').forEach((x: any) => x.classList.toggle('on', x === b)); });
  // Screens: home, then campaign, skirmish, multiplayer or settings. The map chooser is one block that
  // moves to the screen that needs it (skirmish, or multiplayer once you host).
  const pick = $('#mapPick');
  const show = (name: string) => {
    document.querySelectorAll('.mscreen').forEach((e: any) => e.hidden = e.dataset.s !== name); $('#mBack').hidden = name === 'home';
    if (name !== 'multi' && NET.mode !== 'solo') { closeNet(); S.coop = false; }
    if (name === 'skirmish') { useMission(null); $('#mapSlotSkirmish').appendChild(pick); pick.hidden = false; }
    else pick.hidden = true;
    if (name === 'multi') { $('#mSideRow').hidden = true; for (const id of ['#mHost', '#mOr', '#mCode', '#mJoin']) $(id).hidden = false; netStatus('Host a game and send the code to your friend, or type their code and join.'); $('#mNet').style.color = ''; }
    if (name === 'campaign') camp();
    if (name === 'settings') settings();
  };
  document.querySelectorAll('.mbig').forEach((b: any) => b.onclick = () => show(b.dataset.go));
  $('#mBack').onclick = () => show('home');
  window.addEventListener('fo-menu', () => show('home'));
  // Multiplayer. The host picks the map; the guest gets the same map.
  $('#mHost').onclick = () => {
    useMission(null); host({ status: netStatus, joined: () => { S.guestOn = true; onJoined(); }, left: onLeft }); $('#mNet').style.color = 'var(--gold)';
    for (const id of ['#mHost', '#mOr', '#mCode', '#mJoin']) $(id).hidden = true; $('#mSideRow').hidden = false; $('#mapSlotMulti').appendChild(pick); pick.hidden = false;
  };
  $('#mJoin').onclick = () => {
    const c = ($('#mCode') as HTMLInputElement).value.trim(); if (c.length < 5) { netStatus('Type the 5-letter code from your friend.'); return; }
    join(c, {
      status: netStatus, left: onLeft,
      map: async (spec: MapSpec) => { showLoading('LOADING THE MAP'); try { guestMap(await loadSpec(spec, t => showLoading(t.toUpperCase()))); } catch (e: any) { netStatus(e.message || 'Map failed to load'); } showLoading(null); },
    });
    $('#mHost').hidden = true; $('#mOr').hidden = true;
  };
  // Settings: kept in this browser.
  const settings = () => {
    $('#sSound').textContent = isMuted() ? 'OFF' : 'ON'; $('#sSound').classList.toggle('on', !isMuted());
    $('#sShadow').textContent = shadowsOn() ? 'ON' : 'OFF'; $('#sShadow').classList.toggle('on', shadowsOn());
    $('#sNote').textContent = `Campaign: ${progress()} of ${MISSIONS.length} missions won.`;
  };
  $('#sSound').onclick = () => { toggleMute(); settings(); const b = document.getElementById('vSound'); if (b) b.classList.toggle('on', !isMuted()); };
  $('#sShadow').onclick = () => { setShadows(!shadowsOn()); settings(); };
  let resetArmed = 0;
  $('#sReset').onclick = () => { if (performance.now() - resetArmed > 4000) { resetArmed = performance.now(); $('#sNote').textContent = 'Press RESET again to clear your campaign progress.'; return; } try { localStorage.removeItem('fo-campaign'); } catch { } resetArmed = 0; settings(); };
}
// The loading screen: a line of text, or null to hide it.
export function showLoading(text: string | null) { const b = $('#busy'); if (text == null) { b.hidden = true; return; } $('#busyText').textContent = text; b.hidden = false; }
export function showMenu(v: boolean) { $('#menu').hidden = !v; $('#game').classList.toggle('inmenu', v); if (v) window.dispatchEvent(new Event('fo-menu')); }
export const isGuest = () => NET.mode === 'guest';
