/**
 * Loads the sample statements so the app is browsable without uploading
 * anything by hand.
 *
 *   npm run db:seed
 *
 * **Every figure here comes from a real statement.** The committed fixtures go
 * through the same ingest pipeline an upload does — the same parsers, the same
 * reconciliation, the same categorisation — so what you see on the dashboards
 * is what those statements actually said.
 *
 * Nothing is invented. There are no synthesised months, no scaled copies and no
 * filler: if a month is empty, that is because there is no statement for it.
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const { DEV_USER_ID } = await import('../src/server/auth/config');
const { ingestStatement } = await import('../src/server/domain/ingest');
const { upsertUserOnSignIn } = await import('../src/server/db/repositories/users');
const { listSummaries } = await import('../src/server/db/repositories/summaries');
const { listAccounts } = await import('../src/server/db/repositories/accounts');
const { formatMinor } = await import('../src/shared/money');

const USER_ID = DEV_USER_ID;

async function main(): Promise<void> {
  console.log(`seeding demo user ${USER_ID.slice(0, 12)}…\n`);

  await upsertUserOnSignIn({
    userId: USER_ID,
    email: 'demo@cred-stats.local',
    name: 'Demo user',
    avatarUrl: '',
  });

  const fixtures = readdirSync(resolve('fixtures'))
    .filter((name) => name.endsWith('.txt'))
    .sort();

  if (fixtures.length === 0) {
    console.error('No fixtures. Run `npm run fixtures:build` with PDFs in samples/ first.');
    process.exitCode = 1;
    return;
  }

  const years = new Set<string>();

  for (const file of fixtures) {
    const text = readFileSync(resolve('fixtures', file), 'utf8');
    const contentHash = createHash('sha256').update(text).digest('hex');
    const result = await ingestStatement({ userId: USER_ID, text, contentHash, llm: null });
    years.add(result.statement.period.slice(0, 4));

    console.log(
      `  ${result.duplicate ? 'already there' : 'ingested    '}  ${pad(file, 34)}  ` +
        `${result.statement.period}  ${String(result.statement.rowCount).padStart(3)} rows  ` +
        `${result.statement.status}`,
    );
  }

  const accounts = await listAccounts(USER_ID);
  console.log(`\n  ${accounts.length} account(s):`);
  for (const account of accounts) {
    console.log(`    ${account.displayName}  ${account.maskedNumber}`);
  }

  for (const year of [...years].sort()) {
    const summaries = await listSummaries(USER_ID, 'ALL', year);
    if (summaries.length === 0) continue;
    console.log(`\n  ${year}    spend        income       fees      cashback   rows`);
    for (const summary of summaries) {
      console.log(
        `  ${summary.period}  ${right(formatMinor(summary.spendMinor, 0), 11)}  ` +
          `${right(formatMinor(summary.incomeMinor, 0), 11)}  ` +
          `${right(formatMinor(summary.feesMinor, 0), 8)}  ` +
          `${right(formatMinor(summary.cashbackEarnedMinor, 0), 8)}  ${summary.txnCount}`,
      );
    }
  }

  console.log(
    '\nEvery figure above came from a real statement. Months with no statement stay empty —',
  );
  console.log('upload one from the app to fill one in.');
  console.log('\n`npm run dev` then open http://localhost:3000');
}

function right(value: string, width: number): string {
  return value.padStart(width, ' ');
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
