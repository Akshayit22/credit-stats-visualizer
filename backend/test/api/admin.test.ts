import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureText } from '../helpers/fixtures.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/**
 * The admin overview: visible to the hard-coded admin addresses only, and
 * made of counts — never a transaction, an amount or a summary.
 */
let testApp: TestApp;
let alice: TestApp['http'];
let admin: TestApp['http'];

beforeAll(async () => {
  testApp = await createTestApp();

  alice = testApp.newAgent();
  await alice.post('/api/auth/google').send({ credential: 'google-token-alice-0000000000' });
  const text = fixtureText(FIXTURE_NAMES.card);
  await alice
    .post('/api/statements')
    .send({
      text,
      contentHash: createHash('sha256').update(text).digest('hex'),
      meta: { pageCount: 2, fileName: 'card.pdf', extractedAt: new Date().toISOString() },
    })
    .expect(201);

  await testApp
    .newAgent()
    .post('/api/auth/google')
    .send({ credential: 'google-token-bob-00000000000' });

  admin = testApp.newAgent();
  await admin.post('/api/auth/google').send({ credential: 'google-token-admin-000000000' });
});

afterAll(async () => {
  await testApp.close();
});

describe('who is an admin', () => {
  it('is said so by the session, for the hard-coded addresses only', async () => {
    expect((await admin.get('/api/auth/me').expect(200)).body.data.isAdmin).toBe(true);
    expect((await alice.get('/api/auth/me').expect(200)).body.data.isAdmin).toBe(false);
  });

  it('refuses everyone else, including the demo user', async () => {
    const response = await alice.get('/api/admin/overview').expect(403);
    expect(response.body.error.code).toBe('forbidden');

    const demo = testApp.newAgent();
    await demo.post('/api/auth/dev-login').expect(200);
    await demo.get('/api/admin/overview').expect(403);
  });

  it('refuses without a session at all', async () => {
    await testApp.newAgent().get('/api/admin/overview').expect(401);
  });
});

describe('GET /api/admin/overview', () => {
  it('lists every user with their statements per bank', async () => {
    const response = await admin.get('/api/admin/overview').expect(200);
    const overview = response.body.data;

    expect(overview.totals).toMatchObject({ statements: 1, accounts: 1 });
    expect(overview.totals.users).toBeGreaterThanOrEqual(3);

    const row = overview.users.find(
      (user: { email: string }) => user.email === 'alice@example.com',
    );
    expect(row).toMatchObject({
      name: 'Alice',
      statements: 1,
      banks: [{ issuer: 'Axis Bank', accountType: 'credit_card', statements: 1 }],
    });
    expect(row.lastUploadAt).not.toBeNull();

    const bob = overview.users.find((user: { email: string }) => user.email === 'bob@example.com');
    expect(bob).toMatchObject({ statements: 0, banks: [], lastUploadAt: null });
  });

  it('carries counts only — no transaction, amount or summary', async () => {
    const response = await admin.get('/api/admin/overview').expect(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/Minor|transactions|merchant|descriptionRaw|byCategory/);
  });
});
