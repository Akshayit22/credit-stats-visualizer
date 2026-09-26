import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from '../filters/api-exception.js';

/**
 * Validates a body, query or param against a zod schema and hands the handler
 * the parsed value (with defaults applied).
 *
 *   @Body(new ZodValidationPipe(recategoriseSchema)) body: RecategoriseBody
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw ApiException.badRequest(describeZodError(result.error));
    return result.data;
  }
}

/**
 * Field paths only — never the offending values, which may be statement text.
 */
export function describeZodError(error: z.ZodError): string {
  const paths = error.issues
    .map((issue) => issue.path.join('.') || '(root)')
    .filter((path, index, all) => all.indexOf(path) === index)
    .slice(0, 6);
  return `Request did not match the expected shape: ${paths.join(', ')}`;
}
