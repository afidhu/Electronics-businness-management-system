import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sanitizeMetadata } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AppConfigService } from '../config/app-config.service';
import type { AuthenticatedUser } from './auth.types';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_ANY_PERMISSION_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './decorators';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { ARGON2ID, PasswordService } from './password.service';
import { readRefreshCookie } from './refresh-cookie';
import { hashRefreshToken, TokenService } from './token.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('pins the Argon2id algorithm id (const enum Algorithm.Argon2id === 2)', () => {
    expect(ARGON2ID).toBe(2); // the "$argon2id$" prefix below proves the mapping
  });

  it('hashes with Argon2id and verifies', async () => {
    const h = await svc.hash('Correct-Horse-Battery-9');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(svc.verify(h, 'Correct-Horse-Battery-9')).resolves.toBe(true);
    await expect(svc.verify(h, 'wrong')).resolves.toBe(false);
    await expect(svc.verify('not-a-hash', 'x')).resolves.toBe(false);
    await expect(svc.verifyAgainstDummy('x')).resolves.toBe(false);
  });

  it.each([
    ['short', /at least 12/],
    ['x'.repeat(129), /at most 128/],
    ['aaaaaaaaaaaaaa', /repeat/],
    ['john.smith-2026!', /email name/],
  ])('rejects %p', (pw, msg) => {
    try {
      svc.assertAcceptable(pw, { email: 'john.smith@example.com' });
      fail('expected rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect(JSON.stringify((e as AppException).details)).toMatch(msg);
    }
  });

  it('accepts a long passphrase', () => {
    expect(() => svc.assertAcceptable('Correct-Horse-Battery-9')).not.toThrow();
  });
});

describe('refresh tokens', () => {
  const tokens = new TokenService(
    {} as never,
    { refreshTokenTtlDays: 7, sessionMaxLifetimeDays: 30 } as AppConfigService,
  );

  it('are 256-bit base64url values stored as SHA-256 hex', () => {
    const { token, tokenHash } = tokens.generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashRefreshToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.generateRefreshToken().token).not.toBe(token);
  });

  it('validates format before any DB lookup', () => {
    expect(tokens.isWellFormedRefreshToken('a'.repeat(43))).toBe(true);
    for (const bad of [
      undefined,
      '',
      'short',
      'a'.repeat(44),
      'a'.repeat(42) + '!',
    ]) {
      expect(tokens.isWellFormedRefreshToken(bad)).toBe(false);
    }
  });

  it('expire after 7 days while the 30-day session has time left', () => {
    const from = new Date('2026-11-16T00:00:00Z');
    const session = tokens.sessionExpiry(from);
    expect(session.toISOString()).toBe('2026-12-16T00:00:00.000Z'); // 30 days
    expect(tokens.refreshTokenExpiry(session, from).toISOString()).toBe(
      '2026-11-23T00:00:00.000Z',
    );
  });

  it('never outlive the absolute session end (rotation cannot extend it)', () => {
    const session = new Date('2026-12-16T00:00:00Z');
    const lateRotation = new Date('2026-12-14T00:00:00Z'); // 2 days left
    expect(tokens.refreshTokenExpiry(session, lateRotation).toISOString()).toBe(
      session.toISOString(),
    );
  });

  it('cookie reader extracts only ebms_refresh', () => {
    const req = (cookie?: string) => ({ headers: { cookie } }) as Request;
    expect(readRefreshCookie(req('a=1; ebms_refresh=abc; b=2'))).toBe('abc');
    expect(readRefreshCookie(req('ebms_refreshX=abc'))).toBeUndefined();
    expect(readRefreshCookie(req())).toBeUndefined();
  });
});

describe('audit metadata sanitising', () => {
  it('drops password/token/secret/hash keys at any depth', () => {
    expect(
      sanitizeMetadata({
        email: 'a@b.c',
        password: 'p',
        newPassword: 'p',
        nested: {
          refreshToken: 't',
          passwordHash: 'h',
          keep: 1,
          list: [{ secret: 's', ok: true }],
        },
      }),
    ).toEqual({ email: 'a@b.c', nested: { keep: 1, list: [{ ok: true }] } });
  });
});

function httpContext(req: unknown, meta: Record<string, unknown> = {}) {
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Fixture {},
  } as unknown as ExecutionContext;
  return { reflector, ctx };
}

const user = (permissions: string[]): AuthenticatedUser => ({
  id: 'u1',
  email: 'u@test',
  fullName: 'U',
  roleKey: 'CASHIER',
  permissions: new Set(permissions),
  branchIds: [],
  allBranches: false,
});

describe('PermissionsGuard', () => {
  beforeAll(() =>
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
  );
  afterAll(() => jest.restoreAllMocks());

  it('allows public routes', () => {
    const { reflector, ctx } = httpContext({}, { [IS_PUBLIC_KEY]: true });
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('requires ALL listed permissions', () => {
    const meta = { [REQUIRED_PERMISSIONS_KEY]: ['sales:read', 'sales:create'] };
    const ok = httpContext(
      { user: user(['sales:read', 'sales:create']) },
      meta,
    );
    expect(new PermissionsGuard(ok.reflector).canActivate(ok.ctx)).toBe(true);
    const partial = httpContext({ user: user(['sales:read']) }, meta);
    expect(() =>
      new PermissionsGuard(partial.reflector).canActivate(partial.ctx),
    ).toThrow(AppException);
  });

  it('@RequireAnyPermission admits a user holding at least one', () => {
    const meta = {
      [REQUIRED_ANY_PERMISSION_KEY]: ['catalogue:write', 'catalogue:price'],
    };
    for (const perms of [['catalogue:write'], ['catalogue:price']]) {
      const c = httpContext({ user: user(perms) }, meta);
      expect(new PermissionsGuard(c.reflector).canActivate(c.ctx)).toBe(true);
    }
    const none = httpContext({ user: user(['catalogue:read']) }, meta);
    expect(() =>
      new PermissionsGuard(none.reflector).canActivate(none.ctx),
    ).toThrow(AppException);
  });

  it('fails closed when a route declares no rule', () => {
    const { reflector, ctx } = httpContext({ user: user(['users:write']) });
    expect(() => new PermissionsGuard(reflector).canActivate(ctx)).toThrow(
      AppException,
    );
  });

  it('allows @AuthenticatedOnly for any user', () => {
    const { reflector, ctx } = httpContext(
      { user: user([]) },
      { [AUTHENTICATED_ONLY_KEY]: true },
    );
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard({
    corsOrigins: ['http://localhost:5173'],
  } as AppConfigService);
  const run = (headers: Record<string, string>) =>
    guard.canActivate(httpContext({ headers }).ctx);

  it('requires X-Requested-With: XMLHttpRequest', () => {
    expect(run({ 'x-requested-with': 'XMLHttpRequest' })).toBe(true);
    expect(() => run({})).toThrow(AppException);
    expect(() => run({ 'x-requested-with': 'fetch' })).toThrow(AppException);
  });

  it('rejects disallowed origins', () => {
    expect(
      run({
        'x-requested-with': 'XMLHttpRequest',
        origin: 'http://localhost:5173',
      }),
    ).toBe(true);
    expect(() =>
      run({
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://evil.example',
      }),
    ).toThrow(AppException);
  });
});
