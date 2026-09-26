import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClientManager } from '../../src/managers/mongo-client.manager.js';
import { AccountsRepository } from '../../src/repositories/accounts.repository.js';
import { CategoryRulesRepository } from '../../src/repositories/category-rules.repository.js';
import { StatementsRepository } from '../../src/repositories/statements.repository.js';
import { SummariesRepository } from '../../src/repositories/summaries.repository.js';
import { TransactionsRepository } from '../../src/repositories/transactions.repository.js';
import { UsersRepository } from '../../src/repositories/users.repository.js';
import {
  CARD_ID,
  aCardStatement,
  aSummary,
  aTransaction,
  anAccount,
} from '../helpers/factories.js';
import { createTestDatabase } from '../helpers/test-database.js';

const ALICE = 'a'.repeat(32);
const BOB = 'b'.repeat(32);

let module: TestingModule;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ module, close } = await createTestDatabase());
});

afterAll(async () => {
  await close();
});

describe('users', () => {
  it('creates the profile on first sign-in and keeps the chosen name after', async () => {
    const users = module.get(UsersRepository);
    const first = await users.upsertOnSignIn({
      userId: ALICE,
      email: 'alice@example.com',
      name: 'Alice',
      avatarUrl: 'https://example.com/a.png',
    });
    expect(first).toMatchObject({ name: 'Alice', statementCount: 0, currency: 'INR' });

    const again = await users.upsertOnSignIn({
      userId: ALICE,
      email: 'alice@example.com',
      name: 'Alice From Google',
      avatarUrl: 'https://example.com/b.png',
    });
    expect(again.name).toBe('Alice');
    expect(again.avatarUrl).toBe('https://example.com/b.png');
    expect(again.createdAt).toBe(first.createdAt);
  });

  it('counts statements up and down', async () => {
    const users = module.get(UsersRepository);
    await users.bumpStatementCount(ALICE, 2);
    await users.bumpStatementCount(ALICE, -1);
    expect((await users.get(ALICE))?.statementCount).toBe(1);
  });
});

describe('every repository is scoped to one user', () => {
  it('never returns another user’s documents', async () => {
    const accounts = module.get(AccountsRepository);
    const statements = module.get(StatementsRepository);
    await accounts.put(ALICE, anAccount());
    await statements.put(ALICE, aCardStatement());

    expect(await accounts.list(BOB)).toEqual([]);
    expect(await accounts.get(BOB, CARD_ID)).toBeNull();
    expect(await statements.get(BOB, `${CARD_ID}_2026-06`)).toBeNull();
    expect(await statements.findByContentHash(BOB, 'a'.repeat(64))).toBeNull();
  });

  it('keeps storage fields out of what it returns', async () => {
    const [account] = await module.get(AccountsRepository).list(ALICE);
    expect(account).toEqual(anAccount());
    expect(account && '_id' in account).toBe(false);
    expect(account && 'userId' in account).toBe(false);
  });

  it('refuses to hand back a document that drifted from its schema', async () => {
    const mongo = module.get(MongoClientManager);
    await mongo.db
      .collection('accounts')
      .insertOne({ ...anAccount({ accountId: 'broken' }), userId: BOB, creditLimitMinor: 12.5 });
    await expect(module.get(AccountsRepository).get(BOB, 'broken')).rejects.toThrow();
  });
});

describe('statements', () => {
  it('replaces a statement re-uploaded for the same month', async () => {
    const statements = module.get(StatementsRepository);
    await statements.put(ALICE, aCardStatement({ rowCount: 15 }));
    await statements.put(ALICE, aCardStatement({ rowCount: 16 }));
    const all = await statements.list(ALICE);
    expect(all).toHaveLength(1);
    expect(all[0]?.rowCount).toBe(16);
  });

  it('lists newest upload first and finds a file by its content hash', async () => {
    const statements = module.get(StatementsRepository);
    await statements.put(
      ALICE,
      aCardStatement({
        statementId: `${CARD_ID}_2026-07`,
        period: '2026-07',
        uploadedAt: '2026-07-20T10:00:00.000Z',
        contentHash: 'c'.repeat(64),
      }),
    );
    const [newest] = await statements.list(ALICE);
    expect(newest?.period).toBe('2026-07');
    expect((await statements.findByContentHash(ALICE, 'c'.repeat(64)))?.period).toBe('2026-07');
  });

  it('deletes one statement', async () => {
    const statements = module.get(StatementsRepository);
    expect(await statements.delete(ALICE, `${CARD_ID}_2026-07`)).toBe(true);
    expect(await statements.delete(ALICE, `${CARD_ID}_2026-07`)).toBe(false);
  });
});

describe('transactions', () => {
  const statementId = `${CARD_ID}_2026-06`;
  const rows = [
    aTransaction({ txnId: '0000', seq: 0, date: '2026-05-25' }),
    aTransaction({ txnId: '0001', seq: 1, date: '2026-06-02', merchant: 'Blinkit' }),
    aTransaction({ txnId: '0002', seq: 2, date: '2026-06-02', merchant: 'Zepto' }),
  ];

  it('keeps a statement’s rows together even when the cycle straddles two months', async () => {
    const transactions = module.get(TransactionsRepository);
    await transactions.replaceForStatement(ALICE, statementId, rows);

    expect((await transactions.listForStatement(ALICE, statementId)).map((t) => t.txnId)).toEqual([
      '0000',
      '0001',
      '0002',
    ]);
    // By calendar month the June statement's May row is elsewhere.
    expect(await transactions.listForPeriod(ALICE, '2026-06')).toHaveLength(2);
    expect(await transactions.listForAccountPeriod(ALICE, CARD_ID, '2026-05')).toHaveLength(1);
  });

  it('replaces rather than adds on a re-parse that found fewer rows', async () => {
    const transactions = module.get(TransactionsRepository);
    await transactions.replaceForStatement(ALICE, statementId, rows.slice(0, 1));
    expect(await transactions.listForStatement(ALICE, statementId)).toHaveLength(1);
  });

  it('recategorises one row and marks it as the user’s choice', async () => {
    const transactions = module.get(TransactionsRepository);
    expect(await transactions.recategorise(ALICE, statementId, '0000', 'Groceries')).toBe(true);
    expect(await transactions.get(ALICE, statementId, '0000')).toMatchObject({
      category: 'Groceries',
      categorySource: 'user',
      userEdited: true,
    });
    expect(await transactions.recategorise(BOB, statementId, '0000', 'Groceries')).toBe(false);
  });
});

describe('summaries', () => {
  it('lists one scope for one year, oldest first', async () => {
    const summaries = module.get(SummariesRepository);
    await summaries.put(ALICE, aSummary({ period: '2026-06' }));
    await summaries.put(ALICE, aSummary({ period: '2026-01' }));
    await summaries.put(ALICE, aSummary({ period: '2025-12' }));
    await summaries.put(ALICE, aSummary({ scope: 'ALL', period: '2026-06' }));

    const inYear = await summaries.list(ALICE, CARD_ID, '2026');
    expect(inYear.map((s) => s.period)).toEqual(['2026-01', '2026-06']);
    expect(await summaries.list(ALICE, 'ALL')).toHaveLength(1);
  });

  it('overwrites the same scope and month', async () => {
    const summaries = module.get(SummariesRepository);
    await summaries.put(ALICE, aSummary({ period: '2026-06', txnCount: 99 }));
    const [june] = (await summaries.list(ALICE, CARD_ID, '2026')).filter(
      (s) => s.period === '2026-06',
    );
    expect(june?.txnCount).toBe(99);
  });
});

describe('category rules', () => {
  it('stores rules under the normalised merchant', async () => {
    const rules = module.get(CategoryRulesRepository);
    await rules.put(ALICE, 'SWIGGY*Order', 'Groceries');
    await rules.put(ALICE, 'swiggy order', 'Food & dining');
    const map = await rules.listAsMap(ALICE);
    expect(map.size).toBe(1);
    expect(map.get('swiggy order')).toBe('Food & dining');
  });
});

describe('deleting everything', () => {
  it('removes only that user’s documents', async () => {
    const accounts = module.get(AccountsRepository);
    await accounts.put(BOB, anAccount({ accountId: 'bob-card' }));
    expect(await accounts.deleteAllForUser(ALICE)).toBeGreaterThan(0);
    expect(await accounts.list(ALICE)).toEqual([]);
    expect(await accounts.get(BOB, 'bob-card')).not.toBeNull();
  });
});
