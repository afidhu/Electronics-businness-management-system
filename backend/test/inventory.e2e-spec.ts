import { randomUUID } from 'node:crypto';
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
  | 'managerA'
  | 'procA'
  | 'procA2'
  | 'invA'
  | 'invB'
  | 'cashierA'
  | 'techA'
  | 'auditorA';

const YEAR = String(new Date().getUTCFullYear());

/** Valid 15-digit IMEI from a 14-digit body (Luhn check digit). */
function imei(body14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body14[13 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body14 + String((10 - (sum % 10)) % 10);
}
let imeiSeq = 35209900000000;
const nextImei = () => imei(String(imeiSeq++));
let serialSeq = 1000;
const nextSerial = () => `5CG${serialSeq++}XYZ`;

describe('Inventory — Module 5 stage 5.1 (e2e)', () => {
  let ctx: TestContext;
  let A: string;
  let B: string;
  const token: Partial<Record<Who, string>> = {};
  const ids: Partial<Record<Who, string>> = {};
  const as = (who: Who) => bearer(token[who]!);
  let supplierId: string;
  let laptop: string; // SERIALIZED, SERIAL ×1
  let phone: string; // SERIALIZED, IMEI ×2
  let cable: string; // QUANTITY

  const users: [Who, RoleKey, () => string[]][] = [
    ['admin', 'SYSTEM_ADMIN', () => []],
    ['managerA', 'MANAGER', () => [A]],
    ['procA', 'PROCUREMENT_OFFICER', () => [A]],
    ['procA2', 'PROCUREMENT_OFFICER', () => [A]],
    ['invA', 'INVENTORY_OFFICER', () => [A]],
    ['invB', 'INVENTORY_OFFICER', () => [B]],
    ['cashierA', 'CASHIER', () => [A]],
    ['techA', 'TECHNICIAN', () => [A]],
    ['auditorA', 'AUDITOR', () => [A]],
  ];

  const http = () => ctx.http();
  const post = (who: Who, url: string, body: unknown = {}) =>
    http()
      .post(url)
      .set(as(who))
      .send(body as object);

  /** procA creates + submits, managerA approves (unless overridden). */
  async function approvedPo(
    items: { productId: string; quantity: number; unitCost: string }[],
    opts: { submitter?: Who; approver?: Who; branchId?: string } = {},
  ) {
    const created = await post('procA', '/api/v1/purchases', {
      branchId: opts.branchId ?? A,
      supplierId,
      items,
    }).expect(201);
    const id = created.body.data.id as string;
    await post(
      opts.submitter ?? 'procA',
      `/api/v1/purchases/${id}/submit`,
    ).expect(200);
    await post(
      opts.approver ?? 'managerA',
      `/api/v1/purchases/${id}/approve`,
    ).expect(200);
    const po = await http()
      .get(`/api/v1/purchases/${id}`)
      .set(as('admin'))
      .expect(200);
    return {
      id,
      lines: po.body.data.items as { productId: string; lineNumber: number }[],
      ref: po.body.data.reference,
    };
  }
  const lineId = async (poId: string, productId: string) =>
    (
      await ctx.prisma.purchaseItem.findFirstOrThrow({
        where: { purchaseId: poId, productId },
      })
    ).id;
  const receive = (who: Who, poId: string, body: Record<string, unknown>) =>
    post(who, `/api/v1/purchases/${poId}/receive`, {
      idempotencyKey: randomUUID(),
      ...body,
    });
  const balance = async (productId: string, branchId = A) =>
    (
      await ctx.prisma.stockBalance.findUnique({
        where: { productId_branchId: { productId, branchId } },
      })
    )?.onHand ?? 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    A = await createBranch(ctx.prisma, 'BR-A');
    B = await createBranch(ctx.prisma, 'BR-B');
    for (const [who, role, branches] of users) {
      const email = `${who.toLowerCase()}@inv.test`;
      ids[who] = await createUser(ctx.prisma, {
        email,
        roleKey: role,
        branchIds: branches(),
      });
      token[who] = (await login(ctx, email)).accessToken;
    }
    const cat = await ctx.prisma.category.create({
      data: { name: 'Devices', nameKey: 'devices' },
    });
    const brand = await ctx.prisma.brand.create({
      data: { name: 'Generic', nameKey: 'generic' },
    });
    const mk = (
      sku: string,
      mode: 'SERIALIZED' | 'QUANTITY',
      type: 'IMEI' | 'SERIAL' | null,
      per: number | null,
    ) =>
      ctx.prisma.product.create({
        data: {
          sku,
          name: sku,
          categoryId: cat.id,
          brandId: brand.id,
          trackingMode: mode,
          identifierType: type,
          identifiersPerUnit: per,
          costPrice: '999',
          sellingPrice: '1999',
          reorderLevel: 2,
        },
      });
    laptop = (await mk('LAPTOP-1', 'SERIALIZED', 'SERIAL', 1)).id;
    phone = (await mk('PHONE-DS', 'SERIALIZED', 'IMEI', 2)).id;
    cable = (await mk('CABLE-1M', 'QUANTITY', null, null)).id;
    supplierId = (
      await ctx.prisma.supplier.create({
        data: { name: 'Supplier', nameKey: 'supplier' },
      })
    ).id;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ------------------------------------------------ API-only receiving
  it('receives using the line id from GET /purchases/:id (no database lookup)', async () => {
    const po = await approvedPo([
      { productId: cable, quantity: 3, unitCost: '1000' },
    ]);
    const detail = await http()
      .get(`/api/v1/purchases/${po.id}`)
      .set(as('invA'))
      .expect(200);
    const line = detail.body.data.items[0];
    expect(line).toMatchObject({
      productId: cable,
      trackingMode: 'QUANTITY',
      identifierType: null,
      identifiersPerUnit: null,
    });
    await receive('invA', po.id, {
      items: [{ purchaseItemId: line.id, quantity: 3 }],
    }).expect(201);
  });

  // ------------------------------------------------------------ BR-14
  describe('BR-14 separation of duties (I4, I22)', () => {
    it('creator/submitter cannot receive; blocked attempt audited; nothing changes', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 5, unitCost: '1000' },
      ]);
      const item = await lineId(po.id, cable);
      const res = await receive('procA', po.id, {
        items: [{ purchaseItemId: item, quantity: 5 }],
      }).expect(403);
      expect(res.body.code).toBe('SELF_RECEIVING_FORBIDDEN');
      expect(
        await ctx.prisma.goodsReceipt.count({ where: { purchaseId: po.id } }),
      ).toBe(0);
      expect(
        (
          await ctx.prisma.purchaseItem.findUniqueOrThrow({
            where: { id: item },
          })
        ).quantityReceived,
      ).toBe(0);
      expect(
        await ctx.prisma.auditLog.count({
          where: {
            entityId: po.id,
            action: 'goods_receipt.blocked',
            actorId: ids.procA,
          },
        }),
      ).toBe(1);
    });

    it('a different submitter cannot receive', async () => {
      const po = await approvedPo(
        [{ productId: cable, quantity: 1, unitCost: '1000' }],
        { submitter: 'procA2' },
      );
      const item = await lineId(po.id, cable);
      expect(
        (
          await receive('procA2', po.id, {
            items: [{ purchaseItemId: item, quantity: 1 }],
          }).expect(403)
        ).body.code,
      ).toBe('SELF_RECEIVING_FORBIDDEN');
      await receive('invA', po.id, {
        items: [{ purchaseItemId: item, quantity: 1 }],
      }).expect(201);
    });

    it('SYSTEM_ADMIN who approved cannot receive; nor an earlier-cycle submitter', async () => {
      const po = await approvedPo(
        [{ productId: cable, quantity: 1, unitCost: '1000' }],
        { approver: 'admin' },
      );
      const item = await lineId(po.id, cable);
      expect(
        (
          await receive('admin', po.id, {
            items: [{ purchaseItemId: item, quantity: 1 }],
          }).expect(403)
        ).body.code,
      ).toBe('SELF_RECEIVING_FORBIDDEN');

      // admin submits, manager rejects, procA reopens + resubmits, manager approves → admin still blocked.
      const created = await post('procA', '/api/v1/purchases', {
        branchId: A,
        supplierId,
        items: [{ productId: cable, quantity: 1, unitCost: '1000' }],
      }).expect(201);
      const id = created.body.data.id;
      await post('admin', `/api/v1/purchases/${id}/submit`).expect(200);
      await post('managerA', `/api/v1/purchases/${id}/reject`, {
        reason: 'Revise please',
      }).expect(200);
      await post('procA', `/api/v1/purchases/${id}/reopen`).expect(200);
      await post('procA', `/api/v1/purchases/${id}/submit`).expect(200);
      await post('managerA', `/api/v1/purchases/${id}/approve`).expect(200);
      const item2 = await lineId(id, cable);
      expect(
        (
          await receive('admin', id, {
            items: [{ purchaseItemId: item2, quantity: 1 }],
          }).expect(403)
        ).body.code,
      ).toBe('SELF_RECEIVING_FORBIDDEN');
    });

    it.each(['managerA', 'cashierA', 'techA', 'auditorA'] as Who[])(
      '%s lacks inventory:receive (403)',
      async (who) => {
        const po = await ctx.prisma.purchase.findFirstOrThrow({
          where: { status: 'APPROVED' },
        });
        expect(
          (
            await receive(who, po.id, {
              items: [{ purchaseItemId: randomUUID(), quantity: 1 }],
            }).expect(403)
          ).body.code,
        ).toBe('PERMISSION_DENIED');
      },
    );
  });

  // ----------------------------------------------------- partial/complete
  describe('partial and complete receiving', () => {
    let po: { id: string };
    let laptopLine: string;
    let cableLine: string;

    it('partial receipt: serialized + quantity → PARTIALLY_RECEIVED, stock and ledger updated', async () => {
      po = await approvedPo([
        { productId: laptop, quantity: 3, unitCost: '1400000' },
        { productId: cable, quantity: 50, unitCost: '8000' },
      ]);
      laptopLine = await lineId(po.id, laptop);
      cableLine = await lineId(po.id, cable);
      const s1 = nextSerial();
      const res = await receive('invA', po.id, {
        supplierDeliveryRef: 'DN-1',
        supplierInvoiceRef: 'INV-1',
        items: [
          {
            purchaseItemId: laptopLine,
            quantity: 1,
            units: [{ identifiers: [` ${s1.toLowerCase()} `] }],
          },
          { purchaseItemId: cableLine, quantity: 20 },
        ],
      }).expect(201);
      expect(res.body.data).toMatchObject({
        reference: expect.stringMatching(
          new RegExp(`^GRN-BR-A-${YEAR}-\\d{6}$`),
        ),
        purchase: { id: po.id, status: 'PARTIALLY_RECEIVED' },
        receivedBy: { id: ids.invA },
        supplierDeliveryRef: 'DN-1',
        supplierInvoiceRef: 'INV-1',
      });
      const laptopItem = res.body.data.items.find(
        (i: { productId: string }) => i.productId === laptop,
      );
      expect(laptopItem).toMatchObject({ quantity: 1, unitCost: '1400000.00' });
      expect(laptopItem.units[0].identifiers).toEqual([
        { type: 'SERIAL', value: s1, isPrimary: true },
      ]);
      const units = await ctx.prisma.productUnit.findMany({
        where: { productId: laptop, branchId: A },
      });
      expect(units.length).toBeGreaterThanOrEqual(1);
      expect(
        await ctx.prisma.stockMovement.count({
          where: { referenceId: res.body.data.id },
        }),
      ).toBe(2);
      const ev = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: res.body.data.id, action: 'goods_receipt.created' },
      });
      expect(ev).toMatchObject({ actorId: ids.invA, branchId: A });
    });

    it('rejects over-receiving with nothing changed (I3)', async () => {
      const before = await balance(cable);
      const res = await receive('invA', po.id, {
        items: [{ purchaseItemId: cableLine, quantity: 31 }],
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'OVER_RECEIVING',
        details: [{ field: 'items.0.quantity' }],
      });
      expect(await balance(cable)).toBe(before);
    });

    it('receiving the remainder completes the order → RECEIVED', async () => {
      const res = await receive('procA2', po.id, {
        items: [
          {
            purchaseItemId: laptopLine,
            quantity: 2,
            units: [
              { identifiers: [nextSerial()] },
              { identifiers: [nextSerial()] },
            ],
          },
          { purchaseItemId: cableLine, quantity: 30 },
        ],
      }).expect(201);
      expect(res.body.data.purchase.status).toBe('RECEIVED');
      const lines = await ctx.prisma.purchaseItem.findMany({
        where: { purchaseId: po.id },
      });
      for (const l of lines) expect(l.quantityReceived).toBe(l.quantityOrdered);
      await receive('invA', po.id, {
        items: [{ purchaseItemId: cableLine, quantity: 1 }],
      }).expect(409); // RECEIVED
    });
  });

  // ------------------------------------------------------- identifiers
  describe('serialized identifiers (D3, BR-17)', () => {
    let po: { id: string };
    let phoneLine: string;
    let laptopLine: string;
    let cableLine: string;
    beforeAll(async () => {
      po = await approvedPo([
        { productId: phone, quantity: 10, unitCost: '380000' },
        { productId: laptop, quantity: 10, unitCost: '1400000' },
        { productId: cable, quantity: 10, unitCost: '8000' },
      ]);
      phoneLine = await lineId(po.id, phone);
      laptopLine = await lineId(po.id, laptop);
      cableLine = await lineId(po.id, cable);
    });

    it('registers a dual-SIM phone with two IMEIs (normalised)', async () => {
      const [i1, i2] = [nextImei(), nextImei()];
      const res = await receive('invA', po.id, {
        items: [
          {
            purchaseItemId: phoneLine,
            quantity: 1,
            units: [
              {
                identifiers: [
                  `${i1.slice(0, 2)}-${i1.slice(2, 8)} ${i1.slice(8)}`,
                  i2,
                ],
              },
            ],
          },
        ],
      }).expect(201);
      expect(res.body.data.items[0].units[0].identifiers).toEqual([
        { type: 'IMEI', value: i1, isPrimary: true },
        { type: 'IMEI', value: i2, isPrimary: false },
      ]);
    });

    it.each([
      [
        'bad IMEI check digit',
        () => ({
          purchaseItemId: phoneLine,
          quantity: 1,
          units: [{ identifiers: [nextImei().slice(0, 14) + '0', nextImei()] }],
        }),
        'INVALID_IDENTIFIER',
      ],
      [
        'one IMEI for a dual-SIM phone',
        () => ({
          purchaseItemId: phoneLine,
          quantity: 1,
          units: [{ identifiers: [nextImei()] }],
        }),
        'IDENTIFIER_COUNT_MISMATCH',
      ],
      [
        'units missing for serialized',
        () => ({ purchaseItemId: laptopLine, quantity: 1 }),
        'IDENTIFIER_COUNT_MISMATCH',
      ],
      [
        'units sent for quantity product',
        () => ({
          purchaseItemId: cableLine,
          quantity: 1,
          units: [{ identifiers: ['ABCD1234'] }],
        }),
        'IDENTIFIER_COUNT_MISMATCH',
      ],
      [
        'malformed serial',
        () => ({
          purchaseItemId: laptopLine,
          quantity: 1,
          units: [{ identifiers: ['bad serial!'] }],
        }),
        'INVALID_IDENTIFIER',
      ],
    ])('rejects %s (400)', async (_label, item, code) => {
      const res = await receive('invA', po.id, { items: [item()] }).expect(400);
      expect(res.body.code).toBe(code);
    });

    it('rejects duplicates within a request and against existing identifiers (after normalisation)', async () => {
      const s = nextSerial();
      const dup = await receive('invA', po.id, {
        items: [
          {
            purchaseItemId: laptopLine,
            quantity: 2,
            units: [{ identifiers: [s] }, { identifiers: [s.toLowerCase()] }],
          },
        ],
      }).expect(409);
      expect(dup.body.code).toBe('DUPLICATE_IDENTIFIER');
      await receive('invA', po.id, {
        items: [
          {
            purchaseItemId: laptopLine,
            quantity: 1,
            units: [{ identifiers: [s] }],
          },
        ],
      }).expect(201);
      const again = await receive('invA', po.id, {
        items: [
          {
            purchaseItemId: laptopLine,
            quantity: 1,
            units: [{ identifiers: [` ${s.toLowerCase()} `] }],
          },
        ],
      }).expect(409);
      expect(again.body).toMatchObject({ code: 'DUPLICATE_IDENTIFIER' });
      expect(again.body.details[0].messages[0]).toContain(s);
    });
  });

  // ------------------------------------------------------- idempotency
  describe('idempotency (BR-06, I19)', () => {
    it('replay returns the same receipt (200) and never doubles stock; reuse with another payload → 409', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 10, unitCost: '8000' },
      ]);
      const item = await lineId(po.id, cable);
      const key = randomUUID();
      const body = {
        idempotencyKey: key,
        items: [{ purchaseItemId: item, quantity: 4 }],
      };
      const before = await balance(cable);
      const first = await post(
        'invA',
        `/api/v1/purchases/${po.id}/receive`,
        body,
      ).expect(201);
      const replay = await post(
        'invA',
        `/api/v1/purchases/${po.id}/receive`,
        body,
      ).expect(200);
      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(await balance(cable)).toBe(before + 4);
      expect(
        (
          await post('invA', `/api/v1/purchases/${po.id}/receive`, {
            ...body,
            items: [{ purchaseItemId: item, quantity: 5 }],
          }).expect(409)
        ).body.code,
      ).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(
        (
          await post(
            'procA2',
            `/api/v1/purchases/${po.id}/receive`,
            body,
          ).expect(409)
        ).body.code,
      ).toBe('IDEMPOTENCY_KEY_REUSED');
      await post('invA', `/api/v1/purchases/${po.id}/receive`, {
        items: [{ purchaseItemId: item, quantity: 1 }],
      }).expect(400); // key mandatory
    });

    it('concurrent requests with the same key apply once', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 10, unitCost: '8000' },
      ]);
      const item = await lineId(po.id, cable);
      const body = {
        idempotencyKey: randomUUID(),
        items: [{ purchaseItemId: item, quantity: 3 }],
      };
      const before = await balance(cable);
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          post('invA', `/api/v1/purchases/${po.id}/receive`, body),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await balance(cable)).toBe(before + 3);
    });
  });

  // ------------------------------------------------------- concurrency
  describe('concurrency', () => {
    it('parallel receipts can never over-receive a line', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 5, unitCost: '8000' },
      ]);
      const item = await lineId(po.id, cable);
      const before = await balance(cable);
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          receive('invA', po.id, {
            items: [{ purchaseItemId: item, quantity: 5 }],
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await balance(cable)).toBe(before + 5);
    });

    it('the same identifier received concurrently on two orders registers once', async () => {
      const p1 = await approvedPo([
        { productId: laptop, quantity: 1, unitCost: '1400000' },
      ]);
      const p2 = await approvedPo([
        { productId: laptop, quantity: 1, unitCost: '1400000' },
      ]);
      const s = nextSerial();
      const results = await Promise.all([
        receive('invA', p1.id, {
          items: [
            {
              purchaseItemId: await lineId(p1.id, laptop),
              quantity: 1,
              units: [{ identifiers: [s] }],
            },
          ],
        }),
        receive('procA2', p2.id, {
          items: [
            {
              purchaseItemId: await lineId(p2.id, laptop),
              quantity: 1,
              units: [{ identifiers: [s] }],
            },
          ],
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await ctx.prisma.unitIdentifier.count({ where: { value: s } }),
      ).toBe(1);
    });
  });

  // -------------------------------------------- status, branch, inactive refs
  describe('order status, branches and inactive references', () => {
    it('refuses non-receivable statuses (409)', async () => {
      const created = await post('procA', '/api/v1/purchases', {
        branchId: A,
        supplierId,
        items: [{ productId: cable, quantity: 1, unitCost: '1' }],
      }).expect(201);
      const item = await lineId(created.body.data.id, cable);
      await receive('invA', created.body.data.id, {
        items: [{ purchaseItemId: item, quantity: 1 }],
      }).expect(409); // DRAFT
      await post(
        'procA',
        `/api/v1/purchases/${created.body.data.id}/submit`,
      ).expect(200);
      await receive('invA', created.body.data.id, {
        items: [{ purchaseItemId: item, quantity: 1 }],
      }).expect(409); // SUBMITTED
    });

    it('another branch cannot receive; nothing changes', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 2, unitCost: '8000' },
      ]);
      const item = await lineId(po.id, cable);
      expect(
        (
          await receive('invB', po.id, {
            items: [{ purchaseItemId: item, quantity: 2 }],
          }).expect(403)
        ).body.code,
      ).toBe('BRANCH_ACCESS_DENIED');
      expect(
        await ctx.prisma.goodsReceipt.count({ where: { purchaseId: po.id } }),
      ).toBe(0);
    });

    it('inactive product is still receivable (I5); inactive branch is not', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 2, unitCost: '8000' },
      ]);
      const item = await lineId(po.id, cable);
      await ctx.prisma.product.update({
        where: { id: cable },
        data: { isActive: false },
      });
      try {
        await receive('invA', po.id, {
          items: [{ purchaseItemId: item, quantity: 1 }],
        }).expect(201);
      } finally {
        await ctx.prisma.product.update({
          where: { id: cable },
          data: { isActive: true },
        });
      }
      await ctx.prisma.branch.update({
        where: { id: A },
        data: { isActive: false },
      });
      try {
        expect(
          (
            await receive('invA', po.id, {
              items: [{ purchaseItemId: item, quantity: 1 }],
            }).expect(400)
          ).body.code,
        ).toBe('REFERENCE_INACTIVE');
      } finally {
        await ctx.prisma.branch.update({
          where: { id: A },
          data: { isActive: true },
        });
      }
    });
  });

  // ---------------------------------------------------------- valuation
  describe('valuation (I1, I2, I18)', () => {
    it('moving weighted average across receipts; catalogue prices untouched', async () => {
      const t = (
        await ctx.prisma.product.create({
          data: {
            sku: 'WAC-TEST',
            name: 'WAC test',
            categoryId: (await ctx.prisma.category.findFirstOrThrow()).id,
            brandId: (await ctx.prisma.brand.findFirstOrThrow()).id,
            trackingMode: 'QUANTITY',
            costPrice: '50',
            sellingPrice: '90',
          },
        })
      ).id;
      const p1 = await approvedPo([
        { productId: t, quantity: 10, unitCost: '100' },
      ]);
      await receive('invA', p1.id, {
        items: [{ purchaseItemId: await lineId(p1.id, t), quantity: 10 }],
      }).expect(201);
      const p2 = await approvedPo([
        { productId: t, quantity: 30, unitCost: '120' },
      ]);
      await receive('invA', p2.id, {
        items: [{ purchaseItemId: await lineId(p2.id, t), quantity: 30 }],
      }).expect(201);
      const v = await ctx.prisma.inventoryValuation.findUniqueOrThrow({
        where: { productId: t },
      });
      expect(v.averageCost.toFixed(4)).toBe('115.0000'); // (10×100 + 30×120)/40
      const prod = await ctx.prisma.product.findUniqueOrThrow({
        where: { id: t },
      });
      expect([prod.costPrice.toString(), prod.sellingPrice.toString()]).toEqual(
        ['50', '90'],
      );

      const res = await http()
        .get(`/api/v1/inventory/valuation?branchId=${A}`)
        .set(as('managerA'))
        .expect(200);
      const line = res.body.data.lines.find(
        (l: { product: { sku: string } }) => l.product.sku === 'WAC-TEST',
      );
      expect(line).toMatchObject({
        onHand: 40,
        averageCost: '115.0000',
        value: '4600.00',
      });
      expect(res.body.data.totals.inTransitValue).toBe('0.00');
    });

    it.each(['managerA', 'auditorA', 'admin'] as Who[])(
      '%s can read valuation',
      async (who) => {
        await http()
          .get('/api/v1/inventory/valuation')
          .set(as(who))
          .expect(200);
      },
    );

    it.each(['invA', 'cashierA', 'techA'] as Who[])(
      '%s cannot read valuation (403)',
      async (who) => {
        await http()
          .get('/api/v1/inventory/valuation')
          .set(as(who))
          .expect(403);
      },
    );
  });

  // -------------------------------------------------- reads & cost masking
  describe('read APIs, branch scope and cost masking', () => {
    it('balances are branch-scoped; lowStock filter works', async () => {
      const a = await http()
        .get('/api/v1/inventory/balances?limit=100')
        .set(as('invA'))
        .expect(200);
      expect(a.body.data.length).toBeGreaterThan(0);
      for (const r of a.body.data) expect(r.branch.id).toBe(A);
      const b = await http()
        .get('/api/v1/inventory/balances')
        .set(as('invB'))
        .expect(200);
      expect(b.body.data).toEqual([]);
      await http()
        .get(`/api/v1/inventory/balances?branchId=${A}`)
        .set(as('invB'))
        .expect(403);
      const low = await http()
        .get('/api/v1/inventory/balances?lowStock=true&limit=100')
        .set(as('managerA'))
        .expect(200);
      for (const r of low.body.data)
        expect(r.available).toBeLessThanOrEqual(r.reorderLevel);
    });

    it('CASHIER sees quantities but never costs (FR-INV-12)', async () => {
      const responses = await Promise.all([
        http()
          .get('/api/v1/inventory/movements?limit=100')
          .set(as('cashierA'))
          .expect(200),
        http()
          .get('/api/v1/inventory/units?limit=100')
          .set(as('cashierA'))
          .expect(200),
        http()
          .get('/api/v1/goods-receipts?limit=100')
          .set(as('cashierA'))
          .expect(200),
      ]);
      const receiptId = responses[2].body.data[0].id;
      const detail = await http()
        .get(`/api/v1/goods-receipts/${receiptId}`)
        .set(as('cashierA'))
        .expect(200);
      for (const r of [...responses, detail])
        expect(JSON.stringify(r.body)).not.toMatch(
          /unitCost|valueDelta|averageCost/,
        );
      const inv = await http()
        .get('/api/v1/inventory/movements?limit=1')
        .set(as('invA'))
        .expect(200);
      expect(inv.body.data[0]).toHaveProperty('unitCost');
    });

    it('TECHNICIAN has no inventory access', async () => {
      await http()
        .get('/api/v1/inventory/balances')
        .set(as('techA'))
        .expect(403);
    });

    it('identifier lookup: full in scope; only "exists" outside (I15); 404 unknown', async () => {
      const u = await ctx.prisma.unitIdentifier.findFirstOrThrow({
        where: { type: 'SERIAL' },
      });
      const inScope = await http()
        .get(
          `/api/v1/inventory/units/lookup?identifier=${u.value.toLowerCase()}`,
        )
        .set(as('invA'))
        .expect(200);
      expect(inScope.body.data).toMatchObject({
        exists: true,
        inYourBranches: true,
        unit: { branch: { id: A } },
      });
      const outside = await http()
        .get(`/api/v1/inventory/units/lookup?identifier=${u.value}`)
        .set(as('invB'))
        .expect(200);
      expect(outside.body.data).toEqual({
        exists: true,
        inYourBranches: false,
      });
      await http()
        .get('/api/v1/inventory/units/lookup?identifier=NOPE0000')
        .set(as('invA'))
        .expect(404);
      const unit = await http()
        .get(`/api/v1/inventory/units/${inScope.body.data.unit.id}`)
        .set(as('invA'))
        .expect(200);
      expect(unit.body.data.movements[0]).toMatchObject({
        movementType: 'PURCHASE_RECEIPT',
        quantityDelta: 1,
      });
      await http()
        .get(`/api/v1/inventory/units/${inScope.body.data.unit.id}`)
        .set(as('invB'))
        .expect(403);
    });

    it('managers see goods-receipt audit events of their branch', async () => {
      const res = await http()
        .get('/api/v1/audit-logs?action=goods_receipt.created&limit=100')
        .set(as('managerA'))
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const e of res.body.data) expect(e.branchId).toBe(A);
    });
  });

  // ------------------------------------------------- database guarantees
  describe('database guarantees (integration)', () => {
    it('ledger is append-only; balances never negative', async () => {
      const m = await ctx.prisma.stockMovement.findFirstOrThrow();
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE stock_movements SET quantity_delta = 99 WHERE id='${m.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `DELETE FROM stock_movements WHERE id='${m.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE stock_balances SET on_hand = -1 WHERE product_id='${cable}'`,
        ),
      ).rejects.toThrow(/stock_balances_non_negative_chk/);
      const gr = await ctx.prisma.goodsReceipt.findFirstOrThrow();
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE goods_receipts SET notes='x' WHERE id='${gr.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
      const ident = await ctx.prisma.unitIdentifier.findFirstOrThrow();
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `DELETE FROM unit_identifiers WHERE id='${ident.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it('BR-14 trigger refuses a self-receipt written directly', async () => {
      const po = await approvedPo([
        { productId: cable, quantity: 1, unitCost: '1' },
      ]);
      await expect(
        ctx.prisma.goodsReceipt.create({
          data: {
            reference: `GRN-BR-A-${YEAR}-999999`,
            purchaseId: po.id,
            branchId: A,
            receivedById: ids.procA!,
            idempotencyKey: randomUUID(),
            requestHash: 'a'.repeat(64),
          },
        }),
      ).rejects.toThrow(/BR-14/);
    });

    it('a unit needs exactly identifiersPerUnit identifiers of the right type (deferred trigger)', async () => {
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          const u = await tx.productUnit.create({
            data: { productId: phone, branchId: A, unitCost: '1' },
          });
          await tx.unitIdentifier.create({
            data: {
              productUnitId: u.id,
              type: 'IMEI',
              value: nextImei(),
              isPrimary: true,
            },
          });
        }),
      ).rejects.toThrow(/exactly 2 IMEI/);
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.productUnit.create({
            data: { productId: cable, branchId: A, unitCost: '1' },
          });
        }),
      ).rejects.toThrow(/SERIALIZED/);
    });
  });

  // --------------------------------------------------- reconciliation
  describe('reconciliation (BR-04, BR-16)', () => {
    it('every balance equals the sum of its movements; serialized on-hand equals IN_STOCK units', async () => {
      const mismatches = await ctx.prisma.$queryRaw<unknown[]>`
        SELECT b.product_id, b.branch_id FROM stock_balances b
        LEFT JOIN (SELECT product_id, branch_id, SUM(quantity_delta)::int s FROM stock_movements GROUP BY 1, 2) m
          ON m.product_id = b.product_id AND m.branch_id = b.branch_id
        WHERE b.on_hand <> COALESCE(m.s, 0)`;
      expect(mismatches).toEqual([]);
      const unitMismatches = await ctx.prisma.$queryRaw<unknown[]>`
        SELECT b.product_id, b.branch_id FROM stock_balances b
        JOIN products p ON p.id = b.product_id AND p.tracking_mode = 'SERIALIZED'
        LEFT JOIN (SELECT product_id, branch_id, count(*)::int n FROM product_units WHERE status = 'IN_STOCK' GROUP BY 1, 2) u
          ON u.product_id = b.product_id AND u.branch_id = b.branch_id
        WHERE b.on_hand <> COALESCE(u.n, 0)`;
      expect(unitMismatches).toEqual([]);
      const received = await ctx.prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT (SELECT COALESCE(SUM(quantity_received),0) FROM purchase_items)
             = (SELECT COALESCE(SUM(quantity),0) FROM goods_receipt_items) AS ok`;
      expect(received[0].ok).toBe(true);
    });
  });
});
