import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../filters/api-exception.js';

/** The header the frontend's API client sends on every request. */
export const CLIENT_HEADER = 'x-requested-with';
export const CLIENT_HEADER_VALUE = 'cred-stats';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every state-changing request must carry `X-Requested-With: cred-stats`.
 *
 * A page on another site can make a browser send a form POST, but it cannot
 * add a custom header without a CORS preflight — and this API answers no
 * preflight. Together with the `SameSite=Lax` session cookie that closes
 * cross-site request forgery without tokens to thread through every form.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (request.get(CLIENT_HEADER) === CLIENT_HEADER_VALUE) return true;
    throw ApiException.forbidden('This request must come from the cred-stats app.');
  }
}
