import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { RequestContext } from '../common/request-context/request-context';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTH_USER_SELECT,
  AuthUserLoader,
  toAuthenticatedUser,
  toProfile,
} from './auth-user.loader';
import type { AuthenticatedUser } from './auth.types';
import { PasswordService } from './password.service';
import {
  IssuedRefreshToken,
  RefreshTokenService,
} from './refresh-token.service';
import { invalidToken, TokenService } from './token.service';

export interface SessionResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: ReturnType<typeof toProfile>;
  /** Raw refresh token — placed in the HttpOnly cookie, never in the body. */
  refreshToken: string;
  /** When the refresh token (and therefore the cookie) expires. */
  refreshTokenExpiresAt: Date;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function invalidCredentials(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password',
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly users: AuthUserLoader,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * US-01 / FR-AUTH-01. Every failure returns the same generic 401 so the
   * response does not reveal whether an account exists, is inactive or locked.
   */
  async login(
    email: string,
    password: string,
    context: RequestContext,
  ): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(email) },
      select: {
        ...AUTH_USER_SELECT,
        passwordHash: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      await this.passwords.verifyAgainstDummy(password); // equalise timing
      await this.recordFailure(null, 'UNKNOWN_EMAIL', context);
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.passwords.verifyAgainstDummy(password);
      await this.recordFailure(user.id, 'ACCOUNT_LOCKED', context);
      throw invalidCredentials();
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, password);
    if (!passwordOk) {
      await this.registerFailedAttempt(user.id, context);
      throw invalidCredentials();
    }
    if (!user.isActive) {
      await this.recordFailure(user.id, 'INACTIVE', context);
      throw invalidCredentials();
    }

    const refreshToken = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      });
      const token = await this.refreshTokens.issue(user.id, tx);
      await this.audit.record(
        {
          action: 'auth.login.succeeded',
          entityType: 'User',
          entityId: user.id,
          actorId: user.id,
          context,
        },
        tx,
      );
      return token;
    });

    return this.buildSession(toAuthenticatedUser(user), refreshToken);
  }

  /** Rotate the refresh token and issue a new access token. */
  async refresh(
    rawToken: unknown,
    context: RequestContext,
  ): Promise<SessionResult> {
    const { userId, ...issued } = await this.refreshTokens.rotate(
      rawToken,
      context,
    );
    const user = await this.users.load(userId);
    if (!user) {
      await this.refreshTokens.revokeAllForUser(userId, 'USER_DEACTIVATED');
      throw invalidToken();
    }
    return this.buildSession(user, issued);
  }

  /** Revoke the current session (cookie). Idempotent; works with an expired access token. */
  async logout(rawToken: unknown, context: RequestContext): Promise<void> {
    const userId = await this.refreshTokens.revokeFamilyOf(rawToken, 'LOGOUT');
    if (userId) {
      await this.audit.record({
        action: 'auth.logout',
        entityType: 'User',
        entityId: userId,
        actorId: userId,
        context,
      });
    }
  }

  /** Revoke every session of the current user (all devices). */
  async logoutAll(
    user: AuthenticatedUser,
    context: RequestContext,
  ): Promise<void> {
    const revoked = await this.refreshTokens.revokeAllForUser(
      user.id,
      'LOGOUT_ALL',
    );
    await this.audit.record({
      action: 'auth.logout_all',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      metadata: { revokedSessions: revoked },
      context,
    });
  }

  /**
   * Change own password. Revokes all sessions and invalidates existing access
   * tokens (via passwordChangedAt): the user must sign in again.
   */
  async changePassword(
    user: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!(await this.passwords.verify(row.passwordHash, currentPassword))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_CREDENTIALS,
        'Current password is incorrect',
      );
    }
    if (currentPassword === newPassword) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WEAK_PASSWORD,
        'New password must differ from the current password',
      );
    }
    this.passwords.assertAcceptable(newPassword, { email: user.email });
    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await this.refreshTokens.revokeAllForUser(
        user.id,
        'PASSWORD_CHANGED',
        tx,
      );
      await this.audit.record(
        {
          action: 'auth.password.changed',
          entityType: 'User',
          entityId: user.id,
          actorId: user.id,
          context,
        },
        tx,
      );
    });
  }

  private async buildSession(
    user: AuthenticatedUser,
    refresh: IssuedRefreshToken,
  ): Promise<SessionResult> {
    return {
      accessToken: await this.tokens.signAccessToken(user.id),
      tokenType: 'Bearer',
      expiresIn: this.config.jwtAccessTtlSeconds,
      user: toProfile(user),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  /** Increment the failure counter atomically; lock the account at the threshold. */
  private async registerFailedAttempt(
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    const { maxFailedAttempts, lockoutMinutes } = this.config.loginLockout;
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    await this.recordFailure(userId, 'WRONG_PASSWORD', context);

    if (failedLoginAttempts >= maxFailedAttempts) {
      const lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil, failedLoginAttempts: 0 },
      });
      await this.audit.record({
        action: 'auth.account.locked',
        entityType: 'User',
        entityId: userId,
        actorId: userId,
        metadata: {
          lockedUntil: lockedUntil.toISOString(),
          afterFailedAttempts: failedLoginAttempts,
        },
        context,
      });
    }
  }

  private recordFailure(
    userId: string | null,
    reason: 'UNKNOWN_EMAIL' | 'WRONG_PASSWORD' | 'INACTIVE' | 'ACCOUNT_LOCKED',
    context: RequestContext,
  ): Promise<void> {
    // The attempted email is not stored for unknown accounts (minimal personal data).
    return this.audit.record({
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: userId,
      actorId: userId,
      metadata: { reason },
      context,
    });
  }
}
