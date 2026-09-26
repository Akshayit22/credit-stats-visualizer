import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import {
  addMonths,
  transactionSchema,
  type Category,
  type Period,
  type Transaction,
} from '@cred-stats/shared';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { MongoRepository } from './mongo.repository.js';

/** Oldest first, and in printed order within a day. */
const CHRONOLOGICAL = { date: 1, seq: 1 } as const;

/**
 * One document per statement row. A row is identified by its statement and
 * its position in it (`txnId` = `0003`), so re-parsing a statement rewrites
 * the same rows rather than adding to them.
 */
@Injectable()
export class TransactionsRepository extends MongoRepository<Transaction> {
  protected readonly collectionName = 'transactions';
  protected readonly itemSchema = transactionSchema;
  protected readonly indexes: IndexDescription[] = [
    { key: { userId: 1, statementId: 1, txnId: 1 }, name: 'user_statement_txn', unique: true },
    { key: { userId: 1, date: 1 }, name: 'user_date' },
    { key: { userId: 1, accountId: 1, date: 1 }, name: 'user_account_date' },
  ];

  constructor(mongo: MongoClientManager) {
    super(mongo);
  }

  /**
   * Replace every row of a statement. Delete-then-insert rather than upsert:
   * a re-parse that finds fewer rows must not leave the old extras behind.
   */
  async replaceForStatement(
    userId: string,
    statementId: string,
    transactions: Transaction[],
  ): Promise<void> {
    await this.deleteManyForUser(userId, { statementId });
    await this.insertManyForUser(userId, transactions);
  }

  /**
   * The rows one statement produced — which is **not** the rows dated in one
   * month. The Axis cycle runs 17 May to 15 Jun: four of its fifteen rows are
   * dated in May, and "the June statement" must show all fifteen.
   */
  async listForStatement(userId: string, statementId: string): Promise<Transaction[]> {
    return this.findManyForUser(userId, { statementId }, { sort: CHRONOLOGICAL });
  }

  /** Every account's rows dated in one calendar month. */
  async listForPeriod(userId: string, period: Period): Promise<Transaction[]> {
    return this.findManyForUser(userId, datedIn(period), { sort: CHRONOLOGICAL });
  }

  /** One account's rows dated in one calendar month. */
  async listForAccountPeriod(
    userId: string,
    accountId: string,
    period: Period,
  ): Promise<Transaction[]> {
    return this.findManyForUser(userId, { accountId, ...datedIn(period) }, { sort: CHRONOLOGICAL });
  }

  async listAll(userId: string): Promise<Transaction[]> {
    return this.findManyForUser(userId, {}, { sort: CHRONOLOGICAL });
  }

  async get(userId: string, statementId: string, txnId: string): Promise<Transaction | null> {
    return this.findOneForUser(userId, { statementId, txnId });
  }

  /** False when no such row exists for this user. */
  async recategorise(
    userId: string,
    statementId: string,
    txnId: string,
    category: Category,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { userId, statementId, txnId },
      { $set: { category, categorySource: 'user', userEdited: true } },
    );
    return result.matchedCount > 0;
  }

  async deleteForStatement(userId: string, statementId: string): Promise<number> {
    return this.deleteManyForUser(userId, { statementId });
  }
}

/** ISO dates sort as strings, so a month is a half-open string range. */
function datedIn(period: Period): { date: { $gte: string; $lt: string } } {
  return { date: { $gte: `${period}-01`, $lt: `${addMonths(period, 1)}-01` } };
}
