import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BranchScoped } from '../src/access/branch-scope.guard';
import { PERMISSIONS } from '../src/access/permissions';
import { AuthenticatedOnly, RequirePermissions } from '../src/auth/decorators';
import {
  bearer,
  createBranch,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  TEST_PASSWORD,
  TestContext,
} from './utils/test-app';

// ---- Test-only fixtures for guard behaviour ----
@Controller('__access')
class AccessFixtureController {
  /** Declares no access rule: must be denied (fail closed). */
  @Get('undeclared')
  undeclared() {
    return 'should never be returned';
  }

  @Get('any-user')
  @AuthenticatedOnly()
  anyUser() {
    return 'ok';
  }

  @Get('branches/:branchId/stock')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @BranchScoped('params')
  stock(@Param('branchId') branchId: string) {
    return { branchId };
  }

  @Get('sales')
  @RequirePermissions(PERMISSIONS.SALES_READ)
  @BranchScoped('query')
  sales(@Query('branchId') branchId: string) {
    return { branchId };
  }

  @Post('transfer')
  @AuthenticatedOnly()
  @BranchScoped('body', 'branchIds')
  transfer(@Body() body: unknown) {
    return body;
  }
}

@Module({ controllers: [AccessFixtureController] })
class AccessFixtureModule {}
// -------------------------------------------------

describe('Authorization & branch isolation (e2e)', () => {
  let ctx: TestContext;
  let A: string; // branch A
  let B: string; // branch B
  let inactiveBranch: string;
  const token: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const as = (who: string) => bearer(token[who]);

  beforeAll(async () => {
    ctx = await createTestApp({ imports: [AccessFixtureModule] });
    await resetDatabase(ctx.prisma);
    A = await createBranch(ctx.prisma, 'BR-A');
    B = await createBranch(ctx.prisma, 'BR-B');
    inactiveBranch = await createBranch(ctx.prisma, 'BR-OLD', false);

    const users: [string, Parameters<typeof createUser>[1]][] = [
      ['admin', { email: 'admin@test.local', roleKey: 'SYSTEM_ADMIN' }],
      ['admin2', { email: 'admin2@test.local', roleKey: 'SYSTEM_ADMIN' }],
      [
        'managerA',
        { email: 'manager.a@test.local', roleKey: 'MANAGER', branchIds: [A] },
      ],
      [
        'managerAB',
        {
          email: 'manager.ab@test.local',
          roleKey: 'MANAGER',
          branchIds: [A, B],
        },
      ],
      [
        'inventoryA',
        {
          email: 'inv.a@test.local',
          roleKey: 'INVENTORY_OFFICER',
          branchIds: [A],
        },
      ],
      [
        'procurementA',
        {
          email: 'proc.a@test.local',
          roleKey: 'PROCUREMENT_OFFICER',
          branchIds: [A],
        },
      ],
      [
        'cashierA',
        { email: 'cashier.a@test.local', roleKey: 'CASHIER', branchIds: [A] },
      ],
      [
        'cashierB',
        { email: 'cashier.b@test.local', roleKey: 'CASHIER', branchIds: [B] },
      ],
      [
        'techA',
        { email: 'tech.a@test.local', roleKey: 'TECHNICIAN', branchIds: [A] },
      ],
      [
        'auditorA',
        { email: 'auditor.a@test.local', roleKey: 'AUDITOR', branchIds: [A] },
      ],
    ];
    for (const [key, opts] of users) {
      ids[key] = await createUser(ctx.prisma, opts);
      token[key] = (await login(ctx, opts.email)).accessToken;
    }
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('guards', () => {
    it('denies a route that declares no access rule (fail closed)', async () => {
      const res = await ctx
        .http()
        .get('/api/v1/__access/undeclared')
        .set(as('admin'))
        .expect(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });

    it('allows @AuthenticatedOnly routes for any signed-in user, but not anonymous', async () => {
      await ctx
        .http()
        .get('/api/v1/__access/any-user')
        .set(as('cashierA'))
        .expect(200);
      await ctx.http().get('/api/v1/__access/any-user').expect(401);
    });

    it('keeps health public', async () => {
      await ctx.http().get('/api/v1/health').expect(200);
    });
  });

  describe('permission matrix over HTTP (T-03, US-02)', () => {
    it.each([
      ['cashierA', 'GET', '/api/v1/users'],
      ['cashierA', 'POST', '/api/v1/branches'],
      ['cashierA', 'GET', '/api/v1/audit-logs'],
      ['cashierA', 'GET', '/api/v1/roles'],
      ['managerA', 'POST', '/api/v1/users'],
      [
        'managerA',
        'PATCH',
        '/api/v1/users/00000000-0000-4000-8000-000000000000',
      ],
      [
        'managerA',
        'POST',
        '/api/v1/users/00000000-0000-4000-8000-000000000000/password',
      ],
      ['inventoryA', 'GET', '/api/v1/audit-logs'],
      [
        'procurementA',
        'PATCH',
        '/api/v1/branches/00000000-0000-4000-8000-000000000000',
      ],
      ['techA', 'GET', '/api/v1/users'],
      ['auditorA', 'POST', '/api/v1/users'],
      ['auditorA', 'POST', '/api/v1/branches'],
      [
        'auditorA',
        'PATCH',
        '/api/v1/users/00000000-0000-4000-8000-000000000000',
      ],
    ])('%s %s %s → 403 PERMISSION_DENIED', async (who, method, url) => {
      const req = ctx
        .http()
        [method.toLowerCase() as 'get' | 'post' | 'patch'](url);
      const res = await req.set(as(who)).send({}).expect(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });

    it('a 403 never performs the action', async () => {
      const before = await ctx.prisma.branch.count();
      await ctx
        .http()
        .post('/api/v1/branches')
        .set(as('cashierA'))
        .send({ code: 'HACK', name: 'Hacked' })
        .expect(403);
      expect(await ctx.prisma.branch.count()).toBe(before);
    });

    it('roles and permissions are readable by admin and auditor', async () => {
      const res = await ctx
        .http()
        .get('/api/v1/roles')
        .set(as('auditorA'))
        .expect(200);
      const cashier = res.body.data.find(
        (r: { key: string }) => r.key === 'CASHIER',
      );
      expect(cashier.maxBranches).toBe(1);
      expect(cashier.permissions).toContain('sales:create');
      const perms = await ctx
        .http()
        .get('/api/v1/permissions')
        .set(as('admin'))
        .expect(200);
      expect(perms.body.data.length).toBeGreaterThan(20);
    });
  });

  describe('branch isolation (T-13)', () => {
    it('lists only assigned branches; admin sees all', async () => {
      const mgr = await ctx
        .http()
        .get('/api/v1/branches')
        .set(as('managerA'))
        .expect(200);
      expect(mgr.body.data.map((b: { id: string }) => b.id)).toEqual([A]);
      const cashierB = await ctx
        .http()
        .get('/api/v1/branches')
        .set(as('cashierB'))
        .expect(200);
      expect(cashierB.body.data.map((b: { id: string }) => b.id)).toEqual([B]);
      const multi = await ctx
        .http()
        .get('/api/v1/branches')
        .set(as('managerAB'))
        .expect(200);
      expect(multi.body.meta.pagination.total).toBe(2);
      const admin = await ctx
        .http()
        .get('/api/v1/branches')
        .set(as('admin'))
        .expect(200);
      expect(admin.body.meta.pagination.total).toBe(3);
    });

    it('returns 403 BRANCH_ACCESS_DENIED for another branch; 404 for a missing one', async () => {
      for (const who of ['managerA', 'auditorA', 'cashierA', 'inventoryA']) {
        const res = await ctx
          .http()
          .get(`/api/v1/branches/${B}`)
          .set(as(who))
          .expect(403);
        expect(res.body.code).toBe('BRANCH_ACCESS_DENIED');
      }
      await ctx
        .http()
        .get(`/api/v1/branches/${A}`)
        .set(as('managerA'))
        .expect(200);
      await ctx
        .http()
        .get('/api/v1/branches/00000000-0000-4000-8000-000000000000')
        .set(as('admin'))
        .expect(404);
    });

    it('@BranchScoped checks branch IDs in path, query and body', async () => {
      await ctx
        .http()
        .get(`/api/v1/__access/branches/${A}/stock`)
        .set(as('inventoryA'))
        .expect(200);
      await ctx
        .http()
        .get(`/api/v1/__access/branches/${B}/stock`)
        .set(as('inventoryA'))
        .expect(403);
      await ctx
        .http()
        .get(`/api/v1/__access/branches/${B}/stock`)
        .set(as('admin'))
        .expect(200);

      await ctx
        .http()
        .get(`/api/v1/__access/sales?branchId=${A}`)
        .set(as('cashierA'))
        .expect(200);
      const q = await ctx
        .http()
        .get(`/api/v1/__access/sales?branchId=${B}`)
        .set(as('cashierA'))
        .expect(403);
      expect(q.body.code).toBe('BRANCH_ACCESS_DENIED');

      await ctx
        .http()
        .post('/api/v1/__access/transfer')
        .set(as('managerAB'))
        .send({ branchIds: [A, B] })
        .expect(201);
      await ctx
        .http()
        .post('/api/v1/__access/transfer')
        .set(as('managerA'))
        .send({ branchIds: [A, B] }) // B is outside scope
        .expect(403);
    });

    it('manager views staff of assigned branches only, and cannot manage them', async () => {
      const res = await ctx
        .http()
        .get('/api/v1/users')
        .set(as('managerA'))
        .expect(200);
      const emails = res.body.data.map((u: { email: string }) => u.email);
      expect(emails).toEqual(
        expect.arrayContaining([
          'cashier.a@test.local',
          'inv.a@test.local',
          'auditor.a@test.local',
        ]),
      );
      expect(emails).not.toContain('cashier.b@test.local');
      expect(emails).not.toContain('admin@test.local');
      await ctx
        .http()
        .get(`/api/v1/users/${ids.cashierA}`)
        .set(as('managerA'))
        .expect(200);
      await ctx
        .http()
        .get(`/api/v1/users/${ids.cashierB}`)
        .set(as('managerA'))
        .expect(404);
      await ctx
        .http()
        .patch(`/api/v1/users/${ids.cashierA}`)
        .set(as('managerA'))
        .send({ isActive: false })
        .expect(403);
    });

    it('audit: managers see their branches’ events; global login events are admin-only', async () => {
      // A branch-scoped event for A and B, plus global login events (branchId null).
      await ctx
        .http()
        .patch(`/api/v1/branches/${A}`)
        .set(as('admin'))
        .send({ phone: '+255 22 111 1111' })
        .expect(200);
      await ctx
        .http()
        .patch(`/api/v1/branches/${B}`)
        .set(as('admin'))
        .send({ phone: '+255 22 222 2222' })
        .expect(200);

      const mgr = await ctx
        .http()
        .get('/api/v1/audit-logs?limit=100')
        .set(as('managerA'))
        .expect(200);
      const mgrEvents = mgr.body.data as {
        action: string;
        branchId: string | null;
      }[];
      expect(
        mgrEvents.some(
          (e) => e.action === 'branch.updated' && e.branchId === A,
        ),
      ).toBe(true);
      expect(mgrEvents.every((e) => e.branchId === A)).toBe(true);
      expect(mgrEvents.some((e) => e.action.startsWith('auth.'))).toBe(false);

      const admin = await ctx
        .http()
        .get('/api/v1/audit-logs?action=auth.login.succeeded&limit=5')
        .set(as('admin'))
        .expect(200);
      expect(admin.body.data.length).toBeGreaterThan(0);
      const mgrLogins = await ctx
        .http()
        .get('/api/v1/audit-logs?action=auth.login.succeeded')
        .set(as('managerA'))
        .expect(200);
      expect(mgrLogins.body.data).toEqual([]);
    });

    it('auditor sees only users and audit events of assigned branches', async () => {
      const users = await ctx
        .http()
        .get('/api/v1/users')
        .set(as('auditorA'))
        .expect(200);
      const emails = users.body.data.map((u: { email: string }) => u.email);
      expect(emails).toContain('cashier.a@test.local');
      expect(emails).not.toContain('cashier.b@test.local');
      expect(emails).not.toContain('admin@test.local');

      await ctx
        .http()
        .get(`/api/v1/users/${ids.cashierB}`)
        .set(as('auditorA'))
        .expect(404);
      await ctx
        .http()
        .get(`/api/v1/users?branchId=${B}`)
        .set(as('auditorA'))
        .expect(403);

      const audit = await ctx
        .http()
        .get('/api/v1/audit-logs')
        .set(as('auditorA'))
        .expect(200);
      for (const e of audit.body.data as { branchId: string | null }[]) {
        expect(e.branchId).toBe(A);
      }
      await ctx
        .http()
        .get(`/api/v1/audit-logs?branchId=${B}`)
        .set(as('auditorA'))
        .expect(403);
    });
  });

  describe('user administration', () => {
    const create = (body: Record<string, unknown>) =>
      ctx.http().post('/api/v1/users').set(as('admin')).send(body);

    it('creates a user without exposing the password hash, and audits it', async () => {
      const res = await create({
        email: '  New.Cashier@Test.Local',
        fullName: 'New Cashier',
        password: 'Initial-Passphrase-42',
        roleKey: 'CASHIER',
        branchIds: [A],
      }).expect(201);
      expect(res.body.data).toMatchObject({
        email: 'new.cashier@test.local',
        role: { key: 'CASHIER' },
        isActive: true,
        isLocked: false,
        branches: [{ id: A, code: 'BR-A' }],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const event = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.created', entityId: res.body.data.id },
      });
      expect(event.actorId).toBe(ids.admin);
      expect(JSON.stringify(event.metadata)).not.toContain(
        'Initial-Passphrase-42',
      );
      await login(ctx, 'new.cashier@test.local', 'Initial-Passphrase-42');
    });

    it('rejects duplicate emails (409) and weak passwords (400)', async () => {
      const dup = await create({
        email: 'cashier.a@test.local',
        fullName: 'Dup',
        password: 'Initial-Passphrase-42',
        roleKey: 'CASHIER',
        branchIds: [A],
      }).expect(409);
      expect(dup.body.code).toBe('DUPLICATE_VALUE');
      const weak = await create({
        email: 'weak@test.local',
        fullName: 'Weak',
        password: 'short',
        roleKey: 'CASHIER',
        branchIds: [A],
      }).expect(400);
      expect(weak.body.code).toBe('WEAK_PASSWORD');
    });

    it.each([
      ['CASHIER', () => [A, B], 'at most 1'],
      ['TECHNICIAN', () => [A, B], 'at most 1'],
      ['MANAGER', () => [], 'at least one'],
      ['SYSTEM_ADMIN', () => [A], 'all branches'],
      ['INVENTORY_OFFICER', () => [inactiveBranch], 'active'],
    ])('enforces branch rules for %s', async (roleKey, branchIds, message) => {
      const res = await create({
        email: `rule.${roleKey.toLowerCase()}@test.local`,
        fullName: 'Rule',
        password: 'Initial-Passphrase-42',
        roleKey,
        branchIds: branchIds(),
      }).expect(400);
      expect(res.body.code).toBe('BRANCH_ASSIGNMENT_INVALID');
      expect(res.body.message).toContain(message);
    });

    it('allows multiple branches for MANAGER, INVENTORY, PROCUREMENT and AUDITOR', async () => {
      for (const roleKey of [
        'MANAGER',
        'INVENTORY_OFFICER',
        'PROCUREMENT_OFFICER',
        'AUDITOR',
      ]) {
        await create({
          email: `multi.${roleKey.toLowerCase()}@test.local`,
          fullName: 'Multi',
          password: 'Initial-Passphrase-42',
          roleKey,
          branchIds: [A, B],
        }).expect(201);
      }
    });

    it('reassigns branches and changes roles; the change applies to existing tokens immediately', async () => {
      const id = await createUser(ctx.prisma, {
        email: 'mover@test.local',
        roleKey: 'CASHIER',
        branchIds: [A],
      });
      const s = await login(ctx, 'mover@test.local');
      await ctx
        .http()
        .get(`/api/v1/branches/${A}`)
        .set(bearer(s.accessToken))
        .expect(200);

      await ctx
        .http()
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ branchIds: [B] })
        .expect(200);
      await ctx
        .http()
        .get(`/api/v1/branches/${A}`)
        .set(bearer(s.accessToken))
        .expect(403);
      await ctx
        .http()
        .get(`/api/v1/branches/${B}`)
        .set(bearer(s.accessToken))
        .expect(200);

      const promoted = await ctx
        .http()
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ roleKey: 'MANAGER', branchIds: [A, B] })
        .expect(200);
      expect(promoted.body.data.role.key).toBe('MANAGER');
      const me = await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(s.accessToken))
        .expect(200);
      expect(me.body.data.permissions).toContain('procurement:approve');
      expect(me.body.data.permissions).not.toContain('sales:create');
    });

    it('deactivation revokes sessions; reactivation is audited', async () => {
      const id = await createUser(ctx.prisma, {
        email: 'temp@test.local',
        roleKey: 'CASHIER',
        branchIds: [A],
      });
      const s = await login(ctx, 'temp@test.local');
      await ctx
        .http()
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ isActive: false })
        .expect(200);
      expect(
        await ctx.prisma.refreshToken.count({
          where: { userId: id, revokedAt: null },
        }),
      ).toBe(0);
      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set(bearer(s.accessToken))
        .expect(401);
      await ctx
        .http()
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ isActive: true })
        .expect(200);
      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { entityId: id },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['user.deactivated', 'user.reactivated']),
      );
    });

    it('prevents admins locking themselves out and removing the last admin', async () => {
      const self = await ctx
        .http()
        .patch(`/api/v1/users/${ids.admin}`)
        .set(as('admin'))
        .send({ isActive: false })
        .expect(409);
      expect(self.body.code).toBe('ADMIN_LOCKOUT_PREVENTED');

      // admin deactivates admin2 (allowed: admin remains) ...
      await ctx
        .http()
        .patch(`/api/v1/users/${ids.admin2}`)
        .set(as('admin'))
        .send({ isActive: false })
        .expect(200);
      // ... a fresh admin cannot then demote the original if that leaves none.
      await ctx.prisma.user.update({
        where: { id: ids.admin2 },
        data: { isActive: true },
      });
      const t2 = (await login(ctx, 'admin2@test.local')).accessToken;
      await ctx.prisma.user.update({
        where: { id: ids.admin2 },
        data: { isActive: false },
      });
      // admin2 is inactive now, so its token is rejected outright:
      await ctx
        .http()
        .patch(`/api/v1/users/${ids.admin}`)
        .set(bearer(t2))
        .send({ roleKey: 'AUDITOR', branchIds: [A] })
        .expect(401);
      // and the only remaining admin cannot demote themselves:
      await ctx
        .http()
        .patch(`/api/v1/users/${ids.admin}`)
        .set(as('admin'))
        .send({ roleKey: 'AUDITOR', branchIds: [A] })
        .expect(409);
    });

    it('admin password reset unlocks the account and revokes sessions', async () => {
      const id = await createUser(ctx.prisma, {
        email: 'forgot@test.local',
        roleKey: 'CASHIER',
        branchIds: [A],
      });
      const s = await login(ctx, 'forgot@test.local');
      await ctx.prisma.user.update({
        where: { id },
        data: { lockedUntil: new Date(Date.now() + 600_000) },
      });
      await ctx
        .http()
        .post(`/api/v1/users/${id}/password`)
        .set(as('admin'))
        .send({ newPassword: 'Reset-Passphrase-2026' })
        .expect(204);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'forgot@test.local', password: TEST_PASSWORD })
        .expect(401);
      await login(ctx, 'forgot@test.local', 'Reset-Passphrase-2026');
      expect(
        await ctx.prisma.refreshToken.count({
          where: { userId: id, revokedReason: 'PASSWORD_CHANGED' },
        }),
      ).toBeGreaterThanOrEqual(1);
      void s;
    });
  });

  describe('branch administration', () => {
    it('admin creates and deactivates branches; codes are unique and upper-cased', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/branches')
        .set(as('admin'))
        .send({ code: 'mwz-01', name: 'Mwanza' })
        .expect(201);
      expect(res.body.data.code).toBe('MWZ-01');
      const dup = await ctx
        .http()
        .post('/api/v1/branches')
        .set(as('admin'))
        .send({ code: 'MWZ-01', name: 'Again' })
        .expect(409);
      expect(dup.body.code).toBe('DUPLICATE_VALUE');

      await ctx
        .http()
        .patch(`/api/v1/branches/${res.body.data.id}`)
        .set(as('admin'))
        .send({ isActive: false })
        .expect(200);
      await ctx
        .http()
        .patch(`/api/v1/branches/${res.body.data.id}`)
        .set(as('admin'))
        .send({ code: 'NEW' }) // code is immutable
        .expect(400);
      const event = await ctx.prisma.auditLog.findFirst({
        where: { action: 'branch.deactivated', entityId: res.body.data.id },
      });
      expect(event).not.toBeNull();
    });
  });

  describe('audit log integrity', () => {
    it('is append-only at the database level', async () => {
      const row = await ctx.prisma.auditLog.findFirstOrThrow();
      await expect(
        ctx.prisma.auditLog.update({
          where: { id: row.id },
          data: { action: 'tampered' },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.auditLog.delete({ where: { id: row.id } }),
      ).rejects.toThrow(/append-only/);
    });

    it('admin can filter the audit log', async () => {
      const res = await ctx
        .http()
        .get('/api/v1/audit-logs?action=user.created&limit=5')
        .set(as('admin'))
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const e of res.body.data as { action: string }[])
        expect(e.action).toBe('user.created');
    });
  });
});
