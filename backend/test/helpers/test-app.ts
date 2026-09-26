import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../src/auth/csrf.guard.js';
import { configureApp } from '../../src/bootstrap.js';
import {
  GoogleAuthClientManager,
  type GoogleIdentity,
} from '../../src/managers/google-auth-client.manager.js';
import { MongoClientManager } from '../../src/managers/mongo-client.manager.js';

export interface TestApp {
  app: NestExpressApplication;
  /** A supertest agent bound to the app. Keeps cookies between calls. */
  http: ReturnType<typeof supertest.agent>;
  /** A fresh agent — a second browser with its own cookie jar. */
  newAgent: () => ReturnType<typeof supertest.agent>;
  close: () => Promise<void>;
}

/** The Google ID tokens the fake verifier accepts, and who they belong to. */
export const FAKE_GOOGLE_TOKENS: Record<string, GoogleIdentity> = {
  'google-token-alice-0000000000': {
    subject: 'google-sub-alice',
    email: 'alice@example.com',
    name: 'Alice',
    avatarUrl: 'https://example.com/alice.png',
  },
  'google-token-bob-00000000000': {
    subject: 'google-sub-bob',
    email: 'bob@example.com',
    name: 'Bob',
    avatarUrl: '',
  },
};

/**
 * The real application — the same module, guards, filters, interceptors and
 * middleware as production — against this test file's own database. Only
 * Google's token check is replaced, by one that accepts `FAKE_GOOGLE_TOKENS`.
 *
 * Every request carries the app's CSRF header, as the real frontend does.
 * Close it in `afterAll`, which also drops the database.
 */
export async function createTestApp(): Promise<TestApp> {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleAuthClientManager)
    .useValue({
      clientId: 'test-client-id.apps.googleusercontent.com',
      verifyIdToken: (token: string) => Promise.resolve(FAKE_GOOGLE_TOKENS[token] ?? null),
    })
    .compile();

  const app = configureApp(
    module.createNestApplication<NestExpressApplication>({ bodyParser: false }),
  );
  await app.init();

  const newAgent = () =>
    supertest.agent(app.getHttpServer()).set(CLIENT_HEADER, CLIENT_HEADER_VALUE);

  return {
    app,
    http: newAgent(),
    newAgent,
    close: async () => {
      await app.get(MongoClientManager).db.dropDatabase();
      await app.close();
    },
  };
}

/** Signs an agent in as the demo user and returns it. */
export async function signInAsDemo(
  agent: ReturnType<typeof supertest.agent>,
): Promise<ReturnType<typeof supertest.agent>> {
  await agent.post('/api/auth/dev-login').expect(200);
  return agent;
}
