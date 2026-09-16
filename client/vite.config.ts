import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { version } = require('./package.json') as { version: string };

export default defineConfig({
  plugins: [react()],
  // Numer wersji wstrzykiwany przy budowaniu - jedno zrodlo prawdy (package.json).
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // W trybie deweloperskim zapytania /api trafiaja do serwera Express.
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          // Biblioteki zmieniaja sie rzadko - osobny chunk poprawia cache.
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
