import { Injectable } from '@nestjs/common';
import type { AuthConfig, SessionUser } from '@cred-stats/shared';
import { DEMO_USER, userIdFromSubject } from '../auth/user-id.js';
import { ApiException } from '../filters/api-exception.js';
import { GoogleAuthClientManager } from '../managers/google-auth-client.manager.js';
import { UsersRepository } from '../repositories/users.repository.js';
import { Environment } from './environment.service.js';
import { LogService, userIdLogPrefix } from './log.service.js';

/**
 * Turns a proof of identity into a user: verify it, derive our own user id,
 * create or refresh the profile. Issuing the cookie is the controller's job.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly environment: Environment,
    private readonly google: GoogleAuthClientManager,
    private readonly users: UsersRepository,
    private readonly log: LogService,
  ) {}

  config(): AuthConfig {
    return {
      googleClientId: this.google.clientId,
      devLoginEnabled: this.environment.devLoginEnabled,
    };
  }

  async signInWithGoogle(credential: string): Promise<SessionUser> {
    if (!this.google.clientId) {
      throw ApiException.forbidden('Google sign-in is not configured on this server.');
    }

    const identity = await this.google.verifyIdToken(credential);
    if (!identity) throw ApiException.unauthorised('That Google sign-in could not be verified.');

    return this.signIn(identity.subject, identity, 'google');
  }

  async signInAsDemoUser(): Promise<SessionUser> {
    // Checked on every call, not once at boot: the flag alone must never be
    // enough in production.
    if (!this.environment.devLoginEnabled) {
      throw ApiException.forbidden('The demo sign-in is switched off.');
    }
    return this.signIn(DEMO_USER.subject, { ...DEMO_USER, avatarUrl: '' }, 'demo');
  }

  /** The profile behind a session, or null once the account has been deleted. */
  async currentUser(userId: string): Promise<SessionUser | null> {
    const profile = await this.users.get(userId);
    if (!profile) return null;
    return {
      userId: profile.userId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    };
  }

  private async signIn(
    subject: string,
    details: { email: string; name: string; avatarUrl: string },
    method: 'google' | 'demo',
  ): Promise<SessionUser> {
    const profile = await this.users.upsertOnSignIn({
      userId: userIdFromSubject(subject),
      ...details,
    });
    this.log.info('auth.signed_in', { user: userIdLogPrefix(profile.userId), method });
    return {
      userId: profile.userId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    };
  }
}
