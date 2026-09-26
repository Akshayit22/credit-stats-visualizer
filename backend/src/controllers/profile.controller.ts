import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  deleteProfileSchema,
  type DeleteProfileRequest,
  type ProfileDeleted,
  type ProfileExport,
  type SessionUser,
  type SettingsView,
} from '@cred-stats/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session-cookie.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { Environment } from '../services/environment.service.js';
import { ProfileService } from '../services/profile.service.js';

@Controller()
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly environment: Environment,
  ) {}

  @Get('settings')
  settings(@CurrentUser() user: SessionUser): Promise<SettingsView> {
    return this.profile.settings(user.userId, user.email);
  }

  /** Everything held about the signed-in user, as a JSON download. */
  @Get('profile/export')
  async export(
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileExport> {
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader(
      'content-disposition',
      `attachment; filename="cred-stats-export-${date}.json"`,
    );
    return this.profile.export(user.userId);
  }

  /**
   * Deletes everything and signs out. Irreversible, so it needs the exact
   * phrase `{"confirm":"delete my data"}` in the body, not just a bare POST.
   */
  @Post('profile/delete')
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(deleteProfileSchema)) _body: DeleteProfileRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileDeleted> {
    const result = await this.profile.deleteEverything(user.userId);
    const { maxAge: _maxAge, ...cookie } = sessionCookieOptions(this.environment.isProduction);
    response.clearCookie(SESSION_COOKIE, cookie);
    return result;
  }
}
