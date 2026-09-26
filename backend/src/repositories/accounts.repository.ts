import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import { accountSchema, type Account } from '@cred-stats/shared';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { MongoRepository } from './mongo.repository.js';

/** Cards and savings accounts, keyed by the derived `accountId`. */
@Injectable()
export class AccountsRepository extends MongoRepository<Account> {
  protected readonly collectionName = 'accounts';
  protected readonly itemSchema = accountSchema;
  protected readonly indexes: IndexDescription[] = [
    { key: { userId: 1, accountId: 1 }, name: 'user_account', unique: true },
  ];

  constructor(mongo: MongoClientManager) {
    super(mongo);
  }

  async list(userId: string): Promise<Account[]> {
    return this.findManyForUser(userId, {}, { sort: { createdAt: 1, accountId: 1 } });
  }

  async get(userId: string, accountId: string): Promise<Account | null> {
    return this.findOneForUser(userId, { accountId });
  }

  async put(userId: string, account: Account): Promise<void> {
    await this.replaceOneForUser(userId, { accountId: account.accountId }, account);
  }
}
