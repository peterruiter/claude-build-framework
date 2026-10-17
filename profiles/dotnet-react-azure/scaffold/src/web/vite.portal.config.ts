import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The second app, for a different audience (customers, attendees, the public), at /portal/. Its own
// entry point and bundle, sharing src/ (strings, plural rules, theme, tokens). Delete this file, the
// portal folder and the "vite build --config" step in package.json if one app is enough.
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'portal'),
  base: '/portal/',
  publicDir: false,
  build: {
    outDir: resolve(__dirname, '../App.Api/wwwroot/portal'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(__dirname, 'portal/index.html') } }
  },
  server: {
    port: 5174,
    fs: { allow: [resolve(__dirname, '..'), resolve(__dirname, '../../build')] },
    proxy: { '/api': 'http://127.0.0.1:5080' }
  }
});
