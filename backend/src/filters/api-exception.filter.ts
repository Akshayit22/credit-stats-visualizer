import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode, ApiFailure } from '@cred-stats/shared';
import type { Request, Response } from 'express';
import { LogService } from '../services/log.service.js';
import { ApiException } from './api-exception.js';

const CODE_FOR_STATUS: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthorised',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
};

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  bad_request: 'The request was not valid.',
  unauthorised: 'Sign in to continue.',
  forbidden: 'That is not allowed.',
  not_found: 'That was not found.',
  conflict: 'That conflicts with something already saved.',
  payload_too_large: 'That upload is too large.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  server_error: 'Something went wrong on our side.',
};

/**
 * Turns every thrown error into `{ error: { code, message } }`.
 *
 * A 4xx carries its message, because the message is what the user acts on. A
 * 5xx never does: an unexpected error's message can carry statement text, so
 * the client gets a fixed sentence and the log gets the error's *name* only.
 */
@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly log: LogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { status, error } = this.describe(exception);

    if (status >= 500) {
      this.log.error('request.failed', {
        method: request.method,
        route: request.route ? String((request.route as { path?: unknown }).path) : request.path,
        status,
        error: exception instanceof Error ? exception.name : 'unknown',
      });
    }

    const body: ApiFailure = { error };
    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; error: ApiError } {
    if (exception instanceof ApiException) {
      return {
        status: exception.getStatus(),
        error: { code: exception.code, message: exception.message },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_FOR_STATUS[status] ?? (status >= 500 ? 'server_error' : 'bad_request');
      const message =
        status >= 500 ? DEFAULT_MESSAGE.server_error : this.messageOf(exception, code);
      return { status, error: { code, message } };
    }

    // Express's body parser rejects oversized or malformed JSON before Nest
    // routes the request; it throws plain errors carrying a status.
    const bodyParserStatus = this.bodyParserStatus(exception);
    if (bodyParserStatus !== null) {
      const code = CODE_FOR_STATUS[bodyParserStatus] ?? 'bad_request';
      return { status: bodyParserStatus, error: { code, message: DEFAULT_MESSAGE[code] } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: { code: 'server_error', message: DEFAULT_MESSAGE.server_error },
    };
  }

  private messageOf(exception: HttpException, code: ApiErrorCode): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
    return DEFAULT_MESSAGE[code];
  }

  private bodyParserStatus(exception: unknown): number | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const { status, type } = exception as { status?: unknown; type?: unknown };
    if (typeof status !== 'number' || typeof type !== 'string') return null;
    return status >= 400 && status < 500 ? status : null;
  }
}
