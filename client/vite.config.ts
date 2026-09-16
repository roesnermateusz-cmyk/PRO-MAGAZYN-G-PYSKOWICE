import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
