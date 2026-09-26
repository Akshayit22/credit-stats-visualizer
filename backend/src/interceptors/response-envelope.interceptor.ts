import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiSuccess } from '@cred-stats/shared';
import { type Observable, map } from 'rxjs';

/**
 * Wraps whatever a controller returns in `{ data }`. Controllers return plain
 * values and never build the envelope themselves; errors get theirs from
 * `ApiExceptionFilter`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}
