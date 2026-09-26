import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The browser always talks to `/api` on its own origin. Locally this proxy
 * forwards it to the API on :4000; in production a Render rewrite does the
 * same. One origin is what lets the session cookie be first-party and
 * httpOnly, with no CORS anywhere.
 */
const API_TARGET = process.env.CRED_STATS_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
    // pdf.js and recharts are the two large dependencies; both load lazily.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: false,
  },
});
