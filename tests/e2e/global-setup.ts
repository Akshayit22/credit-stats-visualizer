import { execFileSync } from 'node:child_process';

/**
 * Reset and reseed before every browser run.
 *
 * The two specs want opposite things from the database: the chart tests need
 * the sample statements present, and the upload tests need them absent so an
 * upload is not a duplicate. Whichever ran last used to decide what the other
 * found. Seeding here makes each run start from the same known state, and the
 * upload spec clears what it needs in its own `beforeEach`.
 *
 * Needs DynamoDB Local. Without it the run fails here, loudly, rather than
 * ten confusing assertion failures later.
 */
export default function globalSetup(): void {
  const run = (script: string, args: string[] = []) =>
    execFileSync('npm', ['run', script, ...args], {
      stdio: 'pipe',
      env: { ...process.env, LLM_PROVIDER: 'mock' },
    });

  try {
    run('db:create', ['--', '--drop']);
    run('db:seed');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Could not reset the database for the browser tests. ' +
        'Is DynamoDB Local up? `npm run db:up`\n' +
        detail.split('\n').slice(0, 4).join('\n'),
    );
  }
}
