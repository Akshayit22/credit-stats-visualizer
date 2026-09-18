/**
 * Structured logging with a deliberately narrow door.
 *
 * Statement text, transaction descriptions, merchant names, emails, prompts and
 * model responses must never reach a log line. Rather than trusting every call
 * site to remember that, this module only accepts primitive fields and strips
 * anything that looks like an email or a long digit run on the way out.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

type Level = 'debug' | 'info' | 'warn' | 'error';

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_DIGITS = /\d{7,}/g;

function scrub(value: string): string {
  return value.replace(EMAIL, '[email]').replace(LONG_DIGITS, '[digits]');
}

function emit(level: Level, event: string, fields: LogFields = {}): void {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    safe[key] = typeof value === 'string' ? scrub(value).slice(0, 200) : value;
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...safe,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (process.env.NODE_ENV !== 'test') console.warn(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => {
    if (process.env.NODE_ENV === 'production') return;
    emit('debug', event, fields);
  },
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
