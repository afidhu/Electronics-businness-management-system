import type { RoleKey } from '../src/access/permissions';
import { TaxSettingsService } from '../src/settings/tax-settings.service';
import {
  bearer,
  createBranch,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  TestContext,
} from './utils/test-app';

const ROLES: RoleKey[] = [
  'SYSTEM_ADMIN',
  'MANAGER',
  'INVENTORY_OFFICER',
  'PROCUREMENT_OFFICER',
  'CASHIER',
  'TECHNICIAN',
  'AUDITOR',
];

describe('Module 6 stage 6.2 — VAT settings and customers (e2e)', () => {
  let ctx: TestContext;
  const token: Partial<Record<RoleKey | 'admin2', string>> = {};
  const ids: Partial<Record<RoleKey | 'admin2', string>> = {};
  const as = (r: RoleKey | 'admin2') => bearer(token[r]!);
  const http = () => ctx.http();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const branch = await createBranch(ctx.prisma, 'BR-A');
    for (const role of ROLES) {
      const email = `${role.toLowerCase()}@s62.test`;
      ids[role] = await createUser(ctx.prisma, {
        email,
        roleKey: role,
        branchIds: role === 'SYSTEM_ADMIN' ? [] : [branch],
      });
      token[role] = (await login(ctx, email)).accessToken;
    }
    ids.admin2 = await createUser(ctx.prisma, {
      email: 'admin2@s62.test',
      roleKey: 'SYSTEM_ADMIN',
    });
    token.admin2 = (await login(ctx, 'admin2@s62.test')).accessToken;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ================================================================ VAT
  describe('VAT settings (S1, BR-20)', () => {
    it('is unconfigured initially, and the sales guard blocks (TAX_NOT_CONFIGURED)', async () => {
      const res = await http()
        .get('/api/v1/settings/tax')
        .set(as('CASHIER'))
        .expect(200);
      expect(res.body.data).toEqual({ configured: false });
      await expect(
        ctx.app.get(TaxSettingsService).requireActive(),
      ).rejects.toMatchObject({
        code: 'TAX_NOT_CONFIGURED',
      });
    });

    it.each(ROLES.filter((r) => r !== 'SYSTEM_ADMIN'))(
      '%s cannot change the VAT rate (403) and nothing is stored',
      async (role) => {
        const res = await http()
          .put('/api/v1/settings/tax')
          .set(as(role))
          .send({ ratePercent: '18' })
          .expect(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
        expect(await ctx.prisma.taxSetting.count()).toBe(0);
      },
    );

    it('requires authentication', async () => {
      await http().get('/api/v1/settings/tax').expect(401);
      await http()
        .put('/api/v1/settings/tax')
        .send({ ratePercent: '18' })
        .expect(401);
    });

    it.each([['101'], ['-1'], ['18.555'], [18], ['abc'], ['']])(
      'rejects rate %p (400)',
      async (rate) => {
        const res = await http()
          .put('/api/v1/settings/tax')
          .set(as('SYSTEM_ADMIN'))
          .send({ ratePercent: rate })
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      },
    );

    it('admin sets 18%; every role can read it; the guard now passes; change is audited', async () => {
      const res = await http()
        .put('/api/v1/settings/tax')
        .set(as('SYSTEM_ADMIN'))
        .send({ ratePercent: '18' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        configured: true,
        name: 'VAT',
        ratePercent: '18.00',
        setBy: { id: ids.SYSTEM_ADMIN },
      });
      for (const role of ROLES) {
        const r = await http()
          .get('/api/v1/settings/tax')
          .set(as(role))
          .expect(200);
        expect(r.body.data.ratePercent).toBe('18.00');
      }
      const active = await ctx.app.get(TaxSettingsService).requireActive();
      expect(active.ratePercent.toFixed(2)).toBe('18.00');
      const ev = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'tax_setting.changed' },
      });
      expect(ev).toMatchObject({
        actorId: ids.SYSTEM_ADMIN,
        entityType: 'TaxSetting',
      });
      expect(ev.metadata).toMatchObject({
        fromPercent: null,
        toPercent: '18.00',
      });
    });

    it('0% is allowed; history keeps previous rates; setting the same rate is a no-op', async () => {
      await http()
        .put('/api/v1/settings/tax')
        .set(as('SYSTEM_ADMIN'))
        .send({ ratePercent: '0' })
        .expect(200);
      const r = await http()
        .get('/api/v1/settings/tax')
        .set(as('CASHIER'))
        .expect(200);
      expect(r.body.data.ratePercent).toBe('0.00');
      await expect(
        ctx.app.get(TaxSettingsService).requireActive(),
      ).resolves.toBeTruthy(); // 0% still "configured"
      await http()
        .put('/api/v1/settings/tax')
        .set(as('SYSTEM_ADMIN'))
        .send({ ratePercent: '0.00' })
        .expect(200);
      const rows = await ctx.prisma.taxSetting.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((x) => [x.ratePercent.toFixed(2), x.isActive])).toEqual([
        ['18.00', false],
        ['0.00', true],
      ]);
      const ev = await ctx.prisma.auditLog.findMany({
        where: { action: 'tax_setting.changed' },
        orderBy: { createdAt: 'asc' },
      });
      expect(ev).toHaveLength(2); // the no-op was not audited
      expect(ev[1].metadata).toMatchObject({
        fromPercent: '18.00',
        toPercent: '0.00',
      });
    });

    it('concurrent changes by two admins leave exactly one active rate', async () => {
      const results = await Promise.all([
        http()
          .put('/api/v1/settings/tax')
          .set(as('SYSTEM_ADMIN'))
          .send({ ratePercent: '16' }),
        http()
          .put('/api/v1/settings/tax')
          .set(as('admin2'))
          .send({ ratePercent: '18' }),
      ]);
      for (const r of results) expect([200, 409]).toContain(r.status);
      expect(
        await ctx.prisma.taxSetting.count({ where: { isActive: true } }),
      ).toBe(1);
      const historyRates = (await ctx.prisma.taxSetting.findMany()).map((x) =>
        x.ratePercent.toFixed(2),
      );
      expect(historyRates).toEqual(expect.arrayContaining(['18.00', '0.00']));
    });

    it('managers and auditors see VAT audit events (organisation-wide); logins stay hidden', async () => {
      for (const role of ['MANAGER', 'AUDITOR'] as RoleKey[]) {
        const res = await http()
          .get('/api/v1/audit-logs?entityType=TaxSetting')
          .set(as(role))
          .expect(200);
        expect(res.body.data.length).toBeGreaterThan(0);
        const all = await http()
          .get('/api/v1/audit-logs?limit=100')
          .set(as(role))
          .expect(200);
        expect(
          all.body.data.some((e: { action: string }) =>
            e.action.startsWith('auth.'),
          ),
        ).toBe(false);
      }
    });
  });

  // ========================================================== customers
  describe('customers (S6)', () => {
    let customerId: string;

    it('cashier registers a customer; phone normalised; email lower-cased', async () => {
      const res = await http()
        .post('/api/v1/customers')
        .set(as('CASHIER'))
        .send({
          name: '  Asha   Mushi ',
          phone: '0712 345 678',
          email: ' Asha@Example.CO.TZ ',
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        name: 'Asha Mushi',
        phone: '+255712345678',
        email: 'asha@example.co.tz',
        isActive: true,
      });
      customerId = res.body.data.id;
    });

    it('walk-in style customer without phone/email is allowed (sales stay possible without a customer)', async () => {
      const res = await http()
        .post('/api/v1/customers')
        .set(as('SYSTEM_ADMIN'))
        .send({ name: 'Walk-in Regular' })
        .expect(201);
      expect(res.body.data).toMatchObject({ phone: null, email: null });
    });

    it.each([['+255 712-345-678'], ['712345678'], ['255712345678']])(
      'rejects the same number in another format %p (409)',
      async (phone) => {
        const res = await http()
          .post('/api/v1/customers')
          .set(as('CASHIER'))
          .send({ name: 'Dup', phone })
          .expect(409);
        expect(res.body).toMatchObject({
          code: 'DUPLICATE_VALUE',
          details: [{ field: 'phone' }],
        });
      },
    );

    it.each([
      [{ name: 'X', phone: 'call me' }, 'phone'],
      [{ name: 'X', phone: '0712 345 67' }, 'phone'],
      [{ name: 'X', email: 'not-an-email' }, 'email'],
      [{ name: '  ' }, 'name'],
      [{ name: 'X', loyaltyPoints: 5 }, 'loyaltyPoints'],
    ])('validates %p (400)', async (body, field) => {
      const res = await http()
        .post('/api/v1/customers')
        .set(as('CASHIER'))
        .send(body)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(
        field,
      );
    });

    it('searches by name, full phone in any format, or partial digits', async () => {
      for (const q of ['asha', '0712345678', '+255 712 345 678', '345678']) {
        const res = await http()
          .get(`/api/v1/customers?q=${encodeURIComponent(q)}`)
          .set(as('CASHIER'))
          .expect(200);
        expect(res.body.data.map((c: { id: string }) => c.id)).toContain(
          customerId,
        );
      }
    });

    it('updates (phone re-normalised, null clears), deactivates; never deletes', async () => {
      const res = await http()
        .patch(`/api/v1/customers/${customerId}`)
        .set(as('CASHIER'))
        .send({ phone: '+255 754 111 222', email: null })
        .expect(200);
      expect(res.body.data).toMatchObject({
        phone: '+255754111222',
        email: null,
      });
      // the old number is free again
      await http()
        .post('/api/v1/customers')
        .set(as('CASHIER'))
        .send({ name: 'New owner', phone: '0712345678' })
        .expect(201);
      const off = await http()
        .patch(`/api/v1/customers/${customerId}`)
        .set(as('CASHIER'))
        .send({ isActive: false })
        .expect(200);
      expect(off.body.data.isActive).toBe(false);
      await http()
        .get('/api/v1/customers/00000000-0000-4000-8000-000000000000')
        .set(as('CASHIER'))
        .expect(404);
    });

    it('audit records which fields changed, never personal values', async () => {
      const events = await ctx.prisma.auditLog.findMany({
        where: { entityType: 'Customer' },
      });
      expect(events.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'customer.created',
          'customer.updated',
          'customer.deactivated',
        ]),
      );
      const blob = JSON.stringify(events.map((e) => e.metadata));
      for (const secret of [
        '712345678',
        '754111222',
        'asha@example',
        'Asha Mushi',
      ]) {
        expect(blob).not.toContain(secret);
      }
      const upd = events.find((e) => e.action === 'customer.updated')!;
      expect(upd.metadata).toEqual({ changedFields: ['phone', 'email'] });
    });

    // ------------------------------------------------- access control (all roles)
    const READERS: RoleKey[] = [
      'SYSTEM_ADMIN',
      'MANAGER',
      'CASHIER',
      'TECHNICIAN',
      'AUDITOR',
    ];
    const WRITERS: RoleKey[] = ['SYSTEM_ADMIN', 'CASHIER'];

    it.each(ROLES)(
      '%s: read/write access matches customers:read / customers:write',
      async (role) => {
        const list = await http().get('/api/v1/customers').set(as(role));
        expect(list.status).toBe(READERS.includes(role) ? 200 : 403);
        const get = await http()
          .get(`/api/v1/customers/${customerId}`)
          .set(as(role));
        expect(get.status).toBe(READERS.includes(role) ? 200 : 403);
        const create = await http()
          .post('/api/v1/customers')
          .set(as(role))
          .send({ name: `By ${role}` });
        expect(create.status).toBe(WRITERS.includes(role) ? 201 : 403);
        const patch = await http()
          .patch(`/api/v1/customers/${customerId}`)
          .set(as(role))
          .send({ notes: `n-${role}` });
        expect(patch.status).toBe(WRITERS.includes(role) ? 200 : 403);
      },
    );

    it('a refused write changes nothing', async () => {
      const before = await ctx.prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      await http()
        .patch(`/api/v1/customers/${customerId}`)
        .set(as('MANAGER'))
        .send({ name: 'Hijack' })
        .expect(403);
      const after = await ctx.prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      expect(after.name).toBe(before.name);
    });
  });
});
