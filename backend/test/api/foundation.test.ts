import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/**
 * What every endpoint inherits from the bootstrap: the envelope, the error
 * shape, the body limit and the security headers.
 */
let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp();
});

afterAll(async () => {
  await testApp.close();
});

describe('GET /api/health', () => {
  it('answers ok inside the { data } envelope when MongoDB is reachable', async () => {
    const response = await testApp.http.get('/api/health').expect(200);
    expect(response.body).toEqual({
      data: { status: 'ok', database: 'ok', llmProvider: 'mock' },
    });
  });

  it('sends the helmet security headers', async () => {
    const response = await testApp.http.get('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('errors', () => {
  it('answers an unknown route with the error envelope', async () => {
    const response = await testApp.http.get('/api/nowhere').expect(404);
    expect(response.body.error.code).toBe('not_found');
    expect(typeof response.body.error.message).toBe('string');
  });

  it('refuses malformed JSON as a bad request', async () => {
    const response = await testApp.http
      .post('/api/nowhere')
      .set('content-type', 'application/json')
      .send('{"text": ')
      .expect(400);
    expect(response.body.error.code).toBe('bad_request');
  });

  it('refuses a body over the limit before it reaches a handler', async () => {
    const response = await testApp.http
      .post('/api/nowhere')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(2_200_000) }))
      .expect(413);
    expect(response.body.error.code).toBe('payload_too_large');
  });
});
