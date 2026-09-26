import { Injectable } from '@nestjs/common';
import { MongoClientManager } from '../managers/mongo-client.manager.js';

export interface UserRow {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface StatementCountRow {
  userId: string;
  accountId: string;
  accountType: 'credit_card' | 'savings';
  statements: number;
  lastUploadAt: string;
}

export interface AccountIssuerRow {
  userId: string;
  accountId: string;
  issuer: string;
}

/**
 * The one place that reads across users, for the admin overview.
 *
 * Every other repository is scoped to a single user by `MongoRepository`.
 * This one deliberately is not, so it is kept apart, read-only, and limited
 * to what the overview shows: who has signed in and how many statements they
 * uploaded for which bank. It never reads a transaction, a figure or a
 * summary — the projections below are the whole of what leaves the database.
 */
@Injectable()
export class AdminInsightsRepository {
  constructor(private readonly mongo: MongoClientManager) {}

  async users(): Promise<UserRow[]> {
    const rows = await this.mongo.db
      .collection('users')
      .find(
        {},
        { projection: { _id: 0, userId: 1, email: 1, name: 1, createdAt: 1, lastLoginAt: 1 } },
      )
      .toArray();
    return rows.map((row) => ({
      userId: String(row.userId),
      email: String(row.email ?? ''),
      name: String(row.name ?? ''),
      createdAt: String(row.createdAt ?? ''),
      lastLoginAt: String(row.lastLoginAt ?? ''),
    }));
  }

  /** Statements per user and account, counted in the database. */
  async statementCounts(): Promise<StatementCountRow[]> {
    const rows = await this.mongo.db
      .collection('statements')
      .aggregate<{
        _id: { userId: string; accountId: string; accountType: string };
        statements: number;
        lastUploadAt: string;
      }>([
        {
          $group: {
            _id: { userId: '$userId', accountId: '$accountId', accountType: '$accountType' },
            statements: { $sum: 1 },
            lastUploadAt: { $max: '$uploadedAt' },
          },
        },
      ])
      .toArray();
    return rows.map((row) => ({
      userId: row._id.userId,
      accountId: row._id.accountId,
      accountType: row._id.accountType === 'savings' ? 'savings' : 'credit_card',
      statements: row.statements,
      lastUploadAt: row.lastUploadAt,
    }));
  }

  async accountIssuers(): Promise<AccountIssuerRow[]> {
    const rows = await this.mongo.db
      .collection('accounts')
      .find({}, { projection: { _id: 0, userId: 1, accountId: 1, issuer: 1 } })
      .toArray();
    return rows.map((row) => ({
      userId: String(row.userId),
      accountId: String(row.accountId),
      issuer: String(row.issuer ?? ''),
    }));
  }
}
