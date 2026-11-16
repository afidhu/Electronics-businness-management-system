import { isValidTimeZone, validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://user:secret-pass@localhost:5432/x_test_db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applies the approved business defaults (TZS, Africa/Dar_es_Salaam)', () => {
    const env = validateEnv({ ...base });
    expect(env.CURRENCY).toBe('TZS');
    expect(env.BUSINESS_TIMEZONE).toBe('Africa/Dar_es_Salaam');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('log');
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('enables Swagger by default outside production and disables it in production', () => {
    expect(validateEnv({ ...base }).SWAGGER_ENABLED).toBe(true);
    expect(
      validateEnv({ ...base, NODE_ENV: 'production' }).SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })
        .SWAGGER_ENABLED,
    ).toBe(true);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an unknown timezone', () => {
    expect(() =>
      validateEnv({ ...base, BUSINESS_TIMEZONE: 'Mars/Olympus' }),
    ).toThrow(/BUSINESS_TIMEZONE/);
  });

  it('rejects an invalid currency code and NODE_ENV', () => {
    expect(() => validateEnv({ ...base, CURRENCY: 'tzs' })).toThrow(/CURRENCY/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('never includes secret values in the error message', () => {
    try {
      validateEnv({ ...base, PORT: 'not-a-port' });
      fail('expected validation to fail');
    } catch (e) {
      expect((e as Error).message).toMatch(/PORT/);
      expect((e as Error).message).not.toContain('secret-pass');
    }
  });

  it('does not define any tax setting (tax is business data, ADR-012)', () => {
    const keys = Object.keys(validateEnv({ ...base }));
    expect(keys.some((k) => /TAX|VAT/i.test(k))).toBe(false);
  });
});

describe('validateEnv — authentication settings (Module 2)', () => {
  it('applies the approved token lifetimes and brute-force defaults', () => {
    const env = validateEnv({ ...base });
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900); // 15 minutes
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(env.SESSION_MAX_LIFETIME_DAYS).toBe(30);
    expect(env.LOGIN_RATE_LIMIT).toBe(5);
    expect(env.LOGIN_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(env.LOGIN_LOCKOUT_MINUTES).toBe(15);
    expect(env.TRUST_PROXY).toBe(0);
  });

  it('requires a JWT secret of at least 32 characters, without echoing it', () => {
    const { JWT_ACCESS_SECRET: _omit, ...withoutSecret } = base;
    expect(() => validateEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
    try {
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'too-short-secret' });
      fail('expected validation to fail');
    } catch (e) {
      expect((e as Error).message).toMatch(/at least 32/);
      expect((e as Error).message).not.toContain('too-short-secret');
    }
  });

  it('rejects a refresh-token lifetime longer than the absolute session', () => {
    expect(() =>
      validateEnv({
        ...base,
        REFRESH_TOKEN_TTL_DAYS: '14',
        SESSION_MAX_LIFETIME_DAYS: '10',
      }),
    ).toThrow(/SESSION_MAX_LIFETIME_DAYS/);
  });

  it('defaults COOKIE_SECURE to true in production and refuses false there', () => {
    expect(validateEnv({ ...base }).COOKIE_SECURE).toBe(false);
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(
      true,
    );
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('Africa/Dar_es_Salaam')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Nowhere/Land')).toBe(false);
  });
});
