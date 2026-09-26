import { Injectable } from '@nestjs/common';
import { type Env, environmentProblems, environmentSchema } from '../environment.js';

/**
 * The validated environment. Inject this instead of reading `process.env`.
 *
 * Validation failures name the variable and the rule, never the value — a
 * secret pasted into the wrong variable must not end up in a boot log.
 */
@Injectable()
export class Environment {
  readonly env: Env;

  constructor() {
    this.env = Environment.parse(process.env);
  }

  static parse(source: Record<string, string | undefined>): Env {
    const result = environmentSchema.safeParse(source);
    if (!result.success) {
      const problems = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Environment validation failed — ${problems}`);
    }
    const problems = environmentProblems(result.data);
    if (problems.length > 0) {
      throw new Error(`Environment validation failed — ${problems.join('; ')}`);
    }
    return result.data;
  }

  /** The demo sign-in: on only when asked for, and never in production. */
  get devLoginEnabled(): boolean {
    return this.env.CRED_STATS_DEV_LOGIN && !this.isProduction;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}
