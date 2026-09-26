import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USER_ID, userIdFromSubject } from '../../src/auth/user-id.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp();
});

afterAll(async () => {
  await testApp.close();
});

function sessionCookie(setCookie: string[] | string | undefined): string {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all.find((cookie) => cookie.startsWith('cred_stats_session=')) ?? '';
}

describe('GET /api/auth/config', () => {
  it('says what the sign-in page may offer, without a session', async () => {
    const response = await testApp.newAgent().get('/api/auth/config').expect(200);
    expect(response.body.data).toEqual({
      googleClientId: 'test-client-id.apps.googleusercontent.com',
      devLoginEnabled: true,
    });
  });
});

describe('signing in with Google', () => {
  it('sets an httpOnly, SameSite=Lax session cookie and returns the user', async () => {
    const agent = testApp.newAgent();
    const response = await agent
      .post('/api/auth/google')
      .send({ credential: 'google-token-alice-0000000000' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      userId: userIdFromSubject('google-sub-alice'),
      email: 'alice@example.com',
      name: 'Alice',
    });
    const cookie = sessionCookie(response.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.email).toBe('alice@example.com');
  });

  it('never uses the Google subject itself as the user id', async () => {
    const response = await testApp
      .newAgent()
      .post('/api/auth/google')
      .send({ credential: 'google-token-bob-00000000000' })
      .expect(200);
    expect(response.body.data.userId).not.toContain('google-sub-bob');
    expect(response.body.data.userId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses a token Google would not vouch for', async () => {
    const response = await testApp
      .newAgent()
      .post('/api/auth/google')
      .send({ credential: 'forged-token-000000000000' })
      .expect(401);
    expect(response.body.error.code).toBe('unauthorised');
  });

  it('refuses a malformed body', async () => {
    await testApp.newAgent().post('/api/auth/google').send({}).expect(400);
  });
});

describe('the demo sign-in', () => {
  it('signs in the fixed demo user the seed data belongs to', async () => {
    const response = await testApp.newAgent().post('/api/auth/dev-login').expect(200);
    expect(response.body.data.userId).toBe(DEMO_USER_ID);
  });
});

describe('the session', () => {
  it('is required everywhere that is not marked public', async () => {
    const response = await testApp.newAgent().get('/api/auth/me').expect(401);
    expect(response.body.error.code).toBe('unauthorised');
  });

  it('refuses a forged cookie', async () => {
    await testApp
      .newAgent()
      .get('/api/auth/me')
      .set('cookie', 'cred_stats_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad')
      .expect(401);
  });

  it('ends on sign-out', async () => {
    const agent = testApp.newAgent();
    await agent.post('/api/auth/dev-login').expect(200);
    await agent.get('/api/auth/me').expect(200);

    const response = await agent.post('/api/auth/sign-out').expect(200);
    expect(sessionCookie(response.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('cross-site request forgery', () => {
  it('refuses a write that lacks the app’s header, even with a valid session', async () => {
    const signedIn = testApp.newAgent();
    const login = await signedIn.post('/api/auth/dev-login').expect(200);
    const cookie = sessionCookie(login.headers['set-cookie']).split(';')[0] ?? '';

    // A bare agent: what a form on another site could make a browser send.
    const response = await supertest(testApp.app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('cookie', cookie)
      .expect(403);
    expect(response.body.error.code).toBe('forbidden');
  });

  it('lets reads through without it', async () => {
    await supertest(testApp.app.getHttpServer()).get('/api/health').expect(200);
  });
});
