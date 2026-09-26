import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@cred-stats/shared';

/**
 * An error the API means to send, with the machine-readable code the client
 * switches on. Throw this from a service when a request cannot be served for a
 * reason the user can act on; anything else becomes a generic 500.
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }

  static badRequest(message: string): ApiException {
    return new ApiException('bad_request', message, HttpStatus.BAD_REQUEST);
  }

  static unauthorised(message = 'Sign in to continue.'): ApiException {
    return new ApiException('unauthorised', message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message: string): ApiException {
    return new ApiException('forbidden', message, HttpStatus.FORBIDDEN);
  }

  /** `what` is a phrase like "That statement". */
  static notFound(what: string): ApiException {
    return new ApiException('not_found', `${what} was not found.`, HttpStatus.NOT_FOUND);
  }

  static conflict(message: string): ApiException {
    return new ApiException('conflict', message, HttpStatus.CONFLICT);
  }
}
