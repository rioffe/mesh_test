import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works at any path, e.g.
  // https://<user>.github.io/<repo>/ or https://<user>.github.io/
  base: './',
  build: {
    chunkSizeWarningLimit: 1000, // three.js alone is ~700 kB
  },
});
