import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * One in-memory MongoDB for the whole test run. Each test file then works in a
 * database of its own (see `environment.ts`), so files run in parallel without
 * seeing each other's documents, and no Docker daemon is needed.
 */
let server: MongoMemoryServer | undefined;

export async function setup(): Promise<void> {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
}

export async function teardown(): Promise<void> {
  await server?.stop();
}
