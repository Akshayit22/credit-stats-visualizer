import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import { summarySchema, type Period, type Summary } from '@cred-stats/shared';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { MongoRepository } from './mongo.repository.js';

/**
 * Pre-computed monthly totals. `scope` is an `accountId` — one account's
 * statement cycle — or `ALL`, the sum of every account's summary for the month.
 * Always recomputed from what is stored, never incremented.
 */
@Injectable()
export class SummariesRepository extends MongoRepository<Summary> {
  protected readonly collectionName = 'summaries';
  protected readonly itemSchema = summarySchema;
  protected readonly indexes: IndexDescription[] = [
    { key: { userId: 1, scope: 1, period: 1 }, name: 'user_scope_period', unique: true },
  ];

  constructor(mongo: MongoClientManager) {
    super(mongo);
  }

  async put(userId: string, summary: Summary): Promise<void> {
    await this.replaceOneForUser(userId, { scope: summary.scope, period: summary.period }, summary);
  }

  /** One scope's months, oldest first; within one year when `year` is given. */
  async list(userId: string, scope: string, year?: string): Promise<Summary[]> {
    const filter = year ? { scope, period: { $gte: `${year}-01`, $lte: `${year}-12` } } : { scope };
    return this.findManyForUser(userId, filter, { sort: { period: 1 } });
  }

  async listAll(userId: string): Promise<Summary[]> {
    return this.findManyForUser(userId, {}, { sort: { scope: 1, period: 1 } });
  }

  async delete(userId: string, scope: string, period: Period): Promise<void> {
    await this.deleteManyForUser(userId, { scope, period });
  }
}
