import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../common/request-context/request-context';
import { AppConfigService } from '../config/app-config.service';
import { toProfile } from './auth-user.loader';
import { AuthService, SessionResult } from './auth.service';
import type { AuthenticatedUser } from './auth.types';
import { AuthenticatedOnly, CurrentUser, Public } from './decorators';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { CsrfGuard } from './guards/csrf.guard';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';

const CSRF_HEADER_DOC = {
  name: 'X-Requested-With',
  required: true,
  description: 'Must be `XMLHttpRequest` (anti-CSRF, ADR-017)',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in. Returns an access token; sets the refresh-token HttpOnly cookie.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'INVALID_CREDENTIALS',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'RATE_LIMITED',
  })
  async login(
    @Body() dto: LoginDto,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.auth.login(dto.email, dto.password, ctx),
    );
  }

  @Post('refresh')
  @Public()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiHeader(CSRF_HEADER_DOC)
  @ApiOperation({
    summary: 'Rotate the refresh-token cookie and issue a new access token',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'INVALID_TOKEN',
  })
  async refresh(
    @Req() req: Request,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return this.respond(
        res,
        await this.auth.refresh(readRefreshCookie(req), ctx),
      );
    } catch (e) {
      clearRefreshCookie(res, this.config);
      throw e;
    }
  }

  @Post('logout')
  @Public() // must work with an expired access token; authorised by the cookie
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiHeader(CSRF_HEADER_DOC)
  @ApiOperation({ summary: 'Revoke the current session and clear the cookie' })
  async logout(
    @Req() req: Request,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(req), ctx);
    clearRefreshCookie(res, this.config);
  }

  @Post('logout-all')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions of the current user' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user, ctx);
    clearRefreshCookie(res, this.config);
  }

  @Get('me')
  @AuthenticatedOnly()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile, permissions and branches' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return toProfile(user);
  }

  @Post('change-password')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change own password; all sessions are revoked (sign in again)',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      user,
      dto.currentPassword,
      dto.newPassword,
      ctx,
    );
    clearRefreshCookie(res, this.config);
  }

  /** Refresh token goes ONLY into the HttpOnly cookie, never the JSON body. */
  private respond(res: Response, session: SessionResult) {
    const { refreshToken, refreshTokenExpiresAt, ...body } = session;
    setRefreshCookie(res, refreshToken, refreshTokenExpiresAt, this.config);
    return body;
  }
}
