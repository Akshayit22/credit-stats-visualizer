import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  viewQuerySchema,
  type AccountView,
  type OverviewView,
  type SessionUser,
  type ViewQuery,
  type WorkspaceView,
} from '@cred-stats/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { accountIdParam, accountScreenParam } from '../pipes/params.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { type AccountScreen, ViewsService } from '../services/views.service.js';

const viewQuery = new ZodValidationPipe(viewQuerySchema);

/**
 * One endpoint per screen, each returning everything that screen draws.
 * `?mode=month&period=2026-07` or `?mode=year&year=2026` pick the months.
 */
@Controller('views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  /** The sidebar and the frame around every screen. */
  @Get('workspace')
  workspace(@CurrentUser() user: SessionUser): Promise<WorkspaceView> {
    return this.views.workspace(user.userId);
  }

  @Get('overview')
  overview(
    @CurrentUser() user: SessionUser,
    @Query(viewQuery) query: ViewQuery,
  ): Promise<OverviewView> {
    return this.views.overview(user.userId, query);
  }

  /** `/views/card/:accountId`, `/views/savings/:accountId`, `/views/cashback/:accountId`. */
  @Get(':screen/:accountId')
  account(
    @CurrentUser() user: SessionUser,
    @Param('screen', accountScreenParam) screen: AccountScreen,
    @Param('accountId', accountIdParam) accountId: string,
    @Query(viewQuery) query: ViewQuery,
  ): Promise<AccountView> {
    return this.views.account(user.userId, accountId, screen, query);
  }
}
