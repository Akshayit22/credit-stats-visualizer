import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/**
 * The single-service deployment: the API also serves the built web app from
 * CRED_STATS_WEB_DIR, on the same origin.
 */
let testApp: TestApp;
let webDir: string;

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'cred-stats-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(webDir, 'favicon.svg'), '<svg/>');

  process.env.CRED_STATS_WEB_DIR = webDir;
  testApp = await createTestApp();
});

afterAll(async () => {
  await testApp.close();
  delete process.env.CRED_STATS_WEB_DIR;
  rmSync(webDir, { recursive: true, force: true });
});

describe('serving the web app', () => {
  it('answers a client-side route with index.html, never cached', async () => {
    const response = await testApp.http
      .get('/accounts/axis-bank-credit-card-9581?period=2026-06')
      .set('accept', 'text/html')
      .expect(200);
    expect(response.text).toContain('<div id="root">');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets with a year-long cache', async () => {
    const response = await testApp.http.get('/assets/index-abc123.js').expect(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('leaves the API alone', async () => {
    const health = await testApp.http.get('/api/health').set('accept', 'text/html').expect(200);
    expect(health.body.data.status).toBe('ok');

    const missing = await testApp.http.get('/api/nowhere').set('accept', 'text/html').expect(404);
    expect(missing.body.error.code).toBe('not_found');
  });
});

describe('security headers', () => {
  it('allow Sign in with Google and nothing else from elsewhere', async () => {
    const response = await testApp.http.get('/overview').set('accept', 'text/html');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('script-src');
    expect(csp).toContain('https://accounts.google.com/gsi/client');
    expect(csp).toContain('frame-ancestors');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
