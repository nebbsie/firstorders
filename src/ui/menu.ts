import { S } from '../state';
import { searchPlaces, importPlace, type Place } from '../map/osm';
import type { RawMap } from '../map/types';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The start screen: pick a real place or the sample town, pick the number of teams.
export function initMenu(start: (raw: RawMap) => void, sample: () => RawMap) {
  let places: Place[] = [], chosen: Place | null = null;
  const status = (s: string, bad?: boolean) => { const el = $('#mStatus'); el.textContent = s; el.style.color = bad ? 'var(--bad)' : 'var(--soft)'; };
  const teams = () => { document.querySelectorAll('#mTeams .btn').forEach((b: any) => b.classList.toggle('on', +b.dataset.n === S.nTeams)); };
  document.querySelectorAll('#mTeams .btn').forEach((b: any) => b.onclick = () => { S.nTeams = +b.dataset.n; teams(); });
  teams();
  const render = () => {
    $('#mResults').innerHTML = places.map((p, i) => `<button class="btn place${chosen === p ? ' on' : ''}" data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.full)}</span></button>`).join('');
    document.querySelectorAll('#mResults .place').forEach((b: any) => b.onclick = () => { chosen = places[+b.dataset.i]; render(); ($('#mImport') as HTMLButtonElement).disabled = false; });
  };
  const search = async () => {
    const q = ($('#mQuery') as HTMLInputElement).value.trim(); if (!q) return;
    status('Searching'); chosen = null; ($('#mImport') as HTMLButtonElement).disabled = true;
    try { places = await searchPlaces(q); render(); status(places.length ? 'Pick a place. The map is 1.0 x 0.65 km around it.' : 'No places found. Try a town and country, or a postcode.', !places.length); }
    catch (e: any) { status(e.message || 'Search failed', true); }
  };
  $('#mSearch').onclick = search;
  ($('#mQuery') as HTMLInputElement).addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  $('#mImport').onclick = async () => {
    if (!chosen) return; const btns = document.querySelectorAll('#menu button'); btns.forEach((b: any) => b.disabled = true);
    try { const raw = await importPlace(chosen, s => status(s)); status('Ready'); start(raw); }
    catch (e: any) { status(e.message || 'Import failed', true); }
    finally { btns.forEach((b: any) => b.disabled = false); }
  };
  $('#mSample').onclick = () => start(sample());
}
export function showMenu(v: boolean) { $('#menu').hidden = !v; }
