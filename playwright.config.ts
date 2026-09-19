import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests, kept separate from the vitest suites.
 *
 *   npm run test:e2e
 *
 * These exist for one reason: the browser half of the parse pipeline cannot be
 * tested any other way. The parser suites run on committed fixtures and prove
 * the parsing; they say nothing about whether pdf.js loads its worker,
 * decrypts a real file, or whether the upload dialog wires any of it together.
 * That is the half a user actually touches.
 *
 * They need the real PDFs in `samples/`, which is gitignored, and a running
 * app. Both are checked for and skipped with a clear message when absent, so
 * this never fails on a clone that does not have them.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Both specs want a known database: the chart tests need the sample
  // statements present, the upload tests need them absent. Seeding once up
  // front means neither depends on what the other left behind.
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'junit-e2e.xml' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // The Chrome already on the machine, rather than a 100MB+ download that
      // would have to be provisioned on every runner.
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
