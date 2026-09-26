import { describe, expect, it } from 'vitest';
import { scrubLogFields, userIdLogPrefix } from '../../src/services/log.service.js';

describe('what the logger lets through', () => {
  it('replaces anything shaped like an email', () => {
    expect(scrubLogFields({ note: 'from priya@example.com' })).toEqual({ note: 'from [email]' });
  });

  it('replaces long digit runs — account numbers, references, phones', () => {
    expect(scrubLogFields({ ref: 'A/C 033325225226993' })).toEqual({ ref: 'A/C [digits]' });
  });

  it('keeps short numbers and non-string fields as they are', () => {
    expect(scrubLogFields({ rows: 15, ok: true, missing: null, year: '2026' })).toEqual({
      rows: 15,
      ok: true,
      missing: null,
      year: '2026',
    });
  });

  it('drops undefined fields and truncates long strings', () => {
    const scrubbed = scrubLogFields({ gone: undefined, long: 'a'.repeat(500) });
    expect('gone' in scrubbed).toBe(false);
    expect(String(scrubbed.long)).toHaveLength(200);
  });

  it('logs a user as a twelve-character prefix', () => {
    expect(userIdLogPrefix('0123456789abcdef0123456789abcdef')).toBe('0123456789ab');
  });
});
