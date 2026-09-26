import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import { statementSchema, type Statement } from '@cred-stats/shared';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { MongoRepository } from './mongo.repository.js';

/**
 * One document per parsed statement. `statementId` is `<accountId>_<period>`,
 * so re-uploading a month replaces it rather than adding a second copy.
 */
@Injectable()
export class StatementsRepository extends MongoRepository<Statement> {
  protected readonly collectionName = 'statements';
  protected readonly itemSchema = statementSchema;
  protected readonly indexes: IndexDescription[] = [
    { key: { userId: 1, statementId: 1 }, name: 'user_statement', unique: true },
    // "Has this user already uploaded this exact file?"
    { key: { userId: 1, contentHash: 1 }, name: 'user_content_hash' },
    // The library, newest first.
    { key: { userId: 1, uploadedAt: -1 }, name: 'user_uploaded' },
  ];

  constructor(mongo: MongoClientManager) {
    super(mongo);
  }

  /** Newest upload first. */
  async list(userId: string): Promise<Statement[]> {
    return this.findManyForUser(userId, {}, { sort: { uploadedAt: -1 } });
  }

  async get(userId: string, statementId: string): Promise<Statement | null> {
    return this.findOneForUser(userId, { statementId });
  }

  async findByContentHash(userId: string, contentHash: string): Promise<Statement | null> {
    return this.findOneForUser(userId, { contentHash });
  }

  async put(userId: string, statement: Statement): Promise<void> {
    await this.replaceOneForUser(userId, { statementId: statement.statementId }, statement);
  }

  async delete(userId: string, statementId: string): Promise<boolean> {
    return (await this.deleteManyForUser(userId, { statementId })) > 0;
  }
}
