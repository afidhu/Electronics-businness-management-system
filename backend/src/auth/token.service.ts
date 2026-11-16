import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AppConfigService } from '../config/app-config.service';
import type { AccessTokenClaims } from './auth.types';

export const JWT_ISSUER = 'electrocore-ebms';
export const JWT_AUDIENCE = 'electrocore-ebms-api';

export function invalidToken(
  message = 'Invalid or expired token',
): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_TOKEN,
    message,
  );
}

/** SHA-256 hex of a high-entropy refresh token (what the DB stores). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Opaque refresh tokens: 256 random bits, base64url (43 chars). */
const REFRESH_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  /** Short-lived HS256 access token (default 15 minutes, ADR-017). */
  signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: 'access' },
      {
        secret: this.config.jwtAccessSecret,
        expiresIn: this.config.jwtAccessTtlSeconds,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  /** Verifies signature, algorithm, expiry, issuer, audience and token type. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.jwtAccessSecret,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch {
      throw invalidToken();
    }
    if (claims.typ !== 'access' || typeof claims.sub !== 'string') {
      throw invalidToken();
    }
    return claims;
  }

  generateRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: hashRefreshToken(token) };
  }

  isWellFormedRefreshToken(token: unknown): token is string {
    return typeof token === 'string' && REFRESH_TOKEN_FORMAT.test(token);
  }

  /** Absolute end of a new login session (default 30 days, ADR-021). */
  sessionExpiry(from = new Date()): Date {
    return new Date(
      from.getTime() + this.config.sessionMaxLifetimeDays * 86_400_000,
    );
  }

  /**
   * Expiry of a new refresh token: 7 days from now, but never later than the
   * session's absolute expiry — rotation cannot extend a session.
   */
  refreshTokenExpiry(sessionExpiresAt: Date, from = new Date()): Date {
    const sliding =
      from.getTime() + this.config.refreshTokenTtlDays * 86_400_000;
    return new Date(Math.min(sliding, sessionExpiresAt.getTime()));
  }
}
