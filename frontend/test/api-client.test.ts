import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/services/api-client';
import { mockApi } from './helpers/render';

describe('the API client', () => {
  it('unwraps { data }', async () => {
    mockApi({ 'GET /api/auth/config': { googleClientId: null, devLoginEnabled: true } });
    await expect(api.get('/auth/config')).resolves.toEqual({
      googleClientId: null,
      devLoginEnabled: true,
    });
  });

  it('sends the header the API requires on writes, and JSON', async () => {
    const fetchSpy = mockApi({ 'POST /api/auth/dev-login': { userId: 'u' } });
    await api.post('/auth/dev-login');

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-requested-with']).toBe('cred-stats');
    expect(headers['content-type']).toBe('application/json');
    expect(init?.credentials).toBe('same-origin');
  });

  it('turns the error envelope into an ApiError the screen can show', async () => {
    mockApi({
      'POST /api/statements': () => ({
        status: 400,
        body: { error: { code: 'bad_request', message: 'No built-in parser covers this.' } },
      }),
    });
    const error = await api.post('/statements', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'bad_request' });
    expect((error as ApiError).message).toBe('No built-in parser covers this.');
  });

  it('reports an unreachable server in words', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await api.get('/views/workspace').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'network_error' });
  });
});
