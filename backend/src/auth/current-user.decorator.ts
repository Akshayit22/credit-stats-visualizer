import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '@cred-stats/shared';
import type { Request } from 'express';
import { ApiException } from '../filters/api-exception.js';

/** What the auth guard attaches to a request it let through. */
export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

/**
 * The signed-in user, as the session cookie names them.
 *
 *   @Get() list(@CurrentUser() user: SessionUser) { … }
 *
 * Every query a handler makes is scoped by `user.userId`; there is no other
 * source of the id, so a request cannot name someone else's.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw ApiException.unauthorised();
    return request.user;
  },
);
