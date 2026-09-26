import { type CanActivate, type ExecutionContext, Injectable, UseGuards } from '@nestjs/common';
import { ApiException } from '../filters/api-exception.js';
import { isAdminEmail } from './admins.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';

/**
 * Lets a request through only when the signed-in user is an admin. Runs after
 * the global AuthGuard, so `request.user` is already the verified session.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user && isAdminEmail(request.user.email)) return true;
    throw ApiException.forbidden('This page is for the site’s admins.');
  }
}

/** Restricts a controller or route to admins. */
export const AdminOnly = (): MethodDecorator & ClassDecorator => UseGuards(AdminGuard);
