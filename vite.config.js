import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                 // works on Vercel root and on any sub-path
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  assetsInclude: ['**/*.glb'],
});
