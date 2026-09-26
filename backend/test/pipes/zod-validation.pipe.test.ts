import { recategoriseSchema } from '@cred-stats/shared';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../src/filters/api-exception.js';
import { ZodValidationPipe } from '../../src/pipes/zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(recategoriseSchema);

  it('returns the parsed value with defaults applied', () => {
    expect(pipe.transform({ category: 'Groceries' })).toEqual({
      category: 'Groceries',
      applyToMerchant: true,
    });
  });

  it('rejects with a bad_request naming the field, not the value', () => {
    let caught: unknown;
    try {
      pipe.transform({ category: 'PRIYA RAMACHANDRAN' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiException);
    const exception = caught as ApiException;
    expect(exception.code).toBe('bad_request');
    expect(exception.message).toContain('category');
    expect(exception.message).not.toContain('PRIYA');
  });
});
