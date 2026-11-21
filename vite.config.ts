import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  // Preview hosts (sandbox / LAN) are not localhost — accept them explicitly.
  server: { host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
