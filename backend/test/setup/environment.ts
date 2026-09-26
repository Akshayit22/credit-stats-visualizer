import { randomUUID } from 'node:crypto';

/**
 * Runs before every test file. A fresh database name per file keeps parallel
 * files apart; `silent` keeps the output to test results.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_DB = `test-${randomUUID().slice(0, 8)}`;
process.env.LLM_PROVIDER = 'mock';
process.env.CRED_STATS_SESSION_SECRET = 'test-session-secret-that-is-long-enough-000';
process.env.CRED_STATS_DEV_LOGIN = 'true';
