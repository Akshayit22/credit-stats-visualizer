import { createHash } from 'node:crypto';
import type { AccountView, OverviewView, Statement, Transaction } from '@cred-stats/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureText } from '../helpers/fixtures.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/**
 * The whole journey through the API against the three real (redacted)
 * statements: upload, library, the screens' views, recategorising, deleting,
 * export — and that none of it is visible to anyone else.
 */

const CARD = 'axis-bank-credit-card-9581';
const CARD_JUNE = `${CARD}_2026-06`;

let testApp: TestApp;

function uploadBody(name: string) {
  const text = fixtureText(name);
  return {
    text,
    contentHash: createHash('sha256').update(text).digest('hex'),
    meta: { pageCount: 2, fileName: `${name}.pdf`, extractedAt: new Date().toISOString() },
  };
}

beforeAll(async () => {
  testApp = await createTestApp();
  await testApp.http.post('/api/auth/dev-login').expect(200);
});

afterAll(async () => {
  await testApp.close();
});

describe('uploading the real statements', () => {
  it('parses and reconciles the Axis card statement', async () => {
    const response = await testApp.http
      .post('/api/statements')
      .send(uploadBody(FIXTURE_NAMES.card))
      .expect(201);
    const { statement, account, transactions, duplicate } = response.body.data;

    expect(duplicate).toBe(false);
    expect(account.accountId).toBe(CARD);
    expect(statement.statementId).toBe(CARD_JUNE);
    expect(statement.status).toBe('parsed');
    expect(statement.card.totalDueMinor).toBe(19_392_38);
    expect(statement.card.cashbackEarnedMinor).toBe(267_00);
    expect(transactions).toHaveLength(15);
  });

  it('parses both slice savings months', async () => {
    const july = await testApp.http
      .post('/api/statements')
      .send(uploadBody(FIXTURE_NAMES.sliceJul))
      .expect(201);
    expect(july.body.data.statement.savings.closingBalanceMinor).toBe(2_75_910_82);
    expect(july.body.data.transactions).toHaveLength(41);

    const august = await testApp.http
      .post('/api/statements')
      .send(uploadBody(FIXTURE_NAMES.sliceAug))
      .expect(201);
    expect(august.body.data.statement.savings.closingBalanceMinor).toBe(3_17_691_27);
    expect(august.body.data.transactions).toHaveLength(49);
  });

  it('recognises a file it has already seen and keeps one copy', async () => {
    const response = await testApp.http
      .post('/api/statements')
      .send(uploadBody(FIXTURE_NAMES.card))
      .expect(200);
    expect(response.body.data.duplicate).toBe(true);
    expect(response.body.data.warnings[0].code).toBe('duplicate');

    const library = await testApp.http.get('/api/statements').expect(200);
    expect(library.body.data.statements).toHaveLength(3);
    expect(library.body.data.accounts).toHaveLength(2);
  });

  it('refuses anything but JSON — PDF bytes are never accepted', async () => {
    const response = await testApp.http
      .post('/api/statements')
      .set('content-type', 'application/pdf')
      .send(Buffer.from('%PDF-1.7'))
      .expect(400);
    expect(response.body.error.message).toMatch(/PDF bytes are never uploaded/);
  });

  it('refuses a body that is not an extracted statement', async () => {
    await testApp.http.post('/api/statements').send({ text: 'short' }).expect(400);
  });
});

describe('the screens’ views', () => {
  it('gives the sidebar its accounts and the months that have data', async () => {
    const response = await testApp.http.get('/api/views/workspace').expect(200);
    expect(response.body.data.periods).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(response.body.data.needsReview).toEqual([]);
  });

  it('shows the whole June card cycle, including the rows dated in May', async () => {
    const response = await testApp.http.get(`/api/views/card/${CARD}?period=2026-06`).expect(200);
    const view: AccountView = response.body.data;

    expect(view.statement?.statementId).toBe(CARD_JUNE);
    expect(view.transactions).toHaveLength(15);
    expect(view.transactions.filter((txn) => txn.date.startsWith('2026-05')).length).toBe(4);
    expect(view.window.selected).toBe('2026-06');
    expect(view.periodsWithData).toEqual(['2026-06']);
    expect(view.summaries.map((summary) => summary.period)).toEqual(['2026-06']);
  });

  it('refuses the card screen for a savings account', async () => {
    const workspace = await testApp.http.get('/api/views/workspace');
    const savings = (workspace.body.data.statements as Statement[]).find(
      (statement) => statement.accountType === 'savings',
    );
    expect(savings).toBeDefined();
    await testApp.http.get(`/api/views/card/${savings?.accountId}`).expect(404);
    await testApp.http.get(`/api/views/savings/${savings?.accountId}`).expect(200);
  });

  it('keeps card cashback apart from months with only a savings statement', async () => {
    const response = await testApp.http.get('/api/views/overview?mode=year&year=2026').expect(200);
    const view: OverviewView = response.body.data;
    const june = view.months.find((month) => month.period === '2026-06');
    const august = view.months.find((month) => month.period === '2026-08');

    expect(june?.hasCardStatement).toBe(true);
    expect(june?.cashbackMinor).toBe(267_00);
    expect(august?.hasAnyStatement).toBe(true);
    expect(august?.hasCardStatement).toBe(false);
  });

  it('refuses a malformed account id', async () => {
    await testApp.http.get('/api/views/card/..%2F..%2Fetc').expect(400);
  });
});

describe('recategorising a row', () => {
  it('moves the row, writes a merchant rule, and updates the month’s totals', async () => {
    const detail = await testApp.http.get(`/api/statements/${CARD_JUNE}`).expect(200);
    const rows: Transaction[] = detail.body.data.transactions;
    const row = rows.find((txn) => txn.direction === 'debit' && !txn.isFee && !txn.isPayment);
    expect(row).toBeDefined();
    if (!row) return;
    const target = row.category === 'Health' ? 'Education' : 'Health';

    await testApp.http
      .patch(`/api/statements/${CARD_JUNE}/transactions/${row.txnId}`)
      .send({ category: target })
      .expect(200);

    const after = await testApp.http.get(`/api/statements/${CARD_JUNE}`).expect(200);
    const moved = (after.body.data.transactions as Transaction[]).find(
      (txn) => txn.txnId === row.txnId,
    );
    expect(moved).toMatchObject({ category: target, categorySource: 'user', userEdited: true });

    const summaries = await testApp.http
      .get(`/api/summaries?year=2026&accountId=${CARD}`)
      .expect(200);
    const june = summaries.body.data.summaries[0];
    expect(june.byCategory[target].amountMinor).toBeGreaterThanOrEqual(row.amountMinor);

    const exported = await testApp.http.get('/api/profile/export').expect(200);
    expect(exported.body.data.categoryRules.length).toBeGreaterThan(0);
  });

  it('answers 404 for a row that does not exist', async () => {
    await testApp.http
      .patch(`/api/statements/${CARD_JUNE}/transactions/9999`)
      .send({ category: 'Health' })
      .expect(404);
  });
});

describe('someone else’s data', () => {
  it('is invisible: another user sees nothing and cannot address it', async () => {
    const bob = testApp.newAgent();
    await bob.post('/api/auth/google').send({ credential: 'google-token-bob-00000000000' });

    const library = await bob.get('/api/statements').expect(200);
    expect(library.body.data.statements).toEqual([]);
    await bob.get(`/api/statements/${CARD_JUNE}`).expect(404);
    await bob.get(`/api/views/card/${CARD}`).expect(404);
    await bob.delete(`/api/statements/${CARD_JUNE}`).expect(404);
  });
});

describe('settings, export and deletion', () => {
  it('shows the counts and the provider, never a key', async () => {
    const response = await testApp.http.get('/api/settings').expect(200);
    expect(response.body.data).toMatchObject({
      statementCount: 3,
      accountCount: 2,
      currency: 'INR',
      provider: { id: 'mock', configured: true },
    });
  });

  it('exports everything held, as a download', async () => {
    const response = await testApp.http.get('/api/profile/export').expect(200);
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="cred-stats-export-/,
    );
    expect(response.body.data.statements).toHaveLength(3);
    expect(response.body.data.transactions).toHaveLength(15 + 41 + 49);
    expect(response.body.data.note).toMatch(/never stored/);
  });

  it('deletes one statement and its rows, and the month empties', async () => {
    const response = await testApp.http.delete(`/api/statements/${CARD_JUNE}`).expect(200);
    expect(response.body.data).toEqual({ deleted: true, rowsRemoved: 15 });

    const summaries = await testApp.http.get(`/api/summaries?year=2026&accountId=${CARD}`);
    expect(summaries.body.data.summaries).toEqual([]);
    const settings = await testApp.http.get('/api/settings');
    expect(settings.body.data.statementCount).toBe(2);
  });

  it('needs the exact phrase to delete everything', async () => {
    await testApp.http.post('/api/profile/delete').send({ confirm: 'yes' }).expect(400);
  });

  it('deletes everything and signs out', async () => {
    const response = await testApp.http
      .post('/api/profile/delete')
      .send({ confirm: 'delete my data' })
      .expect(200);
    expect(response.body.data.deleted.transactions).toBe(41 + 49);
    expect(response.body.data.deleted.profile).toBe(1);

    await testApp.http.get('/api/auth/me').expect(401);
  });
});
