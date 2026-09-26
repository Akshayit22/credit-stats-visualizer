import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import { userProfileSchema, type UserProfile } from '@cred-stats/shared';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { MongoRepository } from './mongo.repository.js';

export interface SignInProfile {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

/** One document per person: the profile, keyed by `userId`. */
@Injectable()
export class UsersRepository extends MongoRepository<UserProfile> {
  protected readonly collectionName = 'users';
  protected readonly itemSchema = userProfileSchema;
  protected readonly indexes: IndexDescription[] = [
    { key: { userId: 1 }, name: 'user', unique: true },
  ];

  constructor(mongo: MongoClientManager) {
    super(mongo);
  }

  /**
   * Creates the profile on first sign-in and only refreshes `lastLoginAt` and
   * the avatar after that, so a display name the user changed is not
   * overwritten by Google on the next login.
   */
  async upsertOnSignIn(profile: SignInProfile): Promise<UserProfile> {
    const now = new Date().toISOString();
    const document = await this.collection.findOneAndUpdate(
      { userId: profile.userId },
      {
        $set: { lastLoginAt: now, avatarUrl: profile.avatarUrl },
        $setOnInsert: {
          userId: profile.userId,
          email: profile.email,
          name: profile.name,
          locale: 'en-IN',
          currency: 'INR',
          createdAt: now,
          statementCount: 0,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!document) throw new Error('The profile upsert returned no document.');
    return this.parse(document);
  }

  async get(userId: string): Promise<UserProfile | null> {
    return this.findOneForUser(userId, {});
  }

  async bumpStatementCount(userId: string, delta: number): Promise<void> {
    await this.collection.updateOne({ userId }, { $inc: { statementCount: delta } });
  }
}
