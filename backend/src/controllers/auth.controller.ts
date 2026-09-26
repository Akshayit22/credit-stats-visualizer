import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  googleSignInSchema,
  type AuthConfig,
  type GoogleSignInRequest,
  type SessionUser,
} from '@cred-stats/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session-cookie.js';
import { ApiException } from '../filters/api-exception.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { AuthService } from '../services/auth.service.js';
import { Environment } from '../services/environment.service.js';
import { SessionService } from '../services/session.service.js';

/** Signing in is ten attempts a minute per address; plenty for a person. */
const SIGN_IN_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly environment: Environment,
  ) {}

  /** What the sign-in page may offer. */
  @Public()
  @Get('config')
  config(): AuthConfig {
    return this.auth.config();
  }

  /** Exchange a Google ID token for a session cookie. */
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async signInWithGoogle(
    @Body(new ZodValidationPipe(googleSignInSchema)) body: GoogleSignInRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionUser> {
    const user = await this.auth.signInWithGoogle(body.credential);
    await this.startSession(response, user);
    return user;
  }

  /** The demo user. Refused unless enabled, and always in production. */
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @Post('dev-login')
  @HttpCode(HttpStatus.OK)
  async signInAsDemoUser(@Res({ passthrough: true }) response: Response): Promise<SessionUser> {
    const user = await this.auth.signInAsDemoUser();
    await this.startSession(response, user);
    return user;
  }

  /** Public so that a stale or broken cookie can always be cleared. */
  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.OK)
  signOut(@Res({ passthrough: true }) response: Response): { signedOut: true } {
    this.endSession(response);
    return { signedOut: true };
  }

  /** Who the session belongs to — 401 once the account has been deleted. */
  @Get('me')
  async me(
    @CurrentUser() session: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionUser> {
    const user = await this.auth.currentUser(session.userId);
    if (!user) {
      this.endSession(response);
      throw ApiException.unauthorised();
    }
    return user;
  }

  private async startSession(response: Response, user: SessionUser): Promise<void> {
    const token = await this.sessions.issue(user);
    response.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.environment.isProduction));
  }

  private endSession(response: Response): void {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions(this.environment.isProduction);
    response.clearCookie(SESSION_COOKIE, options);
  }
}
