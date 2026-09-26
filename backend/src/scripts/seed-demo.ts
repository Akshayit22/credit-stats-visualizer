/**
 * Loads the committed statements for the demo user, so the app is browsable
 * without uploading anything by hand.
 *
 *   npm run db:seed          (from the repository root)
 *
 * **Every figure comes from a real statement.** The fixtures go through the
 * same ingest pipeline an upload does — the same parsers, reconciliation and
 * categorisation — so what the dashboards show is what those statements said.
 * Nothing is invented: a month with no statement stays empty.
 *
 * Sign in with the demo user (CRED_STATS_DEV_LOGIN=true) to see the data.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ALL_ACCOUNTS_SCOPE, formatMinor } from '@cred-stats/shared';
import { AppModule } from '../app.module.js';
import { DEMO_USER, DEMO_USER_ID } from '../auth/user-id.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { SummariesRepository } from '../repositories/summaries.repository.js';
import { UsersRepository } from '../repositories/users.repository.js';
import { IngestService } from '../services/ingest.service.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);

// The table below is the output; the API's own log lines would bury it.
process.env.LOG_LEVEL ??= 'error';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

try {
  console.log(`seeding the demo user ${DEMO_USER_ID.slice(0, 12)}…\n`);

  await app.get(UsersRepository).upsertOnSignIn({
    userId: DEMO_USER_ID,
    email: DEMO_USER.email,
    name: DEMO_USER.name,
    avatarUrl: '',
  });

  const files = readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.txt'))
    .sort();
  if (files.length === 0) {
    throw new Error('No fixtures in backend/fixtures. Run `npm run fixtures:build` first.');
  }

  const ingest = app.get(IngestService);
  const years = new Set<string>();

  for (const file of files) {
    const text = readFileSync(new URL(file, FIXTURES), 'utf8');
    const result = await ingest.ingest({
      userId: DEMO_USER_ID,
      text,
      contentHash: createHash('sha256').update(text).digest('hex'),
    });
    years.add(result.statement.period.slice(0, 4));
    console.log(
      `  ${result.duplicate ? 'already there' : 'ingested    '}  ${file.padEnd(34)}  ` +
        `${result.statement.period}  ${String(result.statement.rowCount).padStart(3)} rows  ` +
        result.statement.status,
    );
  }

  const accounts = await app.get(AccountsRepository).list(DEMO_USER_ID);
  console.log(`\n  ${accounts.length} account(s):`);
  for (const account of accounts)
    console.log(`    ${account.displayName}  ${account.maskedNumber}`);

  const summaries = app.get(SummariesRepository);
  for (const year of [...years].sort()) {
    const months = await summaries.list(DEMO_USER_ID, ALL_ACCOUNTS_SCOPE, year);
    if (months.length === 0) continue;
    console.log(`\n  ${year}    spend        income       fees      cashback   rows`);
    for (const month of months) {
      console.log(
        `  ${month.period}  ${formatMinor(month.spendMinor, 0).padStart(11)}  ` +
          `${formatMinor(month.incomeMinor, 0).padStart(11)}  ` +
          `${formatMinor(month.feesMinor, 0).padStart(8)}  ` +
          `${formatMinor(month.cashbackEarnedMinor, 0).padStart(8)}  ${month.txnCount}`,
      );
    }
  }

  console.log(
    '\nEvery figure above came from a real statement. Sign in as the demo user to see it.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
