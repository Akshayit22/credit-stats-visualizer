import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@cred-stats/shared';
import { SignJWT, jwtVerify } from 'jose';
import { SESSION_TTL_SECONDS } from '../auth/session-cookie.js';
import { Environment } from './environment.service.js';
import { LogService } from './log.service.js';

const ISSUER = 'cred-stats-api';
const AUDIENCE = 'cred-stats-web';

/**
 * Issues and checks the session token: an HS256 JWT carried in an httpOnly
 * cookie. Stateless — there is no sessions collection to look up — so the
 * token carries just enough to render the header without a database round
 * trip: the user id, email, name and avatar.
 */
@Injectable()
export class SessionService {
  private readonly key: Uint8Array;

  constructor(environment: Environment, log: LogService) {
    const secret = environment.env.CRED_STATS_SESSION_SECRET;
    if (secret) {
      this.key = new TextEncoder().encode(secret);
    } else {
      // Only reachable outside production; the environment refuses to boot a
      // production process without a secret.
      this.key = randomBytes(32);
      log.warn('session.ephemeral_secret', {
        note: 'CRED_STATS_SESSION_SECRET is unset; sessions end when the process restarts.',
      });
    }
  }

  async issue(user: SessionUser): Promise<string> {
    return new SignJWT({ email: user.email, name: user.name, picture: user.avatarUrl })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** The user a token names, or null for anything expired, forged or malformed. */
  async verify(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
      return {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
        name: typeof payload.name === 'string' ? payload.name : '',
        avatarUrl: typeof payload.picture === 'string' ? payload.picture : '',
      };
    } catch {
      return null;
    }
  }
}
