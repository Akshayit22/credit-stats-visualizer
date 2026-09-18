import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../client';
import { KEY } from '../keys';
import { TABLES } from '../table-names';
import type { CategoryTotal, MerchantTotal, Period, Summary } from '@/shared/types';

function toSummary(item: Record<string, unknown>): Summary {
  return {
    scope: String(item.scope ?? 'ALL'),
    period: String(item.period ?? ''),
    spendMinor: Number(item.spendMinor ?? 0),
    incomeMinor: Number(item.incomeMinor ?? 0),
    feesMinor: Number(item.feesMinor ?? 0),
    interestMinor: Number(item.interestMinor ?? 0),
    cashbackEarnedMinor: Number(item.cashbackEarnedMinor ?? 0),
    cashbackCreditedMinor: Number(item.cashbackCreditedMinor ?? 0),
    paymentsMinor: Number(item.paymentsMinor ?? 0),
    closingBalanceMinor: Number(item.closingBalanceMinor ?? 0),
    byCategory: (item.byCategory as Record<string, CategoryTotal>) ?? {},
    topMerchants: (item.topMerchants as MerchantTotal[]) ?? [],
    txnCount: Number(item.txnCount ?? 0),
    updatedAt: String(item.updatedAt ?? ''),
  };
}

export async function putSummary(userId: string, summary: Summary): Promise<void> {
  const sk =
    summary.scope === 'ALL'
      ? KEY.summaryAll(summary.period)
      : KEY.summaryAccount(summary.scope, summary.period);
  await getDocClient().send(
    new PutCommand({
      TableName: TABLES.summaries,
      Item: { pk: KEY.user(userId), sk, ...summary },
    }),
  );
}

/**
 * The year overview: one query on `sk begins_with "ALL#2026"`, or
 * `ACCOUNT#<id>#2026` for a single account.
 */
export async function listSummaries(
  userId: string,
  scope: 'ALL' | string,
  yearPrefix?: string,
): Promise<Summary[]> {
  const prefix =
    scope === 'ALL'
      ? KEY.summaryAllYearPrefix(yearPrefix ?? '')
      : KEY.summaryAccountYearPrefix(scope, yearPrefix ?? '');

  const out: Summary[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.summaries,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': KEY.user(userId), ':prefix': prefix },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) out.push(toSummary(item));
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export async function deleteSummary(
  userId: string,
  scope: 'ALL' | string,
  period: Period,
): Promise<void> {
  const sk = scope === 'ALL' ? KEY.summaryAll(period) : KEY.summaryAccount(scope, period);
  await getDocClient().send(
    new DeleteCommand({ TableName: TABLES.summaries, Key: { pk: KEY.user(userId), sk } }),
  );
}

export async function deleteAllSummaries(userId: string): Promise<number> {
  const client = getDocClient();
  let deleted = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: TABLES.summaries,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': KEY.user(userId) },
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      await client.send(
        new DeleteCommand({ TableName: TABLES.summaries, Key: { pk: item.pk, sk: item.sk } }),
      );
      deleted += 1;
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return deleted;
}
