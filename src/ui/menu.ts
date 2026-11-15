import { S, NET } from '../state';
import { setBattleSize, BATTLE_KM } from '../config';
import { searchPlaces, importPlace, type Place } from '../map/osm';
import { sampleTown } from '../map/procgen';
import { host, join, closeNet } from '../net';
import type { RawMap } from '../map/types';
import { MISSIONS, progress, useMission, unlockedAt } from '../campaign';

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
    try { const raw = await loadSpec(spec, s => menuStatus(s)); menuStatus('Ready'); start(raw, spec); }
    catch (e: any) { menuStatus(e.message || 'Import failed', true); }
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
  // Play a friend. The host picks the map; the guest gets the same map and plays the second team.
  $('#mHost').onclick = () => { useMission(null); host({ status: netStatus, joined: () => { S.guestOn = true; onJoined(); }, left: onLeft }); $('#mNet').style.color = 'var(--gold)'; document.querySelectorAll('.guestonly,.soloonly').forEach((e: any) => e.hidden = true); $('#mSideRow').hidden = false; };
  $('#mJoin').onclick = () => {
    const c = ($('#mCode') as HTMLInputElement).value.trim(); if (c.length < 5) { netStatus('Type the 5-letter code from your friend.'); return; }
    join(c, {
      status: netStatus, left: onLeft,
      map: async (spec: MapSpec) => { netStatus('Loading the map'); try { guestMap(await loadSpec(spec, netStatus)); } catch (e: any) { netStatus(e.message || 'Map failed to load'); } },
    });
    document.querySelectorAll('.hostonly,.soloonly').forEach((e: any) => e.hidden = true);
  };
  $('#mSolo').onclick = () => { closeNet(); S.coop = false; netStatus('Playing against the AI.'); document.querySelectorAll('.hostonly,.guestonly,.soloonly').forEach((e: any) => e.hidden = false); $('#mSideRow').hidden = true; };
}
export function showMenu(v: boolean) { $('#menu').hidden = !v; }
export const isGuest = () => NET.mode === 'guest';
