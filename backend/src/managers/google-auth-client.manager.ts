import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { Environment } from '../services/environment.service.js';

/** Who Google says signed in, once the ID token has been verified. */
export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
  avatarUrl: string;
}

/**
 * Verifies the ID token the Sign in with Google button hands the browser.
 *
 * The check is the whole of Google sign-in on our side: the signature against
 * Google's published keys, the issuer, the expiry, and that the audience is
 * *our* client id — a token minted for some other site is refused. No client
 * secret is involved; the browser never holds anything worth stealing.
 */
@Injectable()
export class GoogleAuthClientManager {
  private readonly client = new OAuth2Client();

  constructor(private readonly environment: Environment) {}

  get clientId(): string | null {
    return this.environment.env.GOOGLE_CLIENT_ID ?? null;
  }

  /** The verified identity, or null for any token we should not accept. */
  async verifyIdToken(idToken: string): Promise<GoogleIdentity | null> {
    const audience = this.clientId;
    if (!audience) return null;

    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) return null;
      return {
        subject: payload.sub,
        email: payload.email,
        name: payload.name ?? '',
        avatarUrl: payload.picture ?? '',
      };
    } catch {
      return null;
    }
  }
}
