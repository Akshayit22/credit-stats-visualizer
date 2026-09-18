import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getSessionUser, type SessionUser } from '@/server/auth/session';
import { logger } from '@/server/log';

/**
 * Every route handler answers `{ data }` or `{ error: { code, message } }`.
 * Nothing else, and never a bare value.
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function fail(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const ERRORS = {
  unauthorised: () => fail('unauthorised', 'Sign in to continue.', 401),
  notFound: (what: string) => fail('not_found', `${what} was not found.`, 404),
  badRequest: (message: string) => fail('bad_request', message, 400),
  conflict: (message: string) => fail('conflict', message, 409),
  server: () => fail('server_error', 'Something went wrong on our side.', 500),
} as const;

/**
 * Wraps a handler so it always sees a signed-in user and never leaks an
 * exception's detail — or any statement text — to the client or the log.
 */
export function withUser(
  handler: (user: SessionUser, request: Request) => Promise<NextResponse>,
): (request: Request) => Promise<NextResponse> {
  return async (request: Request) => {
    const user = await getSessionUser();
    if (!user) return ERRORS.unauthorised();

    try {
      return await handler(user, request);
    } catch (error) {
      if (error instanceof ZodError) {
        return ERRORS.badRequest(summariseZodError(error));
      }
      logger.error('request.failed', {
        route: new URL(request.url).pathname,
        method: request.method,
        // The name only. A message could carry statement text.
        error: error instanceof Error ? error.name : 'unknown',
      });
      return ERRORS.server();
    }
  };
}

/** Field paths only — never the offending values, which may be statement text. */
export function summariseZodError(error: ZodError): string {
  const paths = error.issues
    .map((issue) => issue.path.join('.') || '(root)')
    .filter((path, index, all) => all.indexOf(path) === index)
    .slice(0, 6);
  return `Request did not match the expected shape: ${paths.join(', ')}`;
}
