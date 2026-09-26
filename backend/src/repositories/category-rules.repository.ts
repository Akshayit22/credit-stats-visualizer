import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import { categoryRuleSchema, type Category, type CategoryRule } from '@cred-stats/shared';
import { normaliseMerchant } from '../domain/merchant-rules.js';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { MongoRepository } from './mongo.repository.js';

/**
 * The categories a user chose for merchants. Written when a row is
 * recategorised, read on every upload, so a merchant fixed once stays fixed
 * on every future statement.
 */
@Injectable()
export class CategoryRulesRepository extends MongoRepository<CategoryRule> {
  protected readonly collectionName = 'categoryRules';
  protected readonly itemSchema = categoryRuleSchema;
  protected readonly indexes: IndexDescription[] = [
    { key: { userId: 1, merchant: 1 }, name: 'user_merchant', unique: true },
  ];

  constructor(mongo: MongoClientManager) {
    super(mongo);
  }

  async put(userId: string, merchant: string, category: Category): Promise<void> {
    const normalised = normaliseMerchant(merchant);
    if (normalised.length === 0) return;
    await this.replaceOneForUser(
      userId,
      { merchant: normalised },
      { merchant: normalised, category, updatedAt: new Date().toISOString() },
    );
  }

  async list(userId: string): Promise<CategoryRule[]> {
    return this.findManyForUser(userId, {}, { sort: { merchant: 1 } });
  }

  /** Normalised merchant → category, the shape the categoriser looks rules up in. */
  async listAsMap(userId: string): Promise<Map<string, Category>> {
    const rules = await this.list(userId);
    return new Map(rules.map((rule) => [rule.merchant, rule.category]));
  }
}
