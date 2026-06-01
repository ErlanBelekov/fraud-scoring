/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the NestJS backend so the browser hits the same origin
    // (no CORS needed). Backend listens on :3000.
    proxy: {
      '/transactions': 'http://localhost:3000',
      '/score': 'http://localhost:3000',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
  },
});
