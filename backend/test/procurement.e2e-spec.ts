import type { RoleKey } from '../src/access/permissions';
import {
  bearer,
  createBranch,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  TestContext,
} from './utils/test-app';

type Who =
  | 'admin'
  | 'admin2'
  | 'managerA'
  | 'managerB'
  | 'procA'
  | 'procA2'
  | 'procB'
  | 'invA'
  | 'cashierA'
  | 'techA'
  | 'auditorA';

const YEAR = String(new Date().getUTCFullYear());

describe('Procurement — Module 4 (e2e)', () => {
  let ctx: TestContext;
  let A: string;
  let B: string;
  const token: Partial<Record<Who, string>> = {};
  const ids: Partial<Record<Who, string>> = {};
  const as = (who: Who) => bearer(token[who]!);
  let supplierId: string;
  let laptop: string; // product
  let cable: string; // product
  let inactiveProduct: string;

  const users: [Who, RoleKey, () => string[]][] = [
    ['admin', 'SYSTEM_ADMIN', () => []],
    ['admin2', 'SYSTEM_ADMIN', () => []],
    ['managerA', 'MANAGER', () => [A]],
    ['managerB', 'MANAGER', () => [B]],
    ['procA', 'PROCUREMENT_OFFICER', () => [A]],
    ['procA2', 'PROCUREMENT_OFFICER', () => [A]],
    ['procB', 'PROCUREMENT_OFFICER', () => [B]],
    ['invA', 'INVENTORY_OFFICER', () => [A]],
    ['cashierA', 'CASHIER', () => [A]],
    ['techA', 'TECHNICIAN', () => [A]],
    ['auditorA', 'AUDITOR', () => [A]],
  ];

  const order = (overrides: Record<string, unknown> = {}) => ({
    branchId: A,
    supplierId,
    supplierReference: 'QT-2026-0457',
    notes: 'Q4 restock',
    items: [
      { productId: laptop, quantity: 10, unitCost: '1400000' },
      { productId: cable, quantity: 50, unitCost: '8000.00' },
    ],
    ...overrides,
  });

  const createPo = async (
    who: Who,
    overrides: Record<string, unknown> = {},
  ) => {
    const res = await ctx
      .http()
      .post('/api/v1/purchases')
      .set(as(who))
      .send(order(overrides));
    expect(res.status).toBe(201);
    return res.body.data as { id: string; reference: string; status: string };
  };
  const act = (
    who: Who,
    id: string,
    action: string,
    body: Record<string, unknown> = {},
  ) =>
    ctx
      .http()
      .post(`/api/v1/purchases/${id}/${action}`)
      .set(as(who))
      .send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    A = await createBranch(ctx.prisma, 'BR-A');
    B = await createBranch(ctx.prisma, 'BR-B');
    for (const [who, role, branches] of users) {
      const email = `${who.toLowerCase()}@proc.test`;
      ids[who] = await createUser(ctx.prisma, {
        email,
        roleKey: role,
        branchIds: branches(),
      });
      token[who] = (await login(ctx, email)).accessToken;
    }
    const cat = await ctx.prisma.category.create({
      data: { name: 'Laptops', nameKey: 'laptops' },
    });
    const brand = await ctx.prisma.brand.create({
      data: { name: 'HP', nameKey: 'hp' },
    });
    const mk = (
      sku: string,
      name: string,
      serialized: boolean,
      isActive = true,
    ) =>
      ctx.prisma.product.create({
        data: {
          sku,
          name,
          categoryId: cat.id,
          brandId: brand.id,
          trackingMode: serialized ? 'SERIALIZED' : 'QUANTITY',
          identifierType: serialized ? 'SERIAL' : null,
          identifiersPerUnit: serialized ? 1 : null,
          costPrice: '1',
          sellingPrice: '2',
          isActive,
        },
      });
    laptop = (await mk('HP-PB450', 'HP ProBook 450', true)).id;
    cable = (await mk('USB-C-1M', 'USB-C cable', false)).id;
    inactiveProduct = (await mk('OLD-1', 'Discontinued', false, false)).id;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ------------------------------------------------------------ suppliers
  describe('suppliers (FR-PUR-01, P11–P13)', () => {
    it('procurement officer creates a supplier; TIN and email are normalised', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/suppliers')
        .set(as('procA'))
        .send({
          name: '  Techno   Distributors Ltd ',
          contactPerson: 'Neema J.',
          phone: '+255 22 211 0000',
          email: ' Sales@Techno.CO.TZ ',
          tin: '123-456-789',
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        name: 'Techno Distributors Ltd',
        email: 'sales@techno.co.tz',
        tin: '123456789',
        isActive: true,
      });
      supplierId = res.body.data.id;
    });

    it('rejects duplicate names (case-insensitive) and duplicate TINs (409)', async () => {
      const name = await ctx
        .http()
        .post('/api/v1/suppliers')
        .set(as('admin'))
        .send({ name: 'TECHNO distributors LTD' })
        .expect(409);
      expect(name.body).toMatchObject({
        code: 'DUPLICATE_VALUE',
        details: [{ field: 'name' }],
      });
      const tin = await ctx
        .http()
        .post('/api/v1/suppliers')
        .set(as('admin'))
        .send({ name: 'Other Co', tin: '123456789' })
        .expect(409);
      expect(tin.body.details[0].field).toBe('tin');
    });

    it.each([
      [{ name: 'X', tin: '12345' }, 'tin'],
      [{ name: 'X', email: 'not-an-email' }, 'email'],
      [{ name: 'X', phone: 'call me' }, 'phone'],
      [{ name: '' }, 'name'],
      [{ name: 'X', bankAccount: '123' }, 'bankAccount'],
    ])('validates %p', async (body, field) => {
      const res = await ctx
        .http()
        .post('/api/v1/suppliers')
        .set(as('procA'))
        .send(body)
        .expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(
        field,
      );
    });

    it.each(['admin', 'managerA', 'invA', 'procA', 'auditorA'] as Who[])(
      '%s can read suppliers',
      async (who) => {
        await ctx.http().get('/api/v1/suppliers').set(as(who)).expect(200);
        await ctx
          .http()
          .get(`/api/v1/suppliers/${supplierId}`)
          .set(as(who))
          .expect(200);
      },
    );

    it.each(['cashierA', 'techA'] as Who[])(
      '%s cannot read suppliers (403)',
      async (who) => {
        await ctx.http().get('/api/v1/suppliers').set(as(who)).expect(403);
      },
    );

    it.each(['managerA', 'invA', 'cashierA', 'techA', 'auditorA'] as Who[])(
      '%s cannot create or update suppliers (403)',
      async (who) => {
        await ctx
          .http()
          .post('/api/v1/suppliers')
          .set(as(who))
          .send({ name: `S-${who}` })
          .expect(403);
        await ctx
          .http()
          .patch(`/api/v1/suppliers/${supplierId}`)
          .set(as(who))
          .send({ notes: 'x' })
          .expect(403);
      },
    );
  });

  // ------------------------------------------------------------ creating
  describe('creating purchase orders', () => {
    it('creates a DRAFT with a per-branch/year reference and server-computed totals', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(order())
        .expect(201);
      expect(res.body.data).toMatchObject({
        reference: `PO-BR-A-${YEAR}-000001`,
        status: 'DRAFT',
        branch: { id: A, code: 'BR-A' },
        supplier: { id: supplierId },
        currency: 'TZS',
        pricesIncludeTax: false,
        subtotal: '14400000.00',
        createdBy: { id: ids.procA },
        submittedBy: null,
        approvedBy: null,
      });
      expect(res.body.data.items).toEqual([
        expect.objectContaining({
          lineNumber: 1,
          sku: 'HP-PB450',
          productName: 'HP ProBook 450',
          trackingMode: 'SERIALIZED',
          quantityOrdered: 10,
          quantityReceived: 0,
          unitCost: '1400000.00',
          lineTotal: '14000000.00',
        }),
        expect.objectContaining({
          lineNumber: 2,
          sku: 'USB-C-1M',
          quantityOrdered: 50,
          unitCost: '8000.00',
          lineTotal: '400000.00',
        }),
      ]);
    });

    it('numbers independently per branch and year (P6)', async () => {
      expect((await createPo('procA')).reference).toBe(
        `PO-BR-A-${YEAR}-000002`,
      );
      expect((await createPo('procB', { branchId: B })).reference).toBe(
        `PO-BR-B-${YEAR}-000001`,
      );
    });

    it('gives concurrent creates distinct consecutive numbers', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          ctx.http().post('/api/v1/purchases').set(as('procA')).send(order()),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const refs = results.map((r) => r.body.data.reference).sort();
      expect(new Set(refs).size).toBe(5);
      expect(refs).toEqual(
        [3, 4, 5, 6, 7].map((n) => `PO-BR-A-${YEAR}-00000${n}`),
      );
    });

    it('refuses another branch (403 BRANCH_ACCESS_DENIED)', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(order({ branchId: B }))
        .expect(403);
      expect(res.body.code).toBe('BRANCH_ACCESS_DENIED');
    });

    it.each([
      [{ items: [] }, 'VALIDATION_ERROR'],
      [
        { items: [{ productId: laptopId(), quantity: 0, unitCost: '1' }] },
        'VALIDATION_ERROR',
      ],
      [
        { items: [{ productId: laptopId(), quantity: 1.5, unitCost: '1' }] },
        'VALIDATION_ERROR',
      ],
      [
        { items: [{ productId: laptopId(), quantity: 1, unitCost: '0.00' }] },
        'VALIDATION_ERROR',
      ],
      [
        { items: [{ productId: laptopId(), quantity: 1, unitCost: 1000 }] },
        'VALIDATION_ERROR',
      ],
      [
        {
          items: [
            {
              productId: laptopId(),
              quantity: 1_000_000,
              unitCost: '999999999',
            },
          ],
        },
        'VALIDATION_ERROR',
      ],
      [{ subtotal: '1.00' }, 'VALIDATION_ERROR'],
      [{ expectedDeliveryDate: '2020-01-01' }, 'VALIDATION_ERROR'],
      [{ expectedDeliveryDate: '2026-02-30' }, 'VALIDATION_ERROR'],
      [
        {
          items: [
            { productId: laptopId(), quantity: 1, unitCost: '1' },
            { productId: laptopId(), quantity: 2, unitCost: '1' },
          ],
        },
        'DUPLICATE_PRODUCT_LINE',
      ],
    ])('rejects invalid order %#', async (overrides, code) => {
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(order(resolve(overrides)))
        .expect(400);
      expect(res.body.code).toBe(code);
    });

    it('rejects inactive products (US-03) and unknown references', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(
          order({
            items: [{ productId: inactiveProduct, quantity: 1, unitCost: '1' }],
          }),
        )
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'REFERENCE_INACTIVE',
        details: [{ field: 'items.0.productId' }],
      });
      await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(order({ supplierId: '00000000-0000-4000-8000-000000000000' }))
        .expect(404);
    });

    it('accepts an optional future delivery date (P16)', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(order({ expectedDeliveryDate: `${Number(YEAR) + 1}-01-15` }))
        .expect(201);
      expect(res.body.data.expectedDeliveryDate).toBe(
        `${Number(YEAR) + 1}-01-15`,
      );
    });

    it.each(['managerA', 'invA', 'cashierA', 'techA', 'auditorA'] as Who[])(
      '%s cannot create orders (403)',
      async (who) => {
        await ctx
          .http()
          .post('/api/v1/purchases')
          .set(as(who))
          .send(order())
          .expect(403);
      },
    );
  });

  // ----------------------------------------------------- reading & scope
  describe('reading and branch isolation', () => {
    it.each(['admin', 'managerA', 'invA', 'procA', 'auditorA'] as Who[])(
      '%s lists only in-scope orders',
      async (who) => {
        const res = await ctx
          .http()
          .get('/api/v1/purchases?limit=100')
          .set(as(who))
          .expect(200);
        const branches = new Set(
          res.body.data.map((p: { branch: { id: string } }) => p.branch.id),
        );
        if (who === 'admin') expect(branches).toEqual(new Set([A, B]));
        else expect(branches).toEqual(new Set([A]));
      },
    );

    it('returns 403 for another branch and for non-procurement roles', async () => {
      const bOrder = await ctx.prisma.purchase.findFirstOrThrow({
        where: { branchId: B },
      });
      for (const who of ['managerA', 'procA', 'auditorA', 'invA'] as Who[]) {
        const res = await ctx
          .http()
          .get(`/api/v1/purchases/${bOrder.id}`)
          .set(as(who))
          .expect(403);
        expect(res.body.code).toBe('BRANCH_ACCESS_DENIED');
      }
      await ctx
        .http()
        .get(`/api/v1/purchases?branchId=${B}`)
        .set(as('managerA'))
        .expect(403);
      for (const who of ['cashierA', 'techA'] as Who[]) {
        await ctx.http().get('/api/v1/purchases').set(as(who)).expect(403);
      }
    });
  });

  // ------------------------------------------------------- editing (P4)
  describe('editing drafts', () => {
    it('another procurement officer of the branch can edit; the creator stays unchanged', async () => {
      const po = await createPo('procA');
      const res = await ctx
        .http()
        .patch(`/api/v1/purchases/${po.id}`)
        .set(as('procA2'))
        .send({
          notes: 'Revised',
          items: [{ productId: cable, quantity: 100, unitCost: '7500' }],
        })
        .expect(200);
      expect(res.body.data).toMatchObject({
        notes: 'Revised',
        subtotal: '750000.00',
        createdBy: { id: ids.procA },
        updatedBy: { id: ids.procA2 },
        items: [
          expect.objectContaining({ lineNumber: 1, quantityOrdered: 100 }),
        ],
      });
      const e = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: po.id, action: 'purchase.updated' },
      });
      expect(e.actorId).toBe(ids.procA2);
      expect(e.metadata).toMatchObject({
        lines: {
          from: [
            { productId: laptop, quantity: 10 },
            { productId: cable, quantity: 50 },
          ],
          to: [{ productId: cable, quantity: 100, unitCost: '7500.00' }],
        },
      });
    });

    it('the branch can never change; officers of another branch cannot edit', async () => {
      const po = await createPo('procA');
      await ctx
        .http()
        .patch(`/api/v1/purchases/${po.id}`)
        .set(as('procA'))
        .send({ branchId: B })
        .expect(400);
      await ctx
        .http()
        .patch(`/api/v1/purchases/${po.id}`)
        .set(as('procB'))
        .send({ notes: 'x' })
        .expect(403);
      await act('procB', po.id, 'submit').expect(403);
      const after = await ctx.prisma.purchase.findUniqueOrThrow({
        where: { id: po.id },
      });
      expect(after).toMatchObject({
        status: 'DRAFT',
        notes: 'Q4 restock',
        updatedById: ids.procA,
      });
    });

    it('only DRAFT orders are editable (409 PURCHASE_NOT_EDITABLE)', async () => {
      const po = await createPo('procA');
      await act('procA', po.id, 'submit').expect(200);
      const res = await ctx
        .http()
        .patch(`/api/v1/purchases/${po.id}`)
        .set(as('procA'))
        .send({ notes: 'late' })
        .expect(409);
      expect(res.body.code).toBe('PURCHASE_NOT_EDITABLE');
    });
  });

  // ------------------------------------------ separation of duties (P3)
  describe('approval, rejection and separation of duties', () => {
    it('procurement officer submits; a manager of the branch approves (audited)', async () => {
      const po = await createPo('procA');
      const sub = await act('procA', po.id, 'submit').expect(200);
      expect(sub.body.data).toMatchObject({
        status: 'SUBMITTED',
        submittedBy: { id: ids.procA },
      });
      await act('procA', po.id, 'approve').expect(403); // no procurement:approve
      const res = await act('managerA', po.id, 'approve', {
        note: 'Within budget',
      }).expect(200);
      expect(res.body.data).toMatchObject({
        status: 'APPROVED',
        approvedBy: { id: ids.managerA },
        approvalNote: 'Within budget',
      });
      const e = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: po.id, action: 'purchase.approved' },
      });
      expect(e).toMatchObject({ actorId: ids.managerA, branchId: A });
    });

    it('SYSTEM_ADMIN cannot approve or reject an order they created — blocked and audited', async () => {
      const po = await createPo('admin');
      await act('admin', po.id, 'submit').expect(200);
      for (const action of ['approve', 'reject']) {
        const res = await act(
          'admin',
          po.id,
          action,
          action === 'reject' ? { reason: 'Not needed now' } : {},
        ).expect(403);
        expect(res.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
      }
      const blocked = await ctx.prisma.auditLog.findMany({
        where: { entityId: po.id, action: 'purchase.approval_blocked' },
      });
      expect(blocked).toHaveLength(2);
      expect(blocked[0]).toMatchObject({ actorId: ids.admin, branchId: A });
      expect(
        (await ctx.prisma.purchase.findUniqueOrThrow({ where: { id: po.id } }))
          .status,
      ).toBe('SUBMITTED');
      await act('admin2', po.id, 'approve').expect(200); // a different admin may
    });

    it("the submitter is excluded too (admin submits an officer's draft)", async () => {
      const po = await createPo('procA');
      await act('admin', po.id, 'submit').expect(200);
      expect((await act('admin', po.id, 'approve').expect(403)).body.code).toBe(
        'SELF_APPROVAL_FORBIDDEN',
      );
      await act('managerA', po.id, 'approve').expect(200);
    });

    it('a creator promoted to MANAGER still cannot approve their own order', async () => {
      const id = await createUser(ctx.prisma, {
        email: 'promoted@proc.test',
        roleKey: 'PROCUREMENT_OFFICER',
        branchIds: [A],
      });
      const t1 = (await login(ctx, 'promoted@proc.test')).accessToken;
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(bearer(t1))
        .send(order())
        .expect(201);
      await ctx
        .http()
        .post(`/api/v1/purchases/${res.body.data.id}/submit`)
        .set(bearer(t1))
        .expect(200);
      await ctx
        .http()
        .patch(`/api/v1/users/${id}`)
        .set(as('admin'))
        .send({ roleKey: 'MANAGER', branchIds: [A] })
        .expect(200);
      const blocked = await ctx
        .http()
        .post(`/api/v1/purchases/${res.body.data.id}/approve`)
        .set(bearer(t1))
        .send({})
        .expect(403);
      expect(blocked.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
    });

    it('an earlier-cycle submitter stays excluded after reject → reopen → resubmit', async () => {
      const po = await createPo('procA');
      await act('admin', po.id, 'submit').expect(200);
      await act('managerA', po.id, 'reject', {
        reason: 'Quote expired',
      }).expect(200);
      await act('procA', po.id, 'reopen').expect(200);
      await act('procA', po.id, 'submit').expect(200); // current submitter now procA
      expect((await act('admin', po.id, 'approve').expect(403)).body.code).toBe(
        'SELF_APPROVAL_FORBIDDEN',
      );
      await act('admin2', po.id, 'approve').expect(200);
    });

    it("approvers must have the order's branch in scope", async () => {
      const po = await createPo('procA');
      await act('procA', po.id, 'submit').expect(200);
      expect(
        (await act('managerB', po.id, 'approve').expect(403)).body.code,
      ).toBe('BRANCH_ACCESS_DENIED');
      expect(
        (
          await act('managerB', po.id, 'reject', {
            reason: 'Not my branch',
          }).expect(403)
        ).body.code,
      ).toBe('BRANCH_ACCESS_DENIED');
      expect(
        (
          await act('procB', po.id, 'cancel', {
            reason: 'Not my branch',
          }).expect(403)
        ).body.code,
      ).toBe('BRANCH_ACCESS_DENIED');
      // Nothing may have changed — the refusal must happen BEFORE any write.
      const after = await ctx.prisma.purchase.findUniqueOrThrow({
        where: { id: po.id },
      });
      expect(after).toMatchObject({
        status: 'SUBMITTED',
        approvedById: null,
        rejectedById: null,
        cancelledById: null,
      });
      expect(
        await ctx.prisma.auditLog.count({
          where: {
            entityId: po.id,
            actorId: { in: [ids.managerB!, ids.procB!] },
          },
        }),
      ).toBe(0);
    });

    it('rejection needs a reason; reopen returns a DRAFT with rejection data cleared (history audited)', async () => {
      const po = await createPo('procA');
      await act('procA', po.id, 'submit').expect(200);
      await act('managerA', po.id, 'reject', {}).expect(400);
      await act('managerA', po.id, 'reject', { reason: 'no' }).expect(400);
      const rej = await act('managerA', po.id, 'reject', {
        reason: 'Supplier quote expired',
      }).expect(200);
      expect(rej.body.data).toMatchObject({
        status: 'REJECTED',
        rejectedBy: { id: ids.managerA },
        rejectionReason: 'Supplier quote expired',
      });
      const re = await act('procA2', po.id, 'reopen').expect(200);
      expect(re.body.data).toMatchObject({
        status: 'DRAFT',
        rejectedBy: null,
        rejectionReason: null,
        submittedBy: null,
        createdBy: { id: ids.procA },
      });
      const ev = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: po.id, action: 'purchase.reopened' },
      });
      expect(ev.metadata).toMatchObject({
        previousRejection: {
          rejectionReason: 'Supplier quote expired',
          rejectedById: ids.managerA,
        },
      });
    });

    it('re-checks references at submission (inactive product → 400)', async () => {
      const po = await createPo('procA');
      await ctx.prisma.product.update({
        where: { id: cable },
        data: { isActive: false },
      });
      try {
        const res = await act('procA', po.id, 'submit').expect(400);
        expect(res.body.code).toBe('REFERENCE_INACTIVE');
      } finally {
        await ctx.prisma.product.update({
          where: { id: cable },
          data: { isActive: true },
        });
      }
    });

    it('enforces the lifecycle (409 INVALID_STATUS_TRANSITION)', async () => {
      const po = await createPo('procA');
      expect(
        (await act('managerA', po.id, 'approve').expect(409)).body.code,
      ).toBe('INVALID_STATUS_TRANSITION');
      await act('procA', po.id, 'reopen').expect(409);
      await act('procA', po.id, 'submit').expect(200);
      await act('procA', po.id, 'submit').expect(409);
      await act('managerA', po.id, 'approve').expect(200);
      await act('managerA', po.id, 'reject', { reason: 'too late now' }).expect(
        409,
      );
      await act('procA', po.id, 'reopen').expect(409);
    });
  });

  // ------------------------------------------------------ cancellation (P5)
  describe('cancellation', () => {
    it('DRAFT/SUBMITTED/REJECTED: procurement:write with a reason', async () => {
      const draft = await createPo('procA');
      await act('procA', draft.id, 'cancel', {}).expect(400);
      const res = await act('procA', draft.id, 'cancel', {
        reason: 'Duplicate order',
      }).expect(200);
      expect(res.body.data).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: { id: ids.procA },
        cancellationReason: 'Duplicate order',
      });
      const sub = await createPo('procA');
      await act('procA', sub.id, 'submit').expect(200);
      await act('procA2', sub.id, 'cancel', {
        reason: 'Supplier closed',
      }).expect(200);
      await act('procA2', sub.id, 'cancel', { reason: 'again please' }).expect(
        409,
      );
    });

    it('a manager (approve only) cannot cancel an unapproved order', async () => {
      const draft = await createPo('procA');
      await act('managerA', draft.id, 'cancel', {
        reason: 'Not my call',
      }).expect(403);
    });

    it('APPROVED: only procurement:approve, and only while nothing is received', async () => {
      const po = await createPo('procA');
      await act('procA', po.id, 'submit').expect(200);
      await act('managerA', po.id, 'approve').expect(200);
      await act('procA', po.id, 'cancel', { reason: 'Changed my mind' }).expect(
        403,
      );
      await act('managerA', po.id, 'cancel', {
        reason: 'Budget withdrawn',
      }).expect(200);
      const ev = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: po.id, action: 'purchase.cancelled' },
      });
      expect(ev.metadata).toMatchObject({
        reason: 'Budget withdrawn',
        previousStatus: 'APPROVED',
      });

      const po2 = await createPo('procA');
      await act('procA', po2.id, 'submit').expect(200);
      await act('managerA', po2.id, 'approve').expect(200);
      // Simulate Module 5 having received one unit (the only change the DB allows).
      await ctx.prisma.purchaseItem.updateMany({
        where: { purchaseId: po2.id, lineNumber: 1 },
        data: { quantityReceived: 1 },
      });
      const res = await act('managerA', po2.id, 'cancel', {
        reason: 'Too late now',
      }).expect(409);
      expect(res.body.message).toMatch(/already been received/);
    });
  });

  // ----------------------------------------------------------- concurrency
  describe('concurrency', () => {
    it('approve vs reject vs approve on the same order: exactly one wins', async () => {
      const po = await createPo('procA');
      await act('procA', po.id, 'submit').expect(200);
      const results = await Promise.all([
        act('managerA', po.id, 'approve'),
        act('admin2', po.id, 'reject', { reason: 'Racing reject' }),
        act('admin', po.id, 'approve'),
      ]);
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('INVALID_STATUS_TRANSITION');
      }
      const final = await ctx.prisma.purchase.findUniqueOrThrow({
        where: { id: po.id },
      });
      expect(final.status).toBe(ok[0].body.data.status);
    });
  });

  // ------------------------------------------------- supplier deactivation
  describe('supplier deactivation (P12)', () => {
    it('is blocked while open orders exist; allowed after; inactive suppliers cannot be used', async () => {
      const s = await ctx
        .http()
        .post('/api/v1/suppliers')
        .set(as('procA'))
        .send({ name: 'Short-lived Supplies' })
        .expect(201);
      const po = await createPo('procA', { supplierId: s.body.data.id });
      const blocked = await ctx
        .http()
        .patch(`/api/v1/suppliers/${s.body.data.id}`)
        .set(as('procA'))
        .send({ isActive: false })
        .expect(409);
      expect(blocked.body.code).toBe('SUPPLIER_IN_USE');
      await act('procA', po.id, 'cancel', { reason: 'Supplier exit' }).expect(
        200,
      );
      await ctx
        .http()
        .patch(`/api/v1/suppliers/${s.body.data.id}`)
        .set(as('procA'))
        .send({ isActive: false })
        .expect(200);
      const res = await ctx
        .http()
        .post('/api/v1/purchases')
        .set(as('procA'))
        .send(order({ supplierId: s.body.data.id }))
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'REFERENCE_INACTIVE',
        details: [{ field: 'supplierId' }],
      });
    });
  });

  // --------------------------------------------------- database guarantees
  describe('database guarantees (integration)', () => {
    it('refuses self-approval even when written directly (SoD CHECK)', async () => {
      const po = await createPo('procA');
      await act('procA', po.id, 'submit').expect(200);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchases SET status='APPROVED', approved_by_id=created_by_id, approved_at=now() WHERE id='${po.id}'`,
        ),
      ).rejects.toThrow(/purchases_sod_approver_chk/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchases SET status='REJECTED', rejected_by_id=submitted_by_id, rejected_at=now(), rejection_reason='self reject' WHERE id='${po.id}'`,
        ),
      ).rejects.toThrow(/purchases_sod_rejecter_chk/);
    });

    it('enforces status consistency, line locks, immutability and arithmetic', async () => {
      const po = await createPo('procA');
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchases SET status='APPROVED' WHERE id='${po.id}'`,
        ),
      ).rejects.toThrow(/purchases_status_consistency_chk/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchases SET reference='PO-BR-A-2099-000001' WHERE id='${po.id}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchase_items SET line_total = line_total + 1 WHERE purchase_id='${po.id}'`,
        ),
      ).rejects.toThrow(/purchase_items_cost_chk/);

      await act('procA', po.id, 'submit').expect(200);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchase_items SET quantity_ordered = 1 WHERE purchase_id='${po.id}'`,
        ),
      ).rejects.toThrow(/locked/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `DELETE FROM purchase_items WHERE purchase_id='${po.id}'`,
        ),
      ).rejects.toThrow(/locked/);
      // SUBMITTED: even quantity_received is locked (only APPROVED/PARTIALLY_RECEIVED allow it).
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchase_items SET quantity_received = 1 WHERE purchase_id='${po.id}'`,
        ),
      ).rejects.toThrow(/locked/);
      await act('managerA', po.id, 'approve').expect(200);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchase_items SET unit_cost = 1, line_total = quantity_ordered WHERE purchase_id='${po.id}'`,
        ),
      ).rejects.toThrow(/locked/);
      // The Module 5 hook: quantity_received only, within quantity_ordered.
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE purchase_items SET quantity_received = 1 WHERE purchase_id='${po.id}' AND line_number = 1`,
      );
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE purchase_items SET quantity_received = quantity_ordered + 1 WHERE purchase_id='${po.id}'`,
        ),
      ).rejects.toThrow(/purchase_items_quantities_chk/);
    });
  });

  // ------------------------------------------------------ audit visibility
  describe('audit visibility', () => {
    it("managers/auditors see their branch's purchase events and all supplier events, but not other branches or logins", async () => {
      for (const who of ['managerA', 'auditorA'] as Who[]) {
        const res = await ctx
          .http()
          .get('/api/v1/audit-logs?limit=100')
          .set(as(who))
          .expect(200);
        const events = res.body.data as {
          action: string;
          entityType: string;
          branchId: string | null;
        }[];
        expect(events.some((e) => e.action === 'purchase.approved')).toBe(true);
        expect(events.some((e) => e.action === 'supplier.created')).toBe(true);
        for (const e of events) {
          if (e.entityType === 'Purchase') expect(e.branchId).toBe(A);
          expect(e.action.startsWith('auth.')).toBe(false);
        }
      }
      const mgrB = await ctx
        .http()
        .get('/api/v1/audit-logs?entityType=Purchase&limit=100')
        .set(as('managerB'))
        .expect(200);
      for (const e of mgrB.body.data) expect(e.branchId).toBe(B);
    });
  });

  // -------------------------------------------------------- Module 5 hand-off
  describe('Module 5 hand-off', () => {
    it('inventory officers list APPROVED orders with creator, approver and line quantities', async () => {
      const res = await ctx
        .http()
        .get(`/api/v1/purchases?status=APPROVED&branchId=${A}&limit=100`)
        .set(as('invA'))
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const po of res.body.data) {
        expect(po.status).toBe('APPROVED');
        expect(po.createdBy.id).toBeDefined();
        expect(po.approvedBy.id).toBeDefined();
        expect(po.createdBy.id).not.toBe(po.approvedBy.id);
        for (const line of po.items) {
          expect(line).toEqual(
            expect.objectContaining({
              quantityOrdered: expect.any(Number),
              quantityReceived: expect.any(Number),
            }),
          );
        }
      }
    });

    it('awaitingMyApproval lists SUBMITTED orders the caller may act on', async () => {
      const mine = await createPo('admin');
      await act('admin', mine.id, 'submit').expect(200);
      const other = await createPo('procA');
      await act('procA', other.id, 'submit').expect(200);
      const res = await ctx
        .http()
        .get('/api/v1/purchases?awaitingMyApproval=true&limit=100')
        .set(as('admin'))
        .expect(200);
      const idsListed = res.body.data.map((p: { id: string }) => p.id);
      expect(idsListed).toContain(other.id);
      expect(idsListed).not.toContain(mine.id);
      const none = await ctx
        .http()
        .get('/api/v1/purchases?awaitingMyApproval=true')
        .set(as('procA'))
        .expect(200);
      expect(none.body.data).toEqual([]);
    });

    it('no receive endpoint exists in Module 4', async () => {
      const po = await ctx.prisma.purchase.findFirstOrThrow({
        where: { status: 'APPROVED' },
      });
      await act('invA', po.id, 'receive').expect(404);
    });
  });

  // helpers that need the product id at call time
  function laptopId() {
    return '__LAPTOP__';
  }
  function resolve(o: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(o).split('__LAPTOP__').join(laptop));
  }
});
