import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type Db, MongoClient } from 'mongodb';
import { Environment } from '../services/environment.service.js';
import { LogService } from '../services/log.service.js';

/**
 * Owns the one MongoDB connection pool for the process.
 *
 * The same code path runs everywhere: MongoDB in Docker locally, an in-memory
 * server under test, Atlas in production. The only difference is `MONGODB_URI`.
 * Repositories ask this manager for collections; nothing else constructs a
 * client.
 */
@Injectable()
export class MongoClientManager implements OnModuleInit, OnApplicationShutdown {
  private readonly client: MongoClient;

  constructor(
    private readonly environment: Environment,
    private readonly log: LogService,
  ) {
    this.client = new MongoClient(environment.env.MONGODB_URI, {
      appName: 'cred-stats-api',
      // Atlas M0 allows 500 connections across everything; a small pool per
      // process is plenty for a personal app and leaves room for tooling.
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
    });
  }

  async onModuleInit(): Promise<void> {
    const started = Date.now();
    await this.client.connect();
    this.log.info('mongo.connected', {
      database: this.environment.env.MONGODB_DB,
      durationMs: Date.now() - started,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }

  get db(): Db {
    return this.client.db(this.environment.env.MONGODB_DB);
  }

  /** True when the server answers a ping — the readiness check. */
  async ping(): Promise<boolean> {
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
