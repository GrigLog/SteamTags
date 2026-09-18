import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative base so the build works under any GitHub Pages project path.
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 600 },
  test: { include: ['tests/**/*.test.ts'] },
});
