import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Nest resolves constructor dependencies from decorator metadata, which
 * esbuild (Vitest's default transform) does not emit. SWC does, so tests
 * compile the same way `tsc` does for the real build.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup/mongo-memory-server.ts'],
    setupFiles: ['test/setup/environment.ts'],
    // Repository and API tests each open their own database; a generous
    // timeout covers the first run, when the MongoDB binary is downloaded.
    hookTimeout: 120_000,
  },
});
