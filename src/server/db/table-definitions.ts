import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';
import { TABLE_KINDS, tableName, type TableKind } from './table-names';

const S = 'S' as const;
const HASH = 'HASH' as const;
const RANGE = 'RANGE' as const;
const PAY_PER_REQUEST = 'PAY_PER_REQUEST' as const;
const ALL = 'ALL' as const;

/** `pk`/`sk` on every table; the GSIs differ per table. */
function base(kind: TableKind): CreateTableCommandInput {
  return {
    TableName: tableName(kind),
    BillingMode: PAY_PER_REQUEST,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: S },
      { AttributeName: 'sk', AttributeType: S },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: HASH },
      { AttributeName: 'sk', KeyType: RANGE },
    ],
  };
}

function withGsis(
  input: CreateTableCommandInput,
  gsis: ReadonlyArray<{ name: 'gsi1' | 'gsi2' }>,
): CreateTableCommandInput {
  const attrs = gsis.flatMap((g) => [
    { AttributeName: `${g.name}pk`, AttributeType: S },
    { AttributeName: `${g.name}sk`, AttributeType: S },
  ]);
  return {
    ...input,
    AttributeDefinitions: [...(input.AttributeDefinitions ?? []), ...attrs],
    GlobalSecondaryIndexes: gsis.map((g) => ({
      IndexName: g.name,
      KeySchema: [
        { AttributeName: `${g.name}pk`, KeyType: HASH },
        { AttributeName: `${g.name}sk`, KeyType: RANGE },
      ],
      Projection: { ProjectionType: ALL },
    })),
  };
}

/**
 * users        pk USER#<id>  sk PROFILE | RULE#<merchant>
 * accounts     pk USER#<id>  sk ACCOUNT#<accountId>
 * statements   pk USER#<id>  sk ACCOUNT#<id>#PERIOD#<YYYY-MM>
 *                gsi1 CONTENTHASH#<sha256> / USER#<id>        duplicate detection
 *                gsi2 USER#<id>#STATUS#<status> / <uploadedAt> library filtering
 * transactions pk USER#<id>  sk TXN#<date>#<accountId>#<txnId>
 *                gsi1 ACCOUNT#<id> / <date>#<txnId>           one account's period
 *                gsi2 STATEMENT#<id> / <seq>                  re-parse / delete
 * summaries    pk USER#<id>  sk ALL#<YYYY-MM> | ACCOUNT#<id>#<YYYY-MM>
 */
export function tableDefinition(kind: TableKind): CreateTableCommandInput {
  switch (kind) {
    case 'statements':
    case 'transactions':
      return withGsis(base(kind), [{ name: 'gsi1' }, { name: 'gsi2' }]);
    case 'users':
    case 'accounts':
    case 'summaries':
      return base(kind);
  }
}

export function allTableDefinitions(): CreateTableCommandInput[] {
  return TABLE_KINDS.map(tableDefinition);
}
