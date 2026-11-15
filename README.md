# First Orders

A WW2-era battle game in your own town, in the browser. Import any place from OpenStreetMap,
plan on your own ground, give orders, and watch each phase play out. Fog of war, AI that plans
every phase, terrain that decides what works, and a full replay at the end.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/, works from any folder or static host
```

## Layout

- `src/config.ts` rules, costs, unit stats, tools
- `src/map/` map sources: `procgen.ts` (sample town), `osm.ts` (OpenStreetMap + elevation import), `finish.ts` (shared map build), `cache.ts` (imported towns kept in IndexedDB)
- `src/sim.ts` battle simulation, fog of war, ground capture; `src/ai.ts` phase planner; `src/plan.ts` placement rules
- `src/render/` three.js scene, camera, 2D overlay; `src/ui/` HUD, input, start menu
- `src/replay.ts` replay playback and the live view

Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles. Fonts: Kenney Mini Square Mono (CC0), Departure Mono (OFL).
