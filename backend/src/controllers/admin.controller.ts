import { Controller, Get } from '@nestjs/common';
import type { AdminOverview, SessionUser } from '@cred-stats/shared';
import { AdminOnly } from '../auth/admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminService } from '../services/admin.service.js';

@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Every user, their last sign-in, and statement counts per bank. */
  @Get('overview')
  overview(@CurrentUser() user: SessionUser): Promise<AdminOverview> {
    return this.admin.overview(user.userId);
  }
}
