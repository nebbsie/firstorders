import { defineConfig } from 'vite';
// A relative base lets the build run from any static host or sub-folder (itch.io, Pages).
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 900 } });
