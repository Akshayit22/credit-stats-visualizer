import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'cred_stats_session';

/** Thirty days, after which the browser signs in again. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * The session cookie's attributes.
 *
 * - `httpOnly`: page scripts cannot read it, so an XSS bug cannot lift it.
 * - `sameSite: lax`: not sent on cross-site POSTs, the classic CSRF vector.
 * - `secure` in production: HTTPS only. (Render terminates TLS in front of
 *   the app, which is why the app trusts the first proxy.)
 *
 * The frontend reaches the API on its own origin (a Vite proxy locally, a
 * Render rewrite in production), so this is a first-party cookie everywhere.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}
