import { createHash } from 'node:crypto';

/**
 * Our user id is a stable hash of the Google `sub`, never the `sub` itself, so
 * the provider's identifier is not what ends up in every partition key and in
 * every log line.
 */
export function userIdFromSubject(subject: string): string {
  return createHash('sha256').update(`cred-stats:${subject}`).digest('hex').slice(0, 32);
}

/**
 * The only form of a user id that may appear in a log. Twelve hex characters is
 * enough to correlate requests and not enough to be an identifier on its own.
 */
export function userIdLogPrefix(userId: string): string {
  return userId.slice(0, 12);
}
