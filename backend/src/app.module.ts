import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { ApiExceptionFilter } from './filters/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor.js';
import { Controllers, Providers } from './providers-and-controllers.js';

/**
 * One module. The app is small enough that feature modules would add wiring
 * without adding separation; the layering lives in the folder structure and in
 * `providers-and-controllers.ts` instead.
 *
 * Every request passes three guards, in this order: the rate limit, the CSRF
 * header check on writes, then the session check (unless `@Public()`).
 */
@Module({
  // A generous per-address ceiling for the whole API; sign-in and upload set
  // tighter limits of their own with @Throttle.
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }])],
  controllers: Controllers,
  providers: [
    ...Providers,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
