import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../client';
import { KEY } from '../keys';
import { TABLES } from '../table-names';
import type { Account, AccountType } from '@/shared/types';
import type { ParsedAccount } from '@/server/domain/schemas';

/**
 * An account id is derived from `(issuer, type, last4)` rather than generated,
 * so the same card recognised in next month's statement lands on the same row
 * without a lookup, and so the id is readable in a URL:
 * `axis-bank-credit-card-9581`.
 */
export function accountIdFor(issuer: string, type: AccountType, last4: string): string {
  const slug = issuer
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${slug}-${type.replace('_', '-')}-${last4}`;
}

function toAccount(item: Record<string, unknown>): Account {
  return {
    accountId: String(item.accountId ?? ''),
    type: (item.type as AccountType) ?? 'credit_card',
    issuer: String(item.issuer ?? ''),
    productName: String(item.productName ?? ''),
    displayName: String(item.displayName ?? ''),
    last4: String(item.last4 ?? ''),
    maskedNumber: String(item.maskedNumber ?? ''),
    creditLimitMinor: item.creditLimitMinor === null ? null : Number(item.creditLimitMinor ?? 0),
    cashLimitMinor: item.cashLimitMinor === null ? null : Number(item.cashLimitMinor ?? 0),
    openedAt: (item.openedAt as string | null) ?? null,
    createdAt: String(item.createdAt ?? ''),
  };
}

export async function listAccounts(userId: string): Promise<Account[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLES.accounts,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': KEY.user(userId), ':prefix': 'ACCOUNT#' },
    }),
  );
  return (result.Items ?? []).map(toAccount);
}

export async function getAccount(userId: string, accountId: string): Promise<Account | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: TABLES.accounts,
      Key: { pk: KEY.user(userId), sk: KEY.account(accountId) },
    }),
  );
  return result.Item ? toAccount(result.Item) : null;
}

/**
 * Creates the account on the first statement that mentions it, and afterwards
 * only refreshes the figures that legitimately move month to month — the credit
 * limit can be raised, the display name is the user's to keep.
 */
export async function upsertAccountFromStatement(
  userId: string,
  parsed: ParsedAccount,
): Promise<Account> {
  const accountId = accountIdFor(parsed.issuer, parsed.type, parsed.last4);
  const existing = await getAccount(userId, accountId);
  const now = new Date().toISOString();

  const account: Account = {
    accountId,
    type: parsed.type,
    issuer: parsed.issuer,
    productName: parsed.productName || existing?.productName || '',
    displayName:
      existing?.displayName ||
      [parsed.issuer, parsed.productName].filter(Boolean).join(' · ') ||
      parsed.issuer,
    last4: parsed.last4,
    maskedNumber: parsed.maskedNumber || existing?.maskedNumber || `XXXX${parsed.last4}`,
    creditLimitMinor: parsed.creditLimitMinor ?? existing?.creditLimitMinor ?? null,
    cashLimitMinor: parsed.cashLimitMinor ?? existing?.cashLimitMinor ?? null,
    openedAt: parsed.openedAt ?? existing?.openedAt ?? null,
    createdAt: existing?.createdAt ?? now,
  };

  await getDocClient().send(
    new PutCommand({
      TableName: TABLES.accounts,
      Item: { pk: KEY.user(userId), sk: KEY.account(accountId), ...account },
    }),
  );
  return account;
}

export async function deleteAllAccounts(userId: string): Promise<number> {
  const client = getDocClient();
  const accounts = await listAccounts(userId);
  for (const account of accounts) {
    await client.send(
      new DeleteCommand({
        TableName: TABLES.accounts,
        Key: { pk: KEY.user(userId), sk: KEY.account(account.accountId) },
      }),
    );
  }
  return accounts.length;
}
