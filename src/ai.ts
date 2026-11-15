import { C, GW, GH, IW, IH, T_WOOD, T_ROAD, T_GROUND, PLATOONS, MOVERS, clamp, clampPlay, inPlay, segDist } from './config';
import { S, M, OWN } from './state';
import { cellOf, passable, nudge, ownerAt, canDeploy, cellPos, bldNear, waterBetween, bridgeTouches } from './world';
import { left, addSquad, addStruct, addSupport, aliveMembers, sqCenter } from './plan';

function frontierCells(team: number) {
  const out: number[] = [];
  for (let i = 0; i < OWN.length; i++) {
    if (OWN[i] !== team) continue; const x = i % IW, y = (i / IW) | 0;
    if ((x > 0 && OWN[i - 1] !== team) || (x < IW - 1 && OWN[i + 1] !== team) || (y > 0 && OWN[i - IW] !== team) || (y < IH - 1 && OWN[i + IW] !== team)) out.push(i);
  }
  return out;
}
// Enemy units this team has seen, where it last saw them. Under fog the AI knows no more than a player would.
export function knownFoes(team: number) {
  const out: any[] = [];
  const k: Map<number, any> = S.known[team]; if (!k) return out;
  for (const e of k.values()) if (S.t - e.t < 150) out.push(e);
  return out;
}

// Every team, the player's AI PLAN too, plans each phase from what it knows:
// its own ground, the terrain, and the enemy units it has seen.
export function aiPlan(team: number) {
  const T = S.teams[team], pr = T.per, r = T.rng; if (T.lost || left(team) < 60) return;
  // New units arrive in the start area (mortars, MGs and posts may also go near engineers):
  // when the wanted spot is not allowed, use the edge of the start area on the way to it.
  const place = (kind: string, x: number, y: number) => addSquad(team, kind, x, y) || (() => { const z = T.zone, ddx = x - z.x, ddy = y - z.y, k = Math.min(1, z.r * .75 / (Math.hypot(ddx, ddy) || 1)); let s = addSquad(team, kind, z.x + ddx * k, z.y + ddy * k); for (let i = 0; i < 16 && !s; i++) { const a = r() * 6.283, d = r() * z.r * .85; s = addSquad(team, kind, z.x + Math.cos(a) * d, z.y + Math.sin(a) * d); } return s; })();
  const own: number[] = []; for (let i = 0; i < OWN.length; i++) if (OWN[i] === team) own.push(i); if (!own.length) return;
  let ox = 0, oy = 0; for (const c of own) { const p = cellPos(c); ox += p[0]; oy += p[1]; } ox /= own.length; oy /= own.length;
  const foes = knownFoes(team);
  const foesNear = (x: number, y: number, R: number) => { let n = 0; for (const e of foes) if (Math.abs(e.x - x) < R && Math.abs(e.y - y) < R && Math.hypot(e.x - x, e.y - y) < R) n++; return n; };
  let th: any = null;
  if (foes.length) { let bd = 1e18; for (const e of foes) { const d = (e.x - ox) ** 2 + (e.y - oy) ** 2; if (d < bd) { bd = d; th = { x: e.x, y: e.y }; } } }
  else { let bd = 1e18; for (const t of S.teams) { if (t.id === team) continue; const d = (t.zone.x - ox) ** 2 + (t.zone.y - oy) ** 2; if (d < bd) { bd = d; th = { x: t.zone.x, y: t.zone.y, zone: t.zone }; } } }
  let dx = th.x - ox, dy = th.y - oy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; const px = -dy, py = dx;

  // Defensive anchor: high, near cover, facing the threat, not under enemy guns.
  let D: any = null, bs = -1e9; const fr = frontierCells(team);
  for (let k = 0; k < 70 && fr.length; k++) {
    const p = cellPos(fr[Math.floor(r() * fr.length)]); if ((p[0] - ox) * dx + (p[1] - oy) * dy < -4) continue;
    const q = { x: p[0] - dx * 7, y: p[1] - dy * 7 }; if (!canDeploy(team, q.x, q.y) || !passable(cellOf(q.x, q.y))) continue;
    const s = M.hAt(q.x, q.y) * .6 + bldNear(q.x, q.y) * .2 - Math.abs(Math.hypot(q.x - th.x, q.y - th.y) - 70) * .03 - foesNear(q.x, q.y, 30) * .5 + r() * 1.5;
    if (s > bs) { bs = s; D = q; }
  }
  if (!D) { const q = nudge(ox, oy, (x, y) => canDeploy(team, x, y)); if (!q) return; D = { x: q[0], y: q[1] }; }
  // Infantry first: keep supply back for the platoons this side still needs, so guns and earthworks never crowd them out.
  const infNow = S.squads.filter((s: any) => s.team === team && (s.kind === 'rifles' || s.kind === 'assault') && (!s.members || aliveMembers(s).length > 0)).length;
  const infReserve = Math.max(0, 3 + Math.floor(S.round / 2) - infNow) * 100;
  const B0 = left(team); let supReserve = B0 * pr.arty * .2 + infReserve;
  const dig = (type: string, a: any, b: any) => left(team) - supReserve >= 60 ? addStruct(team, type, a, b) : null;
  const urban = bldNear(D.x, D.y) >= 12, foeTanks = foes.filter(e => e.kind === 'tank').length;
  const alive = (s: any) => !s.members || aliveMembers(s).length > 0;
  const count = (kind: string) => S.squads.filter((s: any) => s.team === team && s.kind === kind && alive(s)).length;
  const haveNear = (kind: string, R: number) => S.squads.some((s: any) => s.team === team && s.kind === kind && alive(s) && (() => { const c = sqCenter(s); return c && Math.hypot(c[0] - D.x, c[1] - D.y) < R; })());

  // Little intel: send a spy plane over the enemy first.
  if (foes.length < 6 && left(team) - supReserve >= 100 && r() < .75) {
    const tx = th.zone ? th.zone.x : th.x, ty = th.zone ? th.zone.y : th.y;
    addSupport(team, 'spy', clampPlay(tx + px * 70, ty + py * 70), clampPlay(tx - px * 70, ty - py * 70), 5);
  }
  if (urban) { // in town, hold the tallest buildings instead of digging in
    const ids = new Set<number>(), c0 = Math.floor(D.x / C), r0 = Math.floor(D.y / C);
    for (let yy = -10; yy <= 10; yy++) for (let xx = -10; xx <= 10; xx++) { const cx = c0 + xx, cy = r0 + yy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue; const id = M.bldId[cy * GW + cx]; if (id >= 0) ids.add(id); }
    // At most two garrisons in all: troops in houses do not win battles.
    const cand = [...ids].map(id => M.B[id]).sort((a, b) => b.top - a.top); let g = count('garrison');
    for (const b of cand) { if (g >= (pr.aggr < .5 ? 2 : 1) || S.round > 3 || left(team) - supReserve < 110) break; if (addSquad(team, 'garrison', b.cx, b.cy)) g++; }
  } else if (!S.structs.some((s: any) => s.team === team && s.type === 'trench' && segDist(D, s.a, s.b) < 14)) {
    const L = clamp(B0 * (.5 - pr.aggr * .3) / 5 / 1.3, 8, 26); dig('trench', { x: D.x - px * L, y: D.y - py * L }, { x: D.x + px * L, y: D.y + py * L });
  }
  if (!urban && pr.aggr < .7 && left(team) - supReserve > 200) { const c = { x: D.x + dx * 7, y: D.y + dy * 7 }; dig('wire', { x: c.x - px * 14, y: c.y - py * 14 }, { x: c.x + px * 14, y: c.y + py * 14 }); }
  if (!haveNear('mg', 25) && count('mg') < 2 && left(team) - supReserve >= 80) {
    let mx = D.x - dx * 3, my = D.y - dy * 3;
    for (let k = 0; k < 30; k++) { const x = D.x + (r() - .5) * 30, y = D.y + (r() - .5) * 30, ci = cellOf(x, y); if (ci >= 0 && M.terr[ci] === T_WOOD && canDeploy(team, x, y)) { mx = x; my = y; break; } }
    place('mg', mx, my);
  }
  // Tanks can come over open ground and roads: answer with AT guns and tank traps.
  let roadToUs = 0; for (let k = 1; k <= 12; k++) { const ci = cellOf(D.x + dx * k * 5, D.y + dy * k * 5); if (ci >= 0 && (M.terr[ci] === T_ROAD || M.terr[ci] === T_GROUND)) roadToUs++; }
  if ((foeTanks > 0 || roadToUs >= 9) && !haveNear('at', 30)) for (let a = 0; a < (foeTanks > 1 ? 2 : 1) && left(team) - supReserve >= 90; a++) place('at', D.x + px * (a ? 12 : -12) - dx * 2, D.y + py * (a ? 12 : -12) - dy * 2);
  if ((foeTanks > 0 || urban) && left(team) - supReserve >= 80) {
    let rx: any = null; for (let k = 0; k < 40; k++) { const x = D.x + (r() - .5) * 36, y = D.y + (r() - .5) * 36, ci = cellOf(x, y); if (ci >= 0 && M.terr[ci] === T_ROAD && canDeploy(team, x, y)) { rx = { x, y }; break; } }
    if (rx) dig('tanktrap', { x: rx.x - px * 7, y: rx.y - py * 7 }, { x: rx.x + px * 7, y: rx.y + py * 7 });
  }
  // Engineers up to the front, then a FOB where they stand, so heavy weapons can come up behind the line.
  const engs = S.squads.filter((s: any) => s.team === team && s.kind === 'engineers' && alive(s));
  if (!engs.length && S.round >= 2 && left(team) - supReserve >= 120) { const e = place('engineers', D.x, D.y); if (e) e.order = { type: 'defend', x: D.x, y: D.y }; }
  if (!S.squads.some((s: any) => s.team === team && s.kind === 'fob' && alive(s)) && left(team) >= 150) for (const e of engs) { const c = e.members && sqCenter(e); if (c && addSquad(team, 'fob', c[0], c[1])) break; }
  const mortars = S.squads.filter((s: any) => s.team === team && s.kind === 'mortar' && alive(s)).length;
  for (let m = mortars; m < (S.round < 3 ? 1 : 1 + Math.round(pr.arty * 2)) && left(team) - supReserve >= 90; m++) place('mortar', D.x - dx * (22 + r() * 14) + px * (r() - .5) * 24, D.y - dy * (22 + r() * 14) + py * (r() - .5) * 24);
  // High ground in our area: an observation post.
  if (!S.squads.some((s: any) => s.team === team && s.kind === 'op' && alive(s)) && left(team) - supReserve >= 70) {
    let best: number[] = null, bh = M.hAt(D.x, D.y) + 1.5;
    for (let k = 0; k < 60; k++) { const p = cellPos(own[Math.floor(r() * own.length)]), h = M.hAt(p[0], p[1]); if (h > bh && passable(cellOf(p[0], p[1]))) { bh = h; best = p; } }
    if (best) place('op', best[0], best[1]);
  }
  // A cautious side cuts the bridges that lead to it across water.
  if (pr.aggr < .5 && waterBetween(D.x, D.y, th.x, th.y)) M.bridges.forEach((br, i) => {
    if (br.blown != null || S.supports.some((s: any) => s.type === 'demo' && s.bridge === i) || left(team) - supReserve < 80) return;
    // Engineers go to our end of the bridge and blow it.
    const end = br.ends.find(c => ownerAt((c % GW) * C + 1, Math.floor(c / GW) * C + 1) === team);
    if (end != null && !S.squads.some((s: any) => s.team === team && s.kind === 'engineers' && s.order && s.order.bridge === i) && left(team) - supReserve >= 120) {
      const ex = (end % GW) * C + 1, ey = Math.floor(end / GW) * C + 1, e = place('engineers', D.x, D.y); if (e) e.order = { type: 'demolish', x: ex, y: ey, bridge: i };
    }
  });

  // Attack objective: ground not ours, lightly held, ideally high and unclaimed.
  let A: any = null, as = -1e9; const ang0 = Math.atan2(dy, dx);
  for (let k = 0; k < 50; k++) {
    const a = ang0 + (r() - .5) * 2.2, d = 30 + r() * 90, x = D.x + Math.cos(a) * d, y = D.y + Math.sin(a) * d;
    if (!inPlay(x, y, 6)) continue; const ci = cellOf(x, y); if (!passable(ci)) continue; const o = ownerAt(x, y); if (o === team) continue;
    const s = (o < 0 ? 3 : 1.5) - foesNear(x, y, 28) * .35 + M.hAt(x, y) * .15 - d * .015 + r() * 1.2; if (s > as) { as = s; A = { x, y }; }
  }
  // The goal is the enemy HQ. Once one is found, attack it more and more often as the battle goes on.
  const hqs = S.teams.filter((o: any) => o.id !== team && !o.lost && S.hqKnown[team].has(o.id)).sort((a: any, b: any) => Math.hypot(a.zone.x - D.x, a.zone.y - D.y) - Math.hypot(b.zone.x - D.x, b.zone.y - D.y));
  if (hqs.length && r() < .35 + pr.aggr * .4 + (S.round - 1) * .12) A = { x: hqs[0].zone.x, y: hqs[0].zone.y };
  // No HQ found yet: from phase 3, push towards where the enemy came from, to find it.
  else if (!hqs.length && th.zone && S.round >= 3 && r() < .3 + S.round * .12) A = { x: th.zone.x, y: th.zone.y };
  // The last phases: everything goes for the nearest enemy HQ (or where the enemy came from), to force a result.
  const allIn = S.round >= 5 || (S.goal === 'hold' && S.round >= 2); if (allIn) { const t = hqs[0] || S.teams.filter((o: any) => o.id !== team && !o.lost).sort((a: any, b: any) => Math.hypot(a.zone.x - ox, a.zone.y - oy) - Math.hypot(b.zone.x - ox, b.zone.y - oy))[0]; if (t) A = { x: t.zone.x, y: t.zone.y }; }
  // Attackers move carefully in town and rush across open ground when bold; all pull back if badly hurt.
  const go = (s: any, tx: number, ty: number) => { const q = nudge(tx, ty); if (!q) return; s.order = { type: 'attack', x: q[0], y: q[1] }; s.fallback = true;
    s.stance = s.kind === 'tank' ? undefined : foesNear(tx, ty, 40) > 2 && bldNear(tx, ty) >= 8 ? 'careful' : pr.aggr > .7 && r() < .5 ? 'rush' : undefined;
    // Smoke to cover a long advance over open ground.
    if (S.round >= 1 && left(team) >= 90 && r() < .35 && bldNear((D.x + tx) / 2, (D.y + ty) / 2) < 6) addSupport(team, 'smoke', { x: (D.x + tx) / 2 + (tx - D.x) * .2, y: (D.y + ty) / 2 + (ty - D.y) * .2 }, null, 6); };
  // Always keep a guard on our own HQ.
  const hq = T.zone, guarded = S.squads.some((s: any) => s.team === team && alive(s) && (PLATOONS.includes(s.kind) || s.kind === 'garrison') && (() => { const c = s.order && s.order.type === 'defend' ? [s.order.x, s.order.y] : sqCenter(s); return c && Math.hypot(c[0] - hq.x, c[1] - hq.y) < 14 && !(s.order && s.order.type === 'attack'); })());
  if (!guarded && left(team) >= 100) { const g = place('rifles', hq.x, hq.y); if (g) { g.order = { type: 'defend', x: hq.x, y: hq.y }; g.guard = true; } }
  let side = 0;
  if (A) for (const s of S.squads) {
    if (s.team !== team || !s.members || !MOVERS.includes(s.kind) || s.state === 'demolish') continue;
    const m = aliveMembers(s); if (!m.length) continue; const c = sqCenter(s);
    if (m.length < s.members.length * .35) { if (Math.hypot(c[0] - D.x, c[1] - D.y) > 15) s.order = { type: 'defend', x: D.x, y: D.y }; continue; }
    // As the battle goes on, fewer units stay back. The HQ guard never leaves.
    if (s.guard || s.kind === 'engineers') continue;
    if ((PLATOONS.includes(s.kind) || s.kind === 'tank') && s.kind !== 'medics' && (allIn || r() < pr.aggr + S.round * .1)) { side++; go(s, A.x + px * (side % 2 ? 1 : -1) * side * 5, A.y + py * (side % 2 ? 1 : -1) * side * 5); }
  }
  // Open ground to the objective suits tanks.
  if (A && pr.aggr >= .45 && left(team) - supReserve >= 220) {
    let open = 0; for (let k = 1; k <= 10; k++) if (bldNear(D.x + (A.x - D.x) * k / 10, D.y + (A.y - D.y) * k / 10) < 6) open++;
    if (open >= 6) { const nT = pr.aggr > .7 && left(team) - supReserve >= 440 ? 2 : 1; for (let k = 0; k < nT; k++) { const s = place('tank', D.x - dx * 8 + px * (k ? 8 : -8), D.y - dy * 8 + py * (k ? 8 : -8)); if (s) go(s, A.x + px * (k ? 8 : -8), A.y + py * (k ? 8 : -8)); } }
  }
  supReserve -= infReserve; let n = 0;
  while (left(team) - supReserve >= 100 && n < 4) {
    // Assault platoons for fights in town; rifles elsewhere.
    const kind = A && bldNear(A.x, A.y) >= 8 && r() < .6 && left(team) - supReserve >= 130 ? 'assault' : 'rifles';
    const s = place(kind, D.x - dx * 10 + px * (r() - .5) * 30, D.y - dy * 10 + py * (r() - .5) * 30); if (!s) break; n++;
    if (A && r() < .55 + pr.aggr * .4) { side++; go(s, A.x + px * (side % 2 ? 1 : -1) * side * 5, A.y + py * (side % 2 ? 1 : -1) * side * 5); } else s.order = { type: 'defend', x: D.x, y: D.y };
  }
  // Support, timed to land just before the assault arrives.
  const tA = A ? clamp(Math.hypot(A.x - D.x, A.y - D.y) / 5.5 - 4, 5, 50) : 10;
  if (left(team) >= 120) {
    let tgt: any = null, bc = 0;
    for (const e of foes) { if (A && Math.hypot(e.x - A.x, e.y - A.y) > 45 && Math.hypot(e.x - D.x, e.y - D.y) > 70) continue; const c = foesNear(e.x, e.y, 12); if (c > bc) { bc = c; tgt = { x: e.x, y: e.y }; } }
    if (!tgt && !foes.length && pr.arty > .5 && th.zone) tgt = { x: th.zone.x - dx * th.zone.r * .55, y: th.zone.y - dy * th.zone.r * .55 };
    if (tgt) addSupport(team, 'barrage', tgt, null, Math.round((A ? tA : 8) / 5) * 5 || 5);
  }
  if (left(team) >= 250 && pr.aggr > .45 && foes.length) {
    let tgt: any = null, bc = 0; for (const e of foes) { const c = foesNear(e.x, e.y, 15); if (c > bc) { bc = c; tgt = e; } }
    if (tgt && bc >= 8) addSupport(team, 'air', { x: tgt.x + px * 40, y: tgt.y + py * 40 }, { x: tgt.x - px * 40, y: tgt.y - py * 40 }, Math.round(tA / 5) * 5 || 10);
  }
  if (left(team) >= 200 && pr.aggr > .65 && A && S.round > 1 && r() < .5) addSupport(team, 'para', clampPlay(A.x + dx * 18, A.y + dy * 18, 8), null, Math.round(tA / 5) * 5 || 10);
  if (n >= 2 && left(team) >= 90 && r() < .4) { const m = place('medics', D.x - dx * 12, D.y - dy * 12); if (m) m.order = { type: 'defend', x: D.x - dx * 6, y: D.y - dy * 6 }; }
  // Spend what is left on more platoons: supply in the bank wins nothing. Most of them go forward.
  while (left(team) >= 100 && n < 10) { const s = place('rifles', D.x - dx * 14 + px * (r() - .5) * 30, D.y - dy * 14 + py * (r() - .5) * 30); if (!s) break; n++; if (A && r() < .5 + pr.aggr * .4) { side++; go(s, A.x + px * (side % 2 ? 1 : -1) * side * 5, A.y + py * (side % 2 ? 1 : -1) * side * 5); } else s.order = { type: 'defend', x: D.x + px * (r() - .5) * 20, y: D.y + py * (r() - .5) * 20 }; }
}
