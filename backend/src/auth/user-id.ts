import { createHash } from 'node:crypto';

/**
 * Our user id is a stable hash of the sign-in provider's subject, never the
 * subject itself, so the provider's identifier is not what ends up on every
 * document and in every log line.
 */
export function userIdFromSubject(subject: string): string {
  return createHash('sha256').update(`cred-stats:${subject}`).digest('hex').slice(0, 32);
}

/**
 * The fixed identity the demo sign-in uses. A fixed subject means the seeded
 * demo data always belongs to it.
 */
export const DEMO_USER = {
  subject: 'dev-login',
  email: 'demo@cred-stats.local',
  name: 'Demo user',
} as const;

export const DEMO_USER_ID = userIdFromSubject(DEMO_USER.subject);
