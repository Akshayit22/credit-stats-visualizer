import type { NestExpressApplication } from '@nestjs/platform-express';
import supertest from 'supertest';
import { createApp } from '../../src/bootstrap.js';
import { MongoClientManager } from '../../src/managers/mongo-client.manager.js';

export interface TestApp {
  app: NestExpressApplication;
  /** A supertest agent bound to the running app. Keeps cookies between calls. */
  http: ReturnType<typeof supertest.agent>;
  close: () => Promise<void>;
}

/**
 * The real application — same middleware, guards, filters and interceptors as
 * production — against this test file's own database. Close it in `afterAll`,
 * which also drops the database.
 */
export async function createTestApp(): Promise<TestApp> {
  const app = await createApp();
  await app.init();

  return {
    app,
    http: supertest.agent(app.getHttpServer()),
    close: async () => {
      await app.get(MongoClientManager).db.dropDatabase();
      await app.close();
    },
  };
}
