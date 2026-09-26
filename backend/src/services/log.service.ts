import { Injectable } from '@nestjs/common';
import { pino, type Logger } from 'pino';
import { Environment } from './environment.service.js';

/**
 * Structured logging with a deliberately narrow door.
 *
 * Statement text, transaction descriptions, merchant names, emails, prompts and
 * model responses must never reach a log line. Rather than trusting every call
 * site to remember that, this service only accepts an event name plus primitive
 * fields, and scrubs anything that looks like an email or a long digit run on
 * the way out. Log provider ids, model ids, token counts, durations and counts;
 * log a user as `userIdLogPrefix(userId)`, never the id itself.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_DIGITS = /\d{7,}/g;
const MAX_FIELD_LENGTH = 200;

export function scrubLogValue(value: string): string {
  return value
    .replace(EMAIL, '[email]')
    .replace(LONG_DIGITS, '[digits]')
    .slice(0, MAX_FIELD_LENGTH);
}

export function scrubLogFields(
  fields: LogFields,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    safe[key] = typeof value === 'string' ? scrubLogValue(value) : value;
  }
  return safe;
}

/**
 * The only form of a user id that may appear in a log. Twelve hex characters is
 * enough to correlate requests and not enough to be an identifier on its own.
 */
export function userIdLogPrefix(userId: string): string {
  return userId.slice(0, 12);
}

@Injectable()
export class LogService {
  private readonly logger: Logger;

  constructor(environment: Environment) {
    this.logger = pino({
      level: environment.env.LOG_LEVEL,
      base: { service: 'cred-stats-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    });
  }

  debug(event: string, fields: LogFields = {}): void {
    this.logger.debug(scrubLogFields(fields), event);
  }

  info(event: string, fields: LogFields = {}): void {
    this.logger.info(scrubLogFields(fields), event);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.logger.warn(scrubLogFields(fields), event);
  }

  error(event: string, fields: LogFields = {}): void {
    this.logger.error(scrubLogFields(fields), event);
  }
}
