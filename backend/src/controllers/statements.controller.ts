import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  recategoriseSchema,
  statementUploadSchema,
  type ParsedStatementResult,
  type SessionUser,
  type StatementDeleted,
  type StatementDetail,
  type StatementLibrary,
} from '@cred-stats/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiException } from '../filters/api-exception.js';
import { statementIdParam, txnIdParam } from '../pipes/params.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { IngestService } from '../services/ingest.service.js';
import { StatementsService } from '../services/statements.service.js';

/** Twenty uploads a minute per address — each one can cost a model call. */
const UPLOAD_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly ingest: IngestService,
    private readonly statements: StatementsService,
  ) {}

  /** The statement library, with the accounts that name each statement. */
  @Get()
  library(@CurrentUser() user: SessionUser): Promise<StatementLibrary> {
    return this.statements.library(user.userId);
  }

  /**
   * Upload. The body is extracted, redacted text — never a PDF, never the
   * password. 201 for a new statement, 200 when it was already uploaded.
   */
  @Post()
  @Throttle(UPLOAD_LIMIT)
  async upload(
    @CurrentUser() user: SessionUser,
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ParsedStatementResult> {
    if (!request.is('application/json')) {
      throw ApiException.badRequest(
        'Send the extracted text as JSON. PDF bytes are never uploaded.',
      );
    }
    const payload = new ZodValidationPipe(statementUploadSchema).transform(body);

    const result = await this.ingest.ingest({
      userId: user.userId,
      text: payload.text,
      contentHash: payload.contentHash,
    });
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Get(':statementId')
  detail(
    @CurrentUser() user: SessionUser,
    @Param('statementId', statementIdParam) statementId: string,
  ): Promise<StatementDetail> {
    return this.statements.detail(user.userId, statementId);
  }

  @Delete(':statementId')
  delete(
    @CurrentUser() user: SessionUser,
    @Param('statementId', statementIdParam) statementId: string,
  ): Promise<StatementDeleted> {
    return this.statements.delete(user.userId, statementId);
  }

  /** Move one row to another category, and by default remember it for the merchant. */
  @Patch(':statementId/transactions/:txnId')
  recategorise(
    @CurrentUser() user: SessionUser,
    @Param('statementId', statementIdParam) statementId: string,
    @Param('txnId', txnIdParam) txnId: string,
    @Body(new ZodValidationPipe(recategoriseSchema)) body: z.output<typeof recategoriseSchema>,
  ): Promise<{ updated: true }> {
    return this.statements.recategorise(user.userId, statementId, txnId, body);
  }
}
