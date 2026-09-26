import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { Environment } from '../services/environment.service.js';

/** Who Google says signed in, once the ID token has been verified. */
export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
  avatarUrl: string;
}

/** Google's published signing keys; jose fetches and caches them. */
const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Verifies the ID token the Sign in with Google button hands the browser.
 *
 * The check is the whole of Google sign-in on our side: the RS256 signature
 * against Google's published keys, the issuer, the expiry, and that the
 * audience is *our* client id — a token minted for some other site is
 * refused. No client secret is involved; the browser never holds anything
 * worth stealing.
 */
@Injectable()
export class GoogleAuthClientManager {
  constructor(private readonly environment: Environment) {}

  get clientId(): string | null {
    return this.environment.env.GOOGLE_CLIENT_ID ?? null;
  }

  /** The verified identity, or null for any token we should not accept. */
  async verifyIdToken(idToken: string): Promise<GoogleIdentity | null> {
    const audience = this.clientId;
    return audience ? verifyGoogleIdToken(idToken, audience, GOOGLE_KEYS) : null;
  }
}

/** The check itself, with the key set as a parameter so tests can sign their own. */
export async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
  keys: JWTVerifyGetKey,
): Promise<GoogleIdentity | null> {
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: GOOGLE_ISSUERS,
      audience,
      algorithms: ['RS256'],
    });
    const {
      sub,
      email,
      email_verified: emailVerified,
      name,
      picture,
    } = payload as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!sub || !email || emailVerified !== true) return null;
    return { subject: sub, email, name: name ?? '', avatarUrl: picture ?? '' };
  } catch {
    return null;
  }
}
