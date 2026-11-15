import { S, NET } from '../state';
import { setBattleSize, BATTLE_KM } from '../config';
import { searchPlaces, importPlace, type Place } from '../map/osm';
import { sampleTown } from '../map/procgen';
import { host, join, closeNet } from '../net';
import type { RawMap } from '../map/types';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export type MapSpec = ({ kind: 'sample'; seed: number } | { kind: 'osm'; place: Place }) & { km: number };

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
    if (!chosen) return; busy(true); const spec: MapSpec = { kind: 'osm', place: chosen, km: BATTLE_KM };
    try { const raw = await loadSpec(spec, s => menuStatus(s)); menuStatus('Ready'); start(raw, spec); }
    catch (e: any) { menuStatus(e.message || 'Import failed', true); }
    finally { busy(false); }
  };
  $('#mSample').onclick = () => { const spec: MapSpec = { kind: 'sample', seed: 1000 + Math.floor(Math.random() * 9000), km: BATTLE_KM }; start(sampleTown(spec.seed), spec); };

  // Play a friend. The host picks the map; the guest gets the same map and plays the second team.
  $('#mHost').onclick = () => { host({ status: netStatus, joined: onJoined, left: onLeft }); $('#mNet').style.color = 'var(--gold)'; document.querySelectorAll('.guestonly').forEach((e: any) => e.hidden = true); };
  $('#mJoin').onclick = () => {
    const c = ($('#mCode') as HTMLInputElement).value.trim(); if (c.length < 5) { netStatus('Type the 5-letter code from your friend.'); return; }
    join(c, {
      status: netStatus, left: onLeft,
      map: async (spec: MapSpec) => { netStatus('Loading the map'); try { guestMap(await loadSpec(spec, netStatus)); } catch (e: any) { netStatus(e.message || 'Map failed to load'); } },
    });
    document.querySelectorAll('.hostonly').forEach((e: any) => e.hidden = true);
  };
  $('#mSolo').onclick = () => { closeNet(); netStatus('Playing against the AI.'); document.querySelectorAll('.hostonly,.guestonly').forEach((e: any) => e.hidden = false); };
}
export function showMenu(v: boolean) { $('#menu').hidden = !v; }
export const isGuest = () => NET.mode === 'guest';
