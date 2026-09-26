import type { OnModuleInit } from '@nestjs/common';
import type {
  Collection,
  Document,
  Filter,
  FindOptions,
  IndexDescription,
  OptionalUnlessRequiredId,
} from 'mongodb';
import type { z } from 'zod';
import type { MongoClientManager } from '../managers/mongo-client.manager.js';

/**
 * The base every repository extends: one collection, one zod schema for what
 * lives in it, and the indexes its queries need.
 *
 * Two rules hold for every collection, and this class is where they are kept:
 *
 *  1. **Every document belongs to one user**, and every query this class runs
 *     is scoped by `userId`. There is no method that reads across users, so a
 *     repository cannot forget the ownership check.
 *  2. **Every document read is validated** against `itemSchema`. A document
 *     that drifted from the schema fails loudly here rather than rendering as
 *     `NaN` three screens later. Parsing also strips `_id` and `userId`, so
 *     neither ever reaches an API response.
 */
export abstract class MongoRepository<Item extends object> implements OnModuleInit {
  protected abstract readonly collectionName: string;
  protected abstract readonly itemSchema: z.ZodType<Item>;
  protected abstract readonly indexes: IndexDescription[];

  protected constructor(protected readonly mongo: MongoClientManager) {}

  /** Idempotent: creating an index that already exists is a no-op. */
  async onModuleInit(): Promise<void> {
    if (this.indexes.length > 0) await this.collection.createIndexes(this.indexes);
  }

  protected get collection(): Collection<Document> {
    return this.mongo.db.collection(this.collectionName);
  }

  protected async findManyForUser(
    userId: string,
    filter: Filter<Document> = {},
    options: FindOptions = {},
  ): Promise<Item[]> {
    const documents = await this.collection.find({ ...filter, userId }, options).toArray();
    return documents.map((document) => this.parse(document));
  }

  protected async findOneForUser(userId: string, filter: Filter<Document>): Promise<Item | null> {
    const document = await this.collection.findOne({ ...filter, userId });
    return document ? this.parse(document) : null;
  }

  /** Inserts or wholly replaces the one document matching `key`. */
  protected async replaceOneForUser(
    userId: string,
    key: Filter<Document>,
    item: Item,
  ): Promise<void> {
    await this.collection.replaceOne({ ...key, userId }, { ...item, userId }, { upsert: true });
  }

  protected async insertManyForUser(userId: string, items: Item[]): Promise<void> {
    if (items.length === 0) return;
    const documents = items.map(
      (item) => ({ ...item, userId }) as OptionalUnlessRequiredId<Document>,
    );
    await this.collection.insertMany(documents, { ordered: true });
  }

  protected async deleteManyForUser(
    userId: string,
    filter: Filter<Document> = {},
  ): Promise<number> {
    const result = await this.collection.deleteMany({ ...filter, userId });
    return result.deletedCount;
  }

  /** Every document this user owns in this collection — for export and delete. */
  async deleteAllForUser(userId: string): Promise<number> {
    return this.deleteManyForUser(userId);
  }

  protected parse(document: Document): Item {
    return this.itemSchema.parse(document);
  }
}
