import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { HealthStatus } from '@cred-stats/shared';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { MongoClientManager } from '../managers/mongo-client.manager.js';
import { Environment } from '../services/environment.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly mongo: MongoClientManager,
    private readonly environment: Environment,
  ) {}

  /**
   * Liveness plus the one dependency that matters: can we reach MongoDB?
   * 200 when it answers, 503 when it does not, so it doubles as Render's
   * health check and as a readiness gate for `curl -fsS`.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthStatus> {
    const databaseUp = await this.mongo.ping();
    if (!databaseUp) response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'ok' : 'unreachable',
      llmProvider: this.environment.env.LLM_PROVIDER,
    };
  }
}
