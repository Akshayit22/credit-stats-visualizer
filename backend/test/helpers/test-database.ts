import { Test, type TestingModule } from '@nestjs/testing';
import { MongoClientManager } from '../../src/managers/mongo-client.manager.js';
import { Repositories } from '../../src/providers-and-controllers.js';
import { Environment } from '../../src/services/environment.service.js';
import { LogService } from '../../src/services/log.service.js';

/**
 * The repositories wired to this test file's own database, without the HTTP
 * layer. Indexes are created on init, exactly as at boot. Close it in
 * `afterAll`, which also drops the database.
 */
export async function createTestDatabase(): Promise<{
  module: TestingModule;
  close: () => Promise<void>;
}> {
  const module = await Test.createTestingModule({
    providers: [Environment, LogService, MongoClientManager, ...Repositories],
  }).compile();
  await module.init();

  return {
    module,
    close: async () => {
      await module.get(MongoClientManager).db.dropDatabase();
      await module.close();
    },
  };
}
