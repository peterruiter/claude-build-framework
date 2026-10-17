import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The main app, served by the API at /app/. Every asset URL carries that prefix, or the page loads and
// its own JavaScript 404s. The build writes into the API's wwwroot, so one container serves both.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: resolve(__dirname, '../App.Api/wwwroot/app'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900
  },
  server: {
    port: 5173,
    // The string bundles and contracts sit beside this project, not inside it.
    fs: { allow: [resolve(__dirname, '..'), resolve(__dirname, '../../build')] },
    proxy: { '/api': 'http://127.0.0.1:5080', '/health': 'http://127.0.0.1:5080' }
  }
});
