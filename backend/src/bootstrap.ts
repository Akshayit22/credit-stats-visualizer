import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { Environment } from './services/environment.service.js';

/**
 * Upload bodies are extracted statement text, capped at 1.5 MB by the upload
 * schema. The JSON limit sits just above that so the schema, not the parser,
 * is what rejects an oversized statement — with a message that says why.
 */
const JSON_BODY_LIMIT = '2mb';

/**
 * Builds the configured application without listening. `main.ts` listens; the
 * API tests call this and drive the app with supertest, so both run exactly
 * the same middleware, filters and interceptors.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn'],
  });

  const environment = app.get(Environment);

  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(helmet());
  app.use(cookieParser());

  // Render (and any load balancer) terminates TLS in front of us. Trusting the
  // first proxy makes `req.secure` true, so the session cookie can be Secure.
  if (environment.isProduction) app.set('trust proxy', 1);

  app.enableShutdownHooks();
  return app;
}
