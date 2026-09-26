import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiExceptionFilter } from './filters/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor.js';
import { Controllers, Providers } from './providers-and-controllers.js';

/**
 * One module. The app is small enough that feature modules would add wiring
 * without adding separation; the layering lives in the folder structure and in
 * `providers-and-controllers.ts` instead.
 */
@Module({
  controllers: Controllers,
  providers: [
    ...Providers,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
