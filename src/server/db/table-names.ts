/**
 * The five tables. There are exactly five and there will not be a sixth:
 * anything that looks like a new entity becomes a new `sk` prefix on one of
 * these (subscriptions, for example, would be `sk = SUBSCRIPTION#…` on users).
 */
export const TABLE_KINDS = ['users', 'accounts', 'statements', 'transactions', 'summaries'] as const;

export type TableKind = (typeof TABLE_KINDS)[number];

export function tablePrefix(): string {
  return process.env.DDB_TABLE_PREFIX ?? 'cred-stats-local';
}

export function tableName(kind: TableKind): string {
  return `${tablePrefix()}-${kind}`;
}

export const TABLES = {
  get users() {
    return tableName('users');
  },
  get accounts() {
    return tableName('accounts');
  },
  get statements() {
    return tableName('statements');
  },
  get transactions() {
    return tableName('transactions');
  },
  get summaries() {
    return tableName('summaries');
  },
};
