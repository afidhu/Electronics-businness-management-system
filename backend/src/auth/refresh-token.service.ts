import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashRefreshToken, invalidToken, TokenService } from './token.service';

/** A newly issued refresh token and when its cookie must expire. */
export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export type RevokeReason =
  | 'ROTATED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'REUSE_DETECTED'
  | 'PASSWORD_CHANGED'
  | 'USER_DEACTIVATED';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Refresh-token sessions (ADR-017): opaque tokens stored as SHA-256 hashes,
 * rotated on every use. Presenting an already-rotated token is treated as
 * theft: the whole session family is revoked.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** Start a new session family (login). Returns the raw token for the cookie. */
  async issue(
    userId: string,
    db: Db = this.prisma,
  ): Promise<IssuedRefreshToken> {
    const { token, tokenHash } = this.tokens.generateRefreshToken();
    const sessionExpiresAt = this.tokens.sessionExpiry();
    const expiresAt = this.tokens.refreshTokenExpiry(sessionExpiresAt);
    await db.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId: randomUUID(),
        expiresAt,
        sessionExpiresAt,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Exchange a valid refresh token for a new one in the same family.
   * Returns the user ID and the new raw token.
   */
  async rotate(
    rawToken: unknown,
    context: RequestContext,
  ): Promise<IssuedRefreshToken & { userId: string }> {
    if (!this.tokens.isWellFormedRefreshToken(rawToken)) throw invalidToken();
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      include: { user: { select: { isActive: true } } },
    });
    if (!current) throw invalidToken();

    if (current.revokedAt) {
      if (current.revokedReason === 'ROTATED') {
        await this.handleReuse(current.familyId, current.userId, context);
      }
      throw invalidToken();
    }
    const now = new Date();
    if (
      current.expiresAt <= now ||
      current.sessionExpiresAt <= now ||
      !current.user.isActive
    ) {
      throw invalidToken();
    }

    const { token, tokenHash } = this.tokens.generateRefreshToken();
    // Same absolute session end as the original login (never extended).
    const expiresAt = this.tokens.refreshTokenExpiry(
      current.sessionExpiresAt,
      now,
    );
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update: only one concurrent request can rotate this token.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });
      if (count !== 1) return false;
      const next = await tx.refreshToken.create({
        data: {
          userId: current.userId,
          tokenHash,
          familyId: current.familyId,
          expiresAt,
          sessionExpiresAt: current.sessionExpiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: current.id },
        data: { replacedById: next.id },
      });
      return true;
    });

    if (!rotated) {
      // Lost a race with another use of the same token: treat as reuse.
      await this.handleReuse(current.familyId, current.userId, context);
      throw invalidToken();
    }
    return { userId: current.userId, token, expiresAt };
  }

  /** Revoke the session family of a token (logout). Unknown tokens are ignored. */
  async revokeFamilyOf(
    rawToken: unknown,
    reason: RevokeReason,
  ): Promise<string | null> {
    if (!this.tokens.isWellFormedRefreshToken(rawToken)) return null;
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      select: { familyId: true, userId: true },
    });
    if (!token) return null;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return token.userId;
  }

  /** Revoke every active session of a user (logout-all, password change, deactivation). */
  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    db: Db = this.prisma,
  ): Promise<number> {
    const { count } = await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  private async handleReuse(
    familyId: string,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
    });
    this.logger.warn(
      `Refresh token reuse detected; session family revoked (requestId=${context.requestId})`,
    );
    await this.audit.record({
      action: 'auth.refresh.reuse_detected',
      entityType: 'User',
      entityId: userId,
      actorId: userId,
      metadata: { familyId, revokedTokens: count },
      context,
    });
  }
}
