import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  MaxLength,
  MinLength,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** True when `tz` is an IANA timezone the runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const toNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === '' ? undefined : Number(value);

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return value; // left as-is so @IsBoolean reports it
};

/**
 * Environment contract for the API (ADR-010, ADR-011).
 * Secrets are read from the environment only; never hardcode them.
 * Tax rates are deliberately NOT configured here — they are business data
 * managed in the application (ADR-012).
 */
export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL!: string;

  /** Comma-separated list of browser origins allowed by CORS. */
  @IsString()
  CORS_ORIGINS = 'http://localhost:5173';

  /** IANA timezone used to display times and derive business dates. */
  @IsString()
  BUSINESS_TIMEZONE = 'Africa/Dar_es_Salaam';

  /** ISO 4217 code of the single operating currency. */
  @Matches(/^[A-Z]{3}$/, { message: 'CURRENCY must be an ISO 4217 code' })
  CURRENCY = 'TZS';

  /** Trading name printed on receipts. */
  @IsString()
  @MaxLength(100)
  BUSINESS_NAME = 'ElectroCore Electronics';

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevelName = 'log';

  /** Defaults to enabled outside production. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;

  // ---- Authentication (ADR-017, ADR-018) ----

  /** HMAC secret for access tokens. Generate with `openssl rand -base64 48`. */
  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  @Transform(toNumber)
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(30)
  REFRESH_TOKEN_TTL_DAYS = 7;

  /** Absolute maximum session length; rotation never extends past it (ADR-021). */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(365)
  SESSION_MAX_LIFETIME_DAYS = 30;

  /** Secure flag on the refresh cookie. Defaults to true in production (required there). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE?: boolean;

  /** Number of reverse-proxy hops to trust for the client IP (0 = none). */
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY = 0;

  /** Login requests allowed per client IP per window (rate limiting). */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  LOGIN_RATE_LIMIT = 5;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  LOGIN_RATE_WINDOW_SECONDS = 60;

  /** Consecutive failed logins before the account is temporarily locked. */
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  LOGIN_MAX_FAILED_ATTEMPTS = 5;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  LOGIN_LOCKOUT_MINUTES = 15;
}

/** ConfigModule `validate` hook: fail fast on missing/invalid configuration. */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });

  if (!isValidTimeZone(env.BUSINESS_TIMEZONE)) {
    errors.push({
      property: 'BUSINESS_TIMEZONE',
      constraints: { timeZone: 'BUSINESS_TIMEZONE must be an IANA timezone' },
      children: [],
    });
  }

  if (errors.length > 0) {
    // Report variable names and rules only — never values (they may be secrets).
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
      )
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }

  env.SWAGGER_ENABLED ??= env.NODE_ENV !== 'production';
  env.COOKIE_SECURE ??= env.NODE_ENV === 'production';
  if (env.REFRESH_TOKEN_TTL_DAYS > env.SESSION_MAX_LIFETIME_DAYS) {
    throw new Error(
      'Invalid environment configuration:\n  REFRESH_TOKEN_TTL_DAYS: must not exceed SESSION_MAX_LIFETIME_DAYS',
    );
  }
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error(
      'Invalid environment configuration:\n  COOKIE_SECURE: must be true in production',
    );
  }
  return env;
}
