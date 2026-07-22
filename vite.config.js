import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  root: resolve(__dirname, 'src/frontend'),
  build: {
    outDir: resolve(__dirname, 'dist/frontend'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
