import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../client';
import { KEY } from '../keys';
import { TABLES } from '../table-names';
import type { Statement, StatementStatus } from '@/shared/types';

/** `axis-bank-credit-card-9581_2026-06` — deterministic, so a re-parse replaces. */
export function statementIdFor(accountId: string, period: string): string {
  return `${accountId}_${period}`;
}

function toStatement(item: Record<string, unknown>): Statement {
  const common = {
    statementId: String(item.statementId ?? ''),
    accountId: String(item.accountId ?? ''),
    period: String(item.period ?? ''),
    periodStart: String(item.periodStart ?? ''),
    periodEnd: String(item.periodEnd ?? ''),
    statementDate: (item.statementDate as string | null) ?? null,
    dueDate: (item.dueDate as string | null) ?? null,
    status: (item.status as StatementStatus) ?? 'parsed',
    parser: String(item.parser ?? ''),
    llm: (item.llm as Statement['llm']) ?? null,
    reconciliation: item.reconciliation as Statement['reconciliation'],
    rowCount: Number(item.rowCount ?? 0),
    uploadedAt: String(item.uploadedAt ?? ''),
    contentHash: String(item.contentHash ?? ''),
  };

  if (item.accountType === 'savings') {
    return { ...common, accountType: 'savings', savings: item.savings as never };
  }
  return { ...common, accountType: 'credit_card', card: item.card as never };
}

export async function putStatement(userId: string, statement: Statement): Promise<void> {
  await getDocClient().send(
    new PutCommand({
      TableName: TABLES.statements,
      Item: {
        pk: KEY.user(userId),
        sk: KEY.statement(statement.accountId, statement.period),
        // gsi1 answers "has this user already uploaded this exact file?"
        gsi1pk: KEY.contentHash(statement.contentHash),
        gsi1sk: KEY.user(userId),
        // gsi2 answers "show me everything that needs review, newest first"
        gsi2pk: KEY.userStatus(userId, statement.status),
        gsi2sk: statement.uploadedAt,
        ...statement,
      },
    }),
  );
}

export async function getStatement(
  userId: string,
  accountId: string,
  period: string,
): Promise<Statement | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: TABLES.statements,
      Key: { pk: KEY.user(userId), sk: KEY.statement(accountId, period) },
    }),
  );
  return result.Item ? toStatement(result.Item) : null;
}

export async function listStatements(userId: string): Promise<Statement[]> {
  const statements: Statement[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.statements,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': KEY.user(userId), ':prefix': 'ACCOUNT#' },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) statements.push(toStatement(item));
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  return statements.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** The library's status filter, served off gsi2 rather than a table scan. */
export async function listStatementsByStatus(
  userId: string,
  status: StatementStatus,
): Promise<Statement[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLES.statements,
      IndexName: 'gsi2',
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: { ':pk': KEY.userStatus(userId, status) },
      ScanIndexForward: false,
    }),
  );
  return (result.Items ?? []).map(toStatement);
}

/**
 * Duplicate detection: has this user already uploaded a file with this exact
 * content hash? Served off gsi1, so it costs one query rather than a scan.
 */
export async function findByContentHash(
  userId: string,
  contentHash: string,
): Promise<Statement | null> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLES.statements,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk = :sk',
      ExpressionAttributeValues: {
        ':pk': KEY.contentHash(contentHash),
        ':sk': KEY.user(userId),
      },
      Limit: 1,
    }),
  );
  const item = (result.Items ?? [])[0];
  return item ? toStatement(item) : null;
}

export async function deleteStatement(
  userId: string,
  accountId: string,
  period: string,
): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({
      TableName: TABLES.statements,
      Key: { pk: KEY.user(userId), sk: KEY.statement(accountId, period) },
    }),
  );
}

export async function deleteAllStatements(userId: string): Promise<number> {
  const client = getDocClient();
  const statements = await listStatements(userId);
  for (const statement of statements) {
    await client.send(
      new DeleteCommand({
        TableName: TABLES.statements,
        Key: { pk: KEY.user(userId), sk: KEY.statement(statement.accountId, statement.period) },
      }),
    );
  }
  return statements.length;
}
