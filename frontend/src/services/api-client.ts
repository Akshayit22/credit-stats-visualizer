import type { ApiErrorCode, ApiFailure, ApiSuccess } from '@cred-stats/shared';

/**
 * The one way the app talks to the API.
 *
 * - Always `/api` on this origin, so the session cookie is first-party and
 *   httpOnly (a Vite proxy locally, a Render rewrite in production).
 * - Every request carries `X-Requested-With: cred-stats`; the API refuses
 *   writes without it, which is what stops cross-site request forgery.
 * - Unwraps `{ data }`, and turns `{ error: { code, message } }` into an
 *   `ApiError` whose message is written for the user.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network_error',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorised(): boolean {
    return this.status === 401;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function apiRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'x-requested-with': 'cred-stats',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  const payload = (await response.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null;

  if (!response.ok || payload === null || !('data' in payload)) {
    const error = payload !== null && 'error' in payload ? payload.error : null;
    throw new ApiError(
      response.status,
      error?.code ?? 'server_error',
      error?.message ?? 'Something went wrong on our side.',
    );
  }
  return payload.data;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => apiRequest<T>('PATCH', path, body),
  delete: <T>(path: string) => apiRequest<T>('DELETE', path),
};
