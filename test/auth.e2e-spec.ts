import { JwtService } from '@nestjs/jwt';
import {
  hashRefreshToken,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../src/auth/token.service';
import {
  bearer,
  CapturingLogger,
  createBranch,
  createTestApp,
  createUser,
  CSRF,
  extractRefreshCookie,
  login,
  resetDatabase,
  TEST_PASSWORD,
  TestContext,
} from './utils/test-app';

describe('Authentication (e2e)', () => {
  let ctx: TestContext;
  const logger = new CapturingLogger();
  let branchA: string;
  let cashierId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ logger });
    await resetDatabase(ctx.prisma);
    branchA = await createBranch(ctx.prisma, 'BRA');
    await createUser(ctx.prisma, {
      email: 'admin@test.local',
      roleKey: 'SYSTEM_ADMIN',
    });
    cashierId = await createUser(ctx.prisma, {
      email: 'cashier@test.local',
      roleKey: 'CASHIER',
      branchIds: [branchA],
    });
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('POST /auth/login', () => {
    it('signs in an active user: access token in body, refresh token only in a secure cookie (T-01)', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: '  Cashier@Test.Local ', password: TEST_PASSWORD })
        .expect(200);

      expect(res.body.data).toMatchObject({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: cashierId,
          email: 'cashier@test.local',
          role: 'CASHIER',
          branchIds: [branchA],
          allBranches: false,
        },
      });
      expect(res.body.data.user.permissions).toContain('sales:create');
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

      const cookie = extractRefreshCookie(res)!;
      expect(cookie).toMatch(/^ebms_refresh=[\w-]{43};/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      // 7 days (computed from the token's expiry, so allow a few seconds).
      const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)![1]);
      expect(maxAge).toBeGreaterThan(604_790);
      expect(maxAge).toBeLessThanOrEqual(604_800);
    });

    it('stores only a SHA-256 hash of the refresh token', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const raw = s.cookie.split('=')[1];
      const stored = await ctx.prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(raw) },
      });
      expect(stored).not.toBeNull();
      const all = await ctx.prisma.refreshToken.findMany({
        select: { tokenHash: true },
      });
      expect(all.some((t) => t.tokenHash === raw)).toBe(false);
    });

    it('returns the same generic 401 for wrong password and unknown email (T-02)', async () => {
      const wrong = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'cashier@test.local', password: 'not-the-password' })
        .expect(401);
      const unknown = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.local', password: 'not-the-password' })
        .expect(401);
      for (const res of [wrong, unknown]) {
        expect(res.body).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        expect(extractRefreshCookie(res)).toBeUndefined();
      }
      await ctx.prisma.user.update({
        where: { id: cashierId },
        data: { failedLoginAttempts: 0 },
      });
    });

    it('rejects a deactivated account with the same generic 401 (US-01)', async () => {
      await createUser(ctx.prisma, {
        email: 'inactive@test.local',
        roleKey: 'CASHIER',
        branchIds: [branchA],
        isActive: false,
      });
      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'inactive@test.local', password: TEST_PASSWORD })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('validates input', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('locks the account after 5 consecutive failures, even for the right password', async () => {
      await createUser(ctx.prisma, {
        email: 'victim@test.local',
        roleKey: 'CASHIER',
        branchIds: [branchA],
      });
      for (let i = 0; i < 5; i++) {
        await ctx
          .http()
          .post('/api/v1/auth/login')
          .send({ email: 'victim@test.local', password: `guess-${i}` })
          .expect(401);
      }
      const locked = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'victim@test.local' },
      });
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(
        Date.now() + 14 * 60_000,
      );

      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'victim@test.local', password: TEST_PASSWORD })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS'); // no hint that it is locked

      const events = await ctx.prisma.auditLog.findMany({
        where: { entityId: locked.id, action: { startsWith: 'auth.' } },
        select: { action: true, metadata: true },
      });
      expect(events.map((e) => e.action)).toContain('auth.account.locked');
      expect(events).toContainEqual({
        action: 'auth.login.failed',
        metadata: { reason: 'ACCOUNT_LOCKED' },
      });
    });

    it('lets the user in again once the lock has expired', async () => {
      await ctx.prisma.user.update({
        where: { email: 'victim@test.local' },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await login(ctx, 'victim@test.local');
    });
  });

  describe('access tokens', () => {
    it('protects routes: 401 without, with a malformed or a forged token', async () => {
      await ctx.http().get('/api/v1/auth/me').expect(401);
      await ctx.http().get('/api/v1/auth/me').set(bearer('abc')).expect(401);

      const forged = await new JwtService().signAsync(
        { sub: cashierId, typ: 'access' },
        {
          secret: 'x'.repeat(48),
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: 900,
        },
      );
      const res = await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(forged))
        .expect(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('rejects expired tokens and tokens with the wrong type', async () => {
      const secret = process.env.JWT_ACCESS_SECRET!;
      const jwt = new JwtService();
      const expired = await jwt.signAsync(
        {
          sub: cashierId,
          typ: 'access',
          iat: Math.floor(Date.now() / 1000) - 3600,
        },
        { secret, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 60 },
      );
      const wrongType = await jwt.signAsync(
        { sub: cashierId, typ: 'refresh' },
        { secret, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 900 },
      );
      await ctx.http().get('/api/v1/auth/me').set(bearer(expired)).expect(401);
      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(wrongType))
        .expect(401);
    });

    it('GET /auth/me returns the current profile', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const res = await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(s.accessToken))
        .expect(200);
      expect(res.body.data).toMatchObject({
        email: 'cashier@test.local',
        role: 'CASHIER',
      });
    });
  });

  describe('POST /auth/refresh (rotation)', () => {
    it('requires the anti-CSRF header', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', s.cookie)
        .expect(403);
      expect(res.body.code).toBe('CSRF_CHECK_FAILED');
    });

    it('rejects a foreign Origin', async () => {
      const s = await login(ctx, 'cashier@test.local');
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Origin', 'https://evil.example')
        .set('Cookie', s.cookie)
        .expect(403);
    });

    it('rotates: returns a new access token and a new cookie; the old token is spent', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', s.cookie)
        .expect(200);
      const newCookie = extractRefreshCookie(res)!.split(';')[0];
      expect(newCookie).not.toBe(s.cookie);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user.email).toBe('cashier@test.local');

      const oldRow = await ctx.prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(s.cookie.split('=')[1]) },
      });
      expect(oldRow.revokedReason).toBe('ROTATED');
      expect(oldRow.replacedById).not.toBeNull();
    });

    it('detects reuse of a rotated token and revokes the whole session family', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const rotated = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(200);
      const current = extractRefreshCookie(rotated)!.split(';')[0];

      // An attacker replays the stolen, already-rotated token.
      const replay = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(401);
      expect(replay.body.code).toBe('INVALID_TOKEN');
      expect(extractRefreshCookie(replay)).toMatch(/ebms_refresh=;/); // cookie cleared

      // The legitimate latest token is now revoked as well.
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', current)
        .expect(401);
      const audit = await ctx.prisma.auditLog.count({
        where: { action: 'auth.refresh.reuse_detected', entityId: cashierId },
      });
      expect(audit).toBeGreaterThanOrEqual(1);
    });

    it('rejects missing, malformed, unknown and expired refresh tokens', async () => {
      await ctx.http().post('/api/v1/auth/refresh').set(CSRF).expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', 'ebms_refresh=not-a-token')
        .expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', `ebms_refresh=${'A'.repeat(43)}`)
        .expect(401);

      const s = await login(ctx, 'cashier@test.local');
      await ctx.prisma.refreshToken.update({
        where: { tokenHash: hashRefreshToken(s.cookie.split('=')[1]) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(401);
    });
  });

  describe('absolute session lifetime (30 days, ADR-021)', () => {
    const DAY = 86_400_000;

    it('login starts a 30-day session; rotation keeps the same absolute end', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const first = await ctx.prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(s.cookie.split('=')[1]) },
      });
      const sessionDays =
        (first.sessionExpiresAt.getTime() - first.createdAt.getTime()) / DAY;
      expect(sessionDays).toBeCloseTo(30, 2);

      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(200);
      const next = await ctx.prisma.refreshToken.findUniqueOrThrow({
        where: {
          tokenHash: hashRefreshToken(
            extractRefreshCookie(res)!.split(';')[0].split('=')[1],
          ),
        },
      });
      expect(next.sessionExpiresAt.getTime()).toBe(
        first.sessionExpiresAt.getTime(),
      );
      expect(next.familyId).toBe(first.familyId);
    });

    it('caps the new token and cookie at the session end near day 30', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const end = new Date(Date.now() + 3_600_000); // 1 hour of session left
      await ctx.prisma.refreshToken.update({
        where: { tokenHash: hashRefreshToken(s.cookie.split('=')[1]) },
        data: { sessionExpiresAt: end, expiresAt: end },
      });
      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(200);
      const cookie = extractRefreshCookie(res)!;
      const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)![1]);
      expect(maxAge).toBeLessThanOrEqual(3600);
      expect(maxAge).toBeGreaterThan(3500);
      const row = await ctx.prisma.refreshToken.findUniqueOrThrow({
        where: {
          tokenHash: hashRefreshToken(cookie.split(';')[0].split('=')[1]),
        },
      });
      expect(row.expiresAt.getTime()).toBe(end.getTime()); // not now + 7 days
    });

    it('rejects refresh once the absolute session has ended', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const past = new Date(Date.now() - 1000);
      await ctx.prisma.refreshToken.update({
        where: { tokenHash: hashRefreshToken(s.cookie.split('=')[1]) },
        data: { sessionExpiresAt: past, expiresAt: past },
      });
      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('the database refuses a token that outlives its session', async () => {
      const s = await login(ctx, 'cashier@test.local');
      await expect(
        ctx.prisma.refreshToken.update({
          where: { tokenHash: hashRefreshToken(s.cookie.split('=')[1]) },
          data: { expiresAt: new Date(Date.now() + 40 * DAY) },
        }),
      ).rejects.toThrow();
    });
  });

  describe('logout and revocation', () => {
    it('POST /auth/logout revokes the session and clears the cookie', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const res = await ctx
        .http()
        .post('/api/v1/auth/logout')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(204);
      expect(extractRefreshCookie(res)).toMatch(
        /ebms_refresh=;.*Expires=Thu, 01 Jan 1970/,
      );
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(401);
      // Idempotent: a second logout is still 204.
      await ctx
        .http()
        .post('/api/v1/auth/logout')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(204);
    });

    it('POST /auth/logout requires the anti-CSRF header', async () => {
      const s = await login(ctx, 'cashier@test.local');
      await ctx
        .http()
        .post('/api/v1/auth/logout')
        .set('Cookie', s.cookie)
        .expect(403);
    });

    it('POST /auth/logout-all revokes every session of the user', async () => {
      const a = await login(ctx, 'cashier@test.local');
      const b = await login(ctx, 'cashier@test.local');
      await ctx
        .http()
        .post('/api/v1/auth/logout-all')
        .set(bearer(a.accessToken))
        .expect(204);
      for (const s of [a, b]) {
        await ctx
          .http()
          .post('/api/v1/auth/refresh')
          .set(CSRF)
          .set('Cookie', s.cookie)
          .expect(401);
      }
    });

    it('deactivating a user blocks their existing access token immediately', async () => {
      const id = await createUser(ctx.prisma, {
        email: 'leaver@test.local',
        roleKey: 'CASHIER',
        branchIds: [branchA],
      });
      const s = await login(ctx, 'leaver@test.local');
      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(s.accessToken))
        .expect(200);
      await ctx.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(s.accessToken))
        .expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(401);
    });
  });

  describe('POST /auth/change-password', () => {
    it('enforces the policy and the current password', async () => {
      const s = await login(ctx, 'cashier@test.local');
      const weak = await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set(bearer(s.accessToken))
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
        .expect(400);
      expect(weak.body.code).toBe('WEAK_PASSWORD');
      const wrong = await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set(bearer(s.accessToken))
        .send({
          currentPassword: 'wrong-password',
          newPassword: 'A-Much-Better-Passphrase-1',
        })
        .expect(400);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('changes the password, revokes sessions and invalidates older access tokens', async () => {
      await createUser(ctx.prisma, {
        email: 'changer@test.local',
        roleKey: 'CASHIER',
        branchIds: [branchA],
      });
      const s = await login(ctx, 'changer@test.local');
      // Make the existing token predate the change by more than a second.
      await new Promise((r) => setTimeout(r, 1100));
      await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set(bearer(s.accessToken))
        .send({
          currentPassword: TEST_PASSWORD,
          newPassword: 'A-Much-Better-Passphrase-1',
        })
        .expect(204);

      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(s.accessToken))
        .expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'changer@test.local', password: TEST_PASSWORD })
        .expect(401);
      await login(ctx, 'changer@test.local', 'A-Much-Better-Passphrase-1');
    });
  });

  describe('secrets never leak', () => {
    it('no password, access token or refresh token appears in logs or audit metadata', async () => {
      const s = await login(ctx, 'cashier@test.local');
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', s.cookie)
        .expect(200);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'cashier@test.local', password: 'Leaky-Password-123' })
        .expect(401);
      const rawRefresh = s.cookie.split('=')[1];

      const logs = logger.lines.join('\n');
      const audit = JSON.stringify(
        await ctx.prisma.auditLog.findMany({
          select: { metadata: true, action: true },
        }),
      );
      for (const secret of [
        TEST_PASSWORD,
        'Leaky-Password-123',
        s.accessToken,
        rawRefresh,
      ]) {
        expect(logs).not.toContain(secret);
        expect(audit).not.toContain(secret);
      }
    });
  });
});

describe('Login rate limiting (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      loginRateLimit: { limit: 3, windowSeconds: 60 },
    });
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('returns 429 RATE_LIMITED after the per-IP limit, with Retry-After', async () => {
    for (let i = 0; i < 3; i++) {
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: `x${i}@test.local`, password: 'whatever-pass' })
        .expect(401);
    }
    const res = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'x@test.local', password: 'whatever-pass' })
      .expect(429);
    expect(res.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not rate-limit other endpoints', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.http().get('/api/v1/health').expect(200);
    }
  });
});
