import { Injectable, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables, LOG_LEVELS, NodeEnv } from './env.validation';

/** Typed, read-only access to validated configuration. */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  get nodeEnv(): NodeEnv {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get corsOrigins(): string[] {
    return this.config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get businessTimeZone(): string {
    return this.config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  get currency(): string {
    return this.config.get('CURRENCY', { infer: true });
  }

  get swaggerEnabled(): boolean {
    return this.config.get('SWAGGER_ENABLED', { infer: true }) ?? false;
  }

  get jwtAccessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  get jwtAccessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get refreshTokenTtlDays(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  get sessionMaxLifetimeDays(): number {
    return this.config.get('SESSION_MAX_LIFETIME_DAYS', { infer: true });
  }

  get cookieSecure(): boolean {
    return this.config.get('COOKIE_SECURE', { infer: true }) ?? false;
  }

  get trustProxy(): number {
    return this.config.get('TRUST_PROXY', { infer: true });
  }

  get loginRateLimit(): { limit: number; windowSeconds: number } {
    return {
      limit: this.config.get('LOGIN_RATE_LIMIT', { infer: true }),
      windowSeconds: this.config.get('LOGIN_RATE_WINDOW_SECONDS', {
        infer: true,
      }),
    };
  }

  get loginLockout(): { maxFailedAttempts: number; lockoutMinutes: number } {
    return {
      maxFailedAttempts: this.config.get('LOGIN_MAX_FAILED_ATTEMPTS', {
        infer: true,
      }),
      lockoutMinutes: this.config.get('LOGIN_LOCKOUT_MINUTES', { infer: true }),
    };
  }

  /** Nest log levels at or above the configured LOG_LEVEL. */
  get logLevels(): LogLevel[] {
    const level = this.config.get('LOG_LEVEL', { infer: true });
    return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1) as LogLevel[];
  }
}
