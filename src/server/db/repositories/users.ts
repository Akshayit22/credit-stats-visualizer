import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../client';
import { KEY } from '../keys';
import { TABLES } from '../table-names';
import type { Category } from '@/shared/categories';
import type { UserProfile } from '@/shared/types';

export interface UpsertUserInput {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

/**
 * Creates the profile on first sign-in and only refreshes `lastLoginAt` and the
 * avatar after that, so a display name edited in the app is not overwritten by
 * Google on the next login.
 */
export async function upsertUserOnSignIn(input: UpsertUserInput): Promise<void> {
  const now = new Date().toISOString();
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { pk: KEY.user(input.userId), sk: KEY.profile() },
      UpdateExpression: [
        'SET lastLoginAt = :now',
        'email = if_not_exists(email, :email)',
        '#name = if_not_exists(#name, :name)',
        'avatarUrl = :avatarUrl',
        'locale = if_not_exists(locale, :locale)',
        'currency = if_not_exists(currency, :currency)',
        'createdAt = if_not_exists(createdAt, :now)',
        'statementCount = if_not_exists(statementCount, :zero)',
      ].join(', '),
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':now': now,
        ':email': input.email,
        ':name': input.name,
        ':avatarUrl': input.avatarUrl,
        ':locale': 'en-IN',
        ':currency': 'INR',
        ':zero': 0,
      },
    }),
  );
}

export async function getUser(userId: string): Promise<UserProfile | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: TABLES.users,
      Key: { pk: KEY.user(userId), sk: KEY.profile() },
    }),
  );
  const item = result.Item;
  if (!item) return null;
  return {
    userId,
    email: String(item.email ?? ''),
    name: String(item.name ?? ''),
    avatarUrl: String(item.avatarUrl ?? ''),
    locale: String(item.locale ?? 'en-IN'),
    currency: 'INR',
    createdAt: String(item.createdAt ?? ''),
    lastLoginAt: String(item.lastLoginAt ?? ''),
    statementCount: Number(item.statementCount ?? 0),
  };
}

export async function bumpStatementCount(userId: string, delta: number): Promise<void> {
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { pk: KEY.user(userId), sk: KEY.profile() },
      UpdateExpression: 'SET statementCount = if_not_exists(statementCount, :zero) + :delta',
      ExpressionAttributeValues: { ':zero': 0, ':delta': delta },
    }),
  );
}

/* ── user category rules ────────────────────────────────────────────────────
   Stored on the users table as `sk = RULE#<normalisedMerchant>`, so a
   recategorisation in the UI sticks for every future statement — and so the
   five-table limit holds without a rules table. */

export function normaliseMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80);
}

export async function putUserRule(
  userId: string,
  merchant: string,
  category: Category,
): Promise<void> {
  const normalised = normaliseMerchant(merchant);
  if (normalised.length === 0) return;
  await getDocClient().send(
    new PutCommand({
      TableName: TABLES.users,
      Item: {
        pk: KEY.user(userId),
        sk: KEY.rule(normalised),
        merchant: normalised,
        category,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

export async function listUserRules(userId: string): Promise<Map<string, Category>> {
  const rules = new Map<string, Category>();
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.users,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': KEY.user(userId), ':prefix': 'RULE#' },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      rules.set(String(item.merchant), item.category as Category);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return rules;
}

/** Every item under `USER#<id>` on the users table — profile and rules alike. */
export async function deleteAllUserItems(userId: string): Promise<number> {
  const client = getDocClient();
  let deleted = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: TABLES.users,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': KEY.user(userId) },
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      await client.send(
        new DeleteCommand({ TableName: TABLES.users, Key: { pk: item.pk, sk: item.sk } }),
      );
      deleted += 1;
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return deleted;
}
