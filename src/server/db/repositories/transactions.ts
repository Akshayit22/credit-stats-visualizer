import {
  BatchWriteCommand,
  QueryCommand,
  UpdateCommand,
  type BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../client';
import { KEY } from '../keys';
import { TABLES } from '../table-names';
import type { Category } from '@/shared/categories';
import type { CategorySource, Period, Transaction } from '@/shared/types';

const BATCH_LIMIT = 25;

function toTransaction(item: Record<string, unknown>): Transaction {
  return {
    txnId: String(item.txnId ?? ''),
    accountId: String(item.accountId ?? ''),
    statementId: String(item.statementId ?? ''),
    seq: Number(item.seq ?? 0),
    date: String(item.date ?? ''),
    descriptionRaw: String(item.descriptionRaw ?? ''),
    counterparty: String(item.counterparty ?? ''),
    merchant: String(item.merchant ?? ''),
    issuerCategory: (item.issuerCategory as string | null) ?? null,
    category: item.category as Category,
    categorySource: (item.categorySource as CategorySource) ?? 'rule',
    amountMinor: Number(item.amountMinor ?? 0),
    direction: item.direction === 'credit' ? 'credit' : 'debit',
    mode: (item.mode as Transaction['mode']) ?? 'other',
    referenceNo: (item.referenceNo as string | null) ?? null,
    balanceAfterMinor:
      item.balanceAfterMinor === null || item.balanceAfterMinor === undefined
        ? null
        : Number(item.balanceAfterMinor),
    cashbackMinor:
      item.cashbackMinor === null || item.cashbackMinor === undefined
        ? null
        : Number(item.cashbackMinor),
    isFee: Boolean(item.isFee),
    isInterest: Boolean(item.isInterest),
    isPayment: Boolean(item.isPayment),
    userEdited: Boolean(item.userEdited),
  };
}

function itemFor(userId: string, txn: Transaction): Record<string, unknown> {
  return {
    pk: KEY.user(userId),
    sk: KEY.txn(txn.date, txn.accountId, txn.txnId),
    // gsi1 answers "one account's transactions in a period"
    gsi1pk: KEY.account(txn.accountId),
    gsi1sk: `${txn.date}#${txn.txnId}`,
    // gsi2 answers "every row this statement produced", for re-parse and delete
    gsi2pk: KEY.statementRef(txn.statementId),
    gsi2sk: String(txn.seq).padStart(6, '0'),
    ...txn,
  };
}

async function writeInBatches(requests: BatchWriteCommandInput['RequestItems']): Promise<void> {
  if (!requests) return;
  const client = getDocClient();
  let pending = requests;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await client.send(new BatchWriteCommand({ RequestItems: pending }));
    const unprocessed = result.UnprocessedItems;
    if (!unprocessed || Object.keys(unprocessed).length === 0) return;
    pending = unprocessed;
    // DynamoDB Local rarely throttles; the cloud does. Back off rather than spin.
    await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
  }
  throw new Error('Some transactions could not be written after several attempts.');
}

export async function putTransactions(userId: string, transactions: Transaction[]): Promise<void> {
  for (let i = 0; i < transactions.length; i += BATCH_LIMIT) {
    const slice = transactions.slice(i, i + BATCH_LIMIT);
    await writeInBatches({
      [TABLES.transactions]: slice.map((txn) => ({ PutRequest: { Item: itemFor(userId, txn) } })),
    });
  }
}

/** Every row across every account for one month — the month drill-down. */
export async function listTransactionsForPeriod(
  userId: string,
  period: Period,
): Promise<Transaction[]> {
  const out: Transaction[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.transactions,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': KEY.user(userId),
          ':prefix': KEY.txnMonthPrefix(period),
        },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) out.push(toTransaction(item));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return out;
}

/** One account's rows for one month — the account screen. */
export async function listTransactionsForAccountPeriod(
  userId: string,
  accountId: string,
  period: Period,
): Promise<Transaction[]> {
  const out: Transaction[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.transactions,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :prefix)',
        ExpressionAttributeValues: { ':pk': KEY.account(accountId), ':prefix': period },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      const txn = toTransaction(item);
      // gsi1 is not partitioned by user, so confirm ownership before returning.
      if (String(item.pk) === KEY.user(userId)) out.push(txn);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return out;
}

/** The rows one statement produced — used to re-parse and to delete. */
export async function listTransactionsForStatement(
  userId: string,
  statementId: string,
): Promise<Transaction[]> {
  const out: Transaction[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.transactions,
        IndexName: 'gsi2',
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: { ':pk': KEY.statementRef(statementId) },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      if (String(item.pk) === KEY.user(userId)) out.push(toTransaction(item));
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return out.sort((a, b) => a.seq - b.seq);
}

export async function deleteTransactionsForStatement(
  userId: string,
  statementId: string,
): Promise<number> {
  const rows = await listTransactionsForStatement(userId, statementId);
  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const slice = rows.slice(i, i + BATCH_LIMIT);
    await writeInBatches({
      [TABLES.transactions]: slice.map((txn) => ({
        DeleteRequest: {
          Key: { pk: KEY.user(userId), sk: KEY.txn(txn.date, txn.accountId, txn.txnId) },
        },
      })),
    });
  }
  return rows.length;
}

export async function recategoriseTransaction(
  userId: string,
  txn: { date: string; accountId: string; txnId: string },
  category: Category,
): Promise<void> {
  await getDocClient().send(
    new UpdateCommand({
      TableName: TABLES.transactions,
      Key: { pk: KEY.user(userId), sk: KEY.txn(txn.date, txn.accountId, txn.txnId) },
      UpdateExpression: 'SET category = :category, categorySource = :source, userEdited = :edited',
      ConditionExpression: 'attribute_exists(sk)',
      ExpressionAttributeValues: { ':category': category, ':source': 'user', ':edited': true },
    }),
  );
}

export async function deleteAllTransactions(userId: string): Promise<number> {
  const client = getDocClient();
  let deleted = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: TABLES.transactions,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': KEY.user(userId) },
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey: cursor,
      }),
    );
    const items = page.Items ?? [];
    for (let i = 0; i < items.length; i += BATCH_LIMIT) {
      const slice = items.slice(i, i + BATCH_LIMIT);
      await writeInBatches({
        [TABLES.transactions]: slice.map((item) => ({
          DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
        })),
      });
      deleted += slice.length;
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return deleted;
}
