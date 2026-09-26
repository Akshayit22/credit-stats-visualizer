import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../filters/api-exception.js';
import { SessionService } from '../services/session.service.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { IS_PUBLIC } from './public.decorator.js';
import { SESSION_COOKIE } from './session-cookie.js';

/**
 * Runs on every request. A route marked `@Public()` passes; anything else needs
 * a valid session cookie, whose user is then attached for `@CurrentUser()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    const user = typeof token === 'string' ? await this.sessions.verify(token) : null;
    if (!user) throw ApiException.unauthorised();

    request.user = user;
    return true;
  }
}
