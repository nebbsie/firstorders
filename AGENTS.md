# First Orders

- Browser game: TypeScript, three.js, Vite. Keep simulation rules out of the renderer and the HUD.
- UI follows Mall Architect's terminal style: square corners, dark navy panels, Kenney Mini Square Mono for titles and buttons, Departure Mono for text, buttons coloured by role. No icon-only buttons; explanations go in tooltips or Help.
- The visual references the owner shared are inspiration only. Do not copy another game's look, names or content.
- Soldiers are dots. Keep units as plain data with shared update and draw code; no object per soldier.
- Fixed simulation ticks. Fog of war applies to the AI as well as the player.
- The game must stay simple to start: menu, pick a place or the sample town, play.
- No automated test framework yet. Build (`npm run build`) and play the change in a browser before handing over. Report honestly what was and was not checked.
- Write code comments in ASD-STE100 Simplified Technical English.
