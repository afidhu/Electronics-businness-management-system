/**
 * Module 6 — Stage 6.3: POS product search, serialized unit selection and
 * server-side pricing preview (FR-SALE-01/03/05, S2, S9, S10, S14, S15, S20).
 * Stock is received through the real PO → approve → receive API.
 */
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
  | 'cashierA'
  | 'cashierB'
  | 'managerA'
  | 'procA'
  | 'invA'
  | 'techA'
  | 'auditorA';

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
let imeiSeq = 35209900000100;
const nextImei = () => imei(String(imeiSeq++));

describe('POS search, unit selection and pricing — Module 6 stage 6.3 (e2e)', () => {
  let ctx: TestContext;
  let A: string;
  let B: string;
  let C: string; // inactive branch
  const token: Partial<Record<Who, string>> = {};
  const as = (who: Who) => bearer(token[who]!);
  let laptop: string; // SERIALIZED, SERIAL ×1, 1,750,000
  let phone: string; // SERIALIZED, IMEI ×2, 900,000
  let cable: string; // QUANTITY, 15,000
  let adapter: string; // QUANTITY, 10.03
  let retired: string; // SERIALIZED, received then deactivated
  let neverStocked: string; // QUANTITY, active, no stock anywhere
  const laptopSerials = ['5CG7001AAA', '5CG7002BBB', '5CG7003CCC'];
  let laptopUnits: string[] = []; // [0], [1] IN_STOCK at A; [2] SOLD
  let phoneUnit: string;
  let phoneImeis: string[];
  let unitAtB: string;
  const serialAtB = '5CG7999BBB';
  let retiredUnit: string;

  const users: [Who, RoleKey, () => string[]][] = [
    ['admin', 'SYSTEM_ADMIN', () => []],
    ['cashierA', 'CASHIER', () => [A]],
    ['cashierB', 'CASHIER', () => [B]],
    ['managerA', 'MANAGER', () => [A]],
    ['procA', 'PROCUREMENT_OFFICER', () => [A]],
    ['invA', 'INVENTORY_OFFICER', () => [A]],
    ['techA', 'TECHNICIAN', () => [A]],
    ['auditorA', 'AUDITOR', () => [A]],
  ];
  const NON_SELLERS: Who[] = ['managerA', 'procA', 'invA', 'techA', 'auditorA'];

  const http = () => ctx.http();
  const post = (who: Who, url: string, body: unknown = {}) =>
    http()
      .post(url)
      .set(as(who))
      .send(body as object);
  const get = (who: Who, url: string, query: Record<string, unknown> = {}) =>
    http().get(url).set(as(who)).query(query);
  const quote = (who: Who, body: Record<string, unknown>) =>
    post(who, '/api/v1/pos/quote', body);
  const setVat = (ratePercent: string) =>
    http()
      .put('/api/v1/settings/tax')
      .set(as('admin'))
      .send({ ratePercent })
      .expect(200);

  /** Everything a quote must never change. */
  const snapshot = async () => ({
    movements: await ctx.prisma.stockMovement.count(),
    sales: await ctx.prisma.sale.count(),
    payments: await ctx.prisma.payment.count(),
    audit: await ctx.prisma.auditLog.count(),
    balances: (
      await ctx.prisma.stockBalance.findMany({
        orderBy: [{ productId: 'asc' }, { branchId: 'asc' }],
      })
    ).map((b) => `${b.productId}/${b.branchId}/${b.onHand}/${b.reserved}`),
    units: (
      await ctx.prisma.productUnit.findMany({ orderBy: { id: 'asc' } })
    ).map((u) => `${u.id}/${u.branchId}/${u.status}`),
    sequences: await ctx.prisma.documentSequence.count(),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    A = await createBranch(ctx.prisma, 'BR-A');
    B = await createBranch(ctx.prisma, 'BR-B');
    C = await createBranch(ctx.prisma, 'BR-C', false);
    for (const [who, role, branches] of users) {
      const email = `${who.toLowerCase()}@pos.test`;
      await createUser(ctx.prisma, {
        email,
        roleKey: role,
        branchIds: branches(),
      });
      token[who] = (await login(ctx, email)).accessToken;
    }
    const cat = await ctx.prisma.category.create({
      data: { name: 'Devices', nameKey: 'devices' },
    });
    const hp = await ctx.prisma.brand.create({
      data: { name: 'HP', nameKey: 'hp' },
    });
    const tecno = await ctx.prisma.brand.create({
      data: { name: 'Tecno', nameKey: 'tecno' },
    });
    const mk = async (
      sku: string,
      name: string,
      brandId: string,
      mode: 'SERIALIZED' | 'QUANTITY',
      type: 'IMEI' | 'SERIAL' | null,
      per: number | null,
      sellingPrice: string,
    ) =>
      (
        await ctx.prisma.product.create({
          data: {
            sku,
            name,
            categoryId: cat.id,
            brandId,
            trackingMode: mode,
            identifierType: type,
            identifiersPerUnit: per,
            costPrice: '1000',
            sellingPrice,
            reorderLevel: 1,
          },
        })
      ).id;
    laptop = await mk(
      'LAPTOP-450',
      'ProBook 450',
      hp.id,
      'SERIALIZED',
      'SERIAL',
      1,
      '1750000',
    );
    phone = await mk(
      'PHONE-SPARK',
      'Spark 20',
      tecno.id,
      'SERIALIZED',
      'IMEI',
      2,
      '900000',
    );
    cable = await mk(
      'CABLE-USBC',
      'USB-C Cable',
      hp.id,
      'QUANTITY',
      null,
      null,
      '15000',
    );
    adapter = await mk(
      'ADAPT-01',
      'Travel Adapter',
      tecno.id,
      'QUANTITY',
      null,
      null,
      '10.03',
    );
    retired = await mk(
      'LAPTOP-OLD',
      'ProBook Retired',
      hp.id,
      'SERIALIZED',
      'SERIAL',
      1,
      '500000',
    );
    neverStocked = await mk(
      'MOUSE-01',
      'Mouse',
      hp.id,
      'QUANTITY',
      null,
      null,
      '20000',
    );
    const supplierId = (
      await ctx.prisma.supplier.create({
        data: { name: 'Supplier', nameKey: 'supplier' },
      })
    ).id;

    // Receive stock at A through the real procurement/receiving API.
    const created = await post('procA', '/api/v1/purchases', {
      branchId: A,
      supplierId,
      items: [
        { productId: laptop, quantity: 3, unitCost: '1400000' },
        { productId: phone, quantity: 1, unitCost: '700000' },
        { productId: cable, quantity: 20, unitCost: '8000' },
        { productId: adapter, quantity: 5, unitCost: '5' },
        { productId: retired, quantity: 1, unitCost: '300000' },
      ],
    }).expect(201);
    const poId = created.body.data.id as string;
    await post('procA', `/api/v1/purchases/${poId}/submit`).expect(200);
    await post('managerA', `/api/v1/purchases/${poId}/approve`).expect(200);
    const line = async (productId: string) =>
      (
        await ctx.prisma.purchaseItem.findFirstOrThrow({
          where: { purchaseId: poId, productId },
        })
      ).id;
    phoneImeis = [nextImei(), nextImei()];
    await post('invA', `/api/v1/purchases/${poId}/receive`, {
      idempotencyKey: randomUUID(),
      items: [
        {
          purchaseItemId: await line(laptop),
          quantity: 3,
          units: laptopSerials.map((s) => ({ identifiers: [s] })),
        },
        {
          purchaseItemId: await line(phone),
          quantity: 1,
          units: [{ identifiers: phoneImeis }],
        },
        { purchaseItemId: await line(cable), quantity: 20 },
        { purchaseItemId: await line(adapter), quantity: 5 },
        {
          purchaseItemId: await line(retired),
          quantity: 1,
          units: [{ identifiers: ['5CG7000OLD'] }],
        },
      ],
    }).expect(201);

    const unitOf = async (value: string) =>
      (await ctx.prisma.unitIdentifier.findFirstOrThrow({ where: { value } }))
        .productUnitId;
    laptopUnits = await Promise.all(laptopSerials.map(unitOf));
    phoneUnit = await unitOf(phoneImeis[0]);
    retiredUnit = await unitOf('5CG7000OLD');

    // One laptop already sold (status + balance kept consistent for this read-side test).
    await ctx.prisma.$transaction([
      ctx.prisma.productUnit.update({
        where: { id: laptopUnits[2] },
        data: { status: 'SOLD' },
      }),
      ctx.prisma.stockBalance.update({
        where: { productId_branchId: { productId: laptop, branchId: A } },
        data: { onHand: { decrement: 1 } },
      }),
    ]);
    // One laptop held at branch B.
    unitAtB = await ctx.prisma.$transaction(async (tx) => {
      const u = await tx.productUnit.create({
        data: { productId: laptop, branchId: B, unitCost: '1400000' },
      });
      await tx.unitIdentifier.create({
        data: {
          productUnitId: u.id,
          type: 'SERIAL',
          value: serialAtB,
          isPrimary: true,
        },
      });
      await tx.stockBalance.create({
        data: { productId: laptop, branchId: B, onHand: 1 },
      });
      return u.id;
    });
    // The retired product still has a unit in stock, but is no longer sellable.
    await ctx.prisma.product.update({
      where: { id: retired },
      data: { isActive: false },
    });
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ================================================ VAT not configured
  describe('unconfigured VAT (S1, BR-20)', () => {
    it('quote is blocked with TAX_NOT_CONFIGURED; catalogue still browsable', async () => {
      const res = await quote('cashierA', {
        items: [{ productId: cable, quantity: 1 }],
      }).expect(409);
      expect(res.body.code).toBe('TAX_NOT_CONFIGURED');
      await get('cashierA', '/api/v1/pos/catalogue').expect(200);
    });

    it('then the administrator configures 18% VAT', async () => {
      await setVat('18');
    });
  });

  // ======================================================== access
  describe('roles and authentication (S19)', () => {
    it('requires authentication on every POS endpoint', async () => {
      await http().get('/api/v1/pos/catalogue').expect(401);
      await http()
        .get('/api/v1/pos/units')
        .query({ productId: laptop })
        .expect(401);
      await http()
        .post('/api/v1/pos/quote')
        .send({ items: [{ productId: cable }] })
        .expect(401);
    });

    it.each(NON_SELLERS)(
      '%s is refused on every POS endpoint (403 PERMISSION_DENIED)',
      async (who) => {
        for (const res of [
          await get(who, '/api/v1/pos/catalogue'),
          await get(who, '/api/v1/pos/units', { productId: laptop }),
          await quote(who, { items: [{ productId: cable, quantity: 1 }] }),
        ]) {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('PERMISSION_DENIED');
        }
      },
    );

    it('CASHIER (own branch implied) and SYSTEM_ADMIN (branch chosen) are allowed', async () => {
      await get('cashierA', '/api/v1/pos/catalogue').expect(200);
      await get('admin', '/api/v1/pos/catalogue', { branchId: A }).expect(200);
      await quote('cashierA', {
        items: [{ productId: cable, quantity: 1 }],
      }).expect(200);
      await quote('admin', {
        branchId: A,
        items: [{ productId: cable, quantity: 1 }],
      }).expect(200);
    });
  });

  // ====================================================== branches
  describe('selling branch (S9, S10, I15)', () => {
    it('a cashier cannot sell or browse at another branch', async () => {
      for (const res of [
        await get('cashierA', '/api/v1/pos/catalogue', { branchId: B }),
        await get('cashierA', '/api/v1/pos/units', {
          branchId: B,
          productId: laptop,
        }),
        await quote('cashierA', {
          branchId: B,
          items: [{ productId: cable, quantity: 1 }],
        }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('BRANCH_ACCESS_DENIED');
      }
    });

    it('SYSTEM_ADMIN must choose a branch (400 on branchId)', async () => {
      const res = await get('admin', '/api/v1/pos/catalogue').expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'branchId' }),
      ]);
      await quote('admin', {
        items: [{ productId: cable, quantity: 1 }],
      }).expect(400);
    });

    it('inactive branch → 400 REFERENCE_INACTIVE; unknown branch → 404', async () => {
      const res = await get('admin', '/api/v1/pos/catalogue', {
        branchId: C,
      }).expect(400);
      expect(res.body.code).toBe('REFERENCE_INACTIVE');
      await get('admin', '/api/v1/pos/catalogue', {
        branchId: randomUUID(),
      }).expect(404);
      await get('admin', '/api/v1/pos/catalogue', {
        branchId: 'not-a-uuid',
      }).expect(400);
    });
  });

  // ===================================================== catalogue
  describe('product search (FR-SALE-01)', () => {
    const search = async (who: Who, query: Record<string, unknown>) =>
      (await get(who, '/api/v1/pos/catalogue', query).expect(200)).body;

    it('lists active products with server prices and stock at the cashier branch; never costs', async () => {
      const body = await search('cashierA', { limit: 100 });
      const bySku = Object.fromEntries(
        body.data.map((p: { sku: string }) => [p.sku, p]),
      );
      expect(Object.keys(bySku).sort()).toEqual([
        'ADAPT-01',
        'CABLE-USBC',
        'LAPTOP-450',
        'MOUSE-01',
        'PHONE-SPARK',
      ]);
      expect(bySku['LAPTOP-450']).toMatchObject({
        id: laptop,
        name: 'ProBook 450',
        brand: 'HP',
        category: 'Devices',
        trackingMode: 'SERIALIZED',
        identifierType: 'SERIAL',
        sellingPrice: '1750000.00',
        currency: 'TZS',
        priceIncludesTax: false,
        available: 2, // 3 received, 1 sold
        inStock: true,
        branch: { id: A, code: 'BR-A' },
      });
      expect(bySku['ADAPT-01'].sellingPrice).toBe('10.03');
      expect(bySku['CABLE-USBC'].available).toBe(20);
      expect(bySku['MOUSE-01']).toMatchObject({ available: 0, inStock: false });
      expect(body.meta.pagination.total).toBe(5);
      expect(JSON.stringify(body)).not.toMatch(/cost/i);
    });

    it.each([
      ['name', 'probook', ['LAPTOP-450']],
      ['SKU', 'cable-us', ['CABLE-USBC']],
      ['brand', 'TECNO', ['ADAPT-01', 'PHONE-SPARK']],
      ['no match', 'zzz', []],
    ])('searches by %s (case-insensitive)', async (_label, q, skus) => {
      const body = await search('cashierA', { q });
      expect(body.data.map((p: { sku: string }) => p.sku).sort()).toEqual(skus);
    });

    it('inactive products never appear, even when they have stock', async () => {
      const body = await search('cashierA', { q: 'retired' });
      expect(body.data).toEqual([]);
    });

    it('stock is per branch: cashier B sees B stock only; inStockOnly filters', async () => {
      const b = await search('cashierB', { limit: 100 });
      const avail = Object.fromEntries(
        b.data.map((p: { sku: string; available: number }) => [
          p.sku,
          p.available,
        ]),
      );
      expect(avail).toMatchObject({
        'LAPTOP-450': 1,
        'CABLE-USBC': 0,
        'PHONE-SPARK': 0,
      });
      const inStock = await search('cashierB', { inStockOnly: 'true' });
      expect(inStock.data.map((p: { sku: string }) => p.sku)).toEqual([
        'LAPTOP-450',
      ]);
    });

    it('rejects unknown query parameters (e.g. asking for costs)', async () => {
      await get('cashierA', '/api/v1/pos/catalogue', {
        includeCost: 'true',
      }).expect(400);
    });
  });

  // ========================================================= units
  describe('serialized device selection (FR-SALE-05)', () => {
    it('lists only IN_STOCK units at the branch, with identifiers; no costs', async () => {
      const res = await get('cashierA', '/api/v1/pos/units', {
        productId: laptop,
      }).expect(200);
      expect(res.body.data.map((u: { id: string }) => u.id).sort()).toEqual(
        [laptopUnits[0], laptopUnits[1]].sort(),
      );
      expect(res.body.data[0]).toMatchObject({
        productId: laptop,
        sku: 'LAPTOP-450',
        identifiers: [
          { type: 'SERIAL', value: expect.any(String), isPrimary: true },
        ],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/cost/i);
      expect(JSON.stringify(res.body)).not.toContain(serialAtB);
      expect(JSON.stringify(res.body)).not.toContain(laptopSerials[2]);
    });

    it('a dual-SIM phone shows both IMEIs, primary first', async () => {
      const res = await get('cashierA', '/api/v1/pos/units', {
        productId: phone,
      }).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(
        res.body.data[0].identifiers.map((i: { value: string }) => i.value),
      ).toEqual(phoneImeis);
      expect(res.body.data[0].identifiers[0]).toMatchObject({
        type: 'IMEI',
        isPrimary: true,
      });
    });

    it('cashier B sees only the B unit', async () => {
      const res = await get('cashierB', '/api/v1/pos/units', {
        productId: laptop,
      }).expect(200);
      expect(res.body.data.map((u: { id: string }) => u.id)).toEqual([unitAtB]);
    });

    it('resolves a scanned serial (any case/spacing) or IMEI to one available unit', async () => {
      const bySerial = await get('cashierA', '/api/v1/pos/units', {
        identifier: ` ${laptopSerials[0].toLowerCase()} `,
      }).expect(200);
      expect(bySerial.body.data).toEqual([
        expect.objectContaining({
          id: laptopUnits[0],
          productId: laptop,
          sku: 'LAPTOP-450',
        }),
      ]);
      const byImei = await get('cashierA', '/api/v1/pos/units', {
        identifier: `${phoneImeis[1].slice(0, 6)}-${phoneImeis[1].slice(6)}`,
      }).expect(200);
      expect(byImei.body.data[0].id).toBe(phoneUnit);
    });

    it.each([
      ['a sold unit', () => laptopSerials[2]],
      ['a unit at another branch (no location leak)', () => serialAtB],
      ['a unit of an inactive product', () => '5CG7000OLD'],
    ])('refuses %s with 409 UNIT_NOT_AVAILABLE', async (_l, value) => {
      const res = await get('cashierA', '/api/v1/pos/units', {
        identifier: value(),
      }).expect(409);
      expect(res.body.code).toBe('UNIT_NOT_AVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/BR-B|SOLD|branch B/);
    });

    it('unknown identifier → 404; quantity product → 400; inactive product → 400; nothing given → 400', async () => {
      await get('cashierA', '/api/v1/pos/units', {
        identifier: 'NOPE12345',
      }).expect(404);
      await get('cashierA', '/api/v1/pos/units', { productId: cable }).expect(
        400,
      );
      const inactive = await get('cashierA', '/api/v1/pos/units', {
        productId: retired,
      }).expect(400);
      expect(inactive.body.code).toBe('PRODUCT_NOT_SELLABLE');
      await get('cashierA', '/api/v1/pos/units').expect(400);
    });
  });

  // ========================================================= quote
  describe('pricing preview (FR-SALE-03, S2, S14, S20)', () => {
    it('prices the demo cart on the server: 1,780,000 + 18% = 2,100,400', async () => {
      const res = await quote('cashierA', {
        items: [
          { productId: laptop, unitId: laptopUnits[0] },
          { productId: cable, quantity: 2 },
        ],
      }).expect(200);
      expect(res.body.data).toMatchObject({
        branch: { id: A, code: 'BR-A' },
        currency: 'TZS',
        priceIncludesTax: false,
        taxRatePercent: '18.00',
        subtotal: '1780000.00',
        taxAmount: '320400.00',
        total: '2100400.00',
        lines: [
          {
            lineNumber: 1,
            productId: laptop,
            sku: 'LAPTOP-450',
            name: 'ProBook 450',
            trackingMode: 'SERIALIZED',
            quantity: 1,
            unitPrice: '1750000.00',
            lineTotal: '1750000.00',
            unit: {
              id: laptopUnits[0],
              identifiers: [
                { type: 'SERIAL', value: laptopSerials[0], isPrimary: true },
              ],
            },
          },
          {
            lineNumber: 2,
            productId: cable,
            quantity: 2,
            unitPrice: '15000.00',
            lineTotal: '30000.00',
            unit: null,
          },
        ],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/cost/i);
    });

    it('selects a serialized unit by scanned identifier', async () => {
      const res = await quote('cashierA', {
        items: [{ productId: phone, identifier: phoneImeis[0] }],
      }).expect(200);
      expect(res.body.data.lines[0].unit.id).toBe(phoneUnit);
      expect(res.body.data.total).toBe('1062000.00');
    });

    it('rounds VAT half-up on the subtotal (10.03 → tax 1.81)', async () => {
      const res = await quote('cashierA', {
        items: [{ productId: adapter, quantity: 1 }],
      }).expect(200);
      expect(res.body.data).toMatchObject({
        subtotal: '10.03',
        taxAmount: '1.81',
        total: '11.84',
      });
      const three = await quote('cashierA', {
        items: [{ productId: adapter, quantity: 3 }],
      }).expect(200);
      // 30.09 × 18% = 5.4162 → 5.42
      expect(three.body.data).toMatchObject({
        subtotal: '30.09',
        taxAmount: '5.42',
        total: '35.51',
      });
    });

    it.each([
      [
        'unitPrice on a line',
        { items: [{ productId: cable, quantity: 1, unitPrice: '1' }] },
      ],
      [
        'lineTotal on a line',
        { items: [{ productId: cable, quantity: 1, lineTotal: '1' }] },
      ],
      [
        'a cart total',
        { items: [{ productId: cable, quantity: 1 }], total: '1' },
      ],
      [
        'a subtotal',
        { items: [{ productId: cable, quantity: 1 }], subtotal: '1' },
      ],
      [
        'a tax rate',
        { items: [{ productId: cable, quantity: 1 }], taxRatePercent: '0' },
      ],
      [
        'a discount',
        { items: [{ productId: cable, quantity: 1 }], discount: '100' },
      ],
    ])('rejects client-supplied %s (400, never trusted)', async (_l, body) => {
      const res = await quote('cashierA', body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['no items', () => ({ items: [] })],
      [
        '51 lines (S15)',
        () => ({
          items: Array.from({ length: 51 }, () => ({
            productId: cable,
            quantity: 1,
          })),
        }),
      ],
      [
        'quantity 1001 (S15)',
        () => ({ items: [{ productId: cable, quantity: 1001 }] }),
      ],
      ['quantity 0', () => ({ items: [{ productId: cable, quantity: 0 }] })],
      [
        'fractional quantity',
        () => ({ items: [{ productId: cable, quantity: 1.5 }] }),
      ],
      ['a bad product id', () => ({ items: [{ productId: 'x' }] })],
    ])('rejects %s (400)', async (_l, body) => {
      await quote('cashierA', body()).expect(400);
    });

    it('insufficient stock → 409 INSUFFICIENT_STOCK with the line and available quantity', async () => {
      const res = await quote('cashierA', {
        items: [
          { productId: adapter, quantity: 1 },
          { productId: cable, quantity: 21 },
        ],
      }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.details).toEqual([
        {
          field: 'items.1.quantity',
          messages: ['only 20 CABLE-USBC available at this branch'],
        },
      ]);
      const none = await quote('cashierA', {
        items: [{ productId: neverStocked, quantity: 1 }],
      }).expect(409);
      expect(none.body.code).toBe('INSUFFICIENT_STOCK');
      // Branch B has no cables.
      await quote('cashierB', {
        items: [{ productId: cable, quantity: 1 }],
      }).expect(409);
    });

    it.each([
      ['a sold unit', () => ({ productId: laptop, unitId: laptopUnits[2] })],
      [
        'a unit at another branch',
        () => ({ productId: laptop, unitId: unitAtB }),
      ],
      ['an unknown unit', () => ({ productId: laptop, unitId: randomUUID() })],
      [
        'a sold unit by serial',
        () => ({ productId: laptop, identifier: laptopSerials[2] }),
      ],
    ])('refuses %s (409 UNIT_NOT_AVAILABLE)', async (_l, item) => {
      const res = await quote('cashierA', { items: [item()] }).expect(409);
      expect(res.body.code).toBe('UNIT_NOT_AVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/BR-B/);
    });

    it('inactive or unknown product → 400 PRODUCT_NOT_SELLABLE', async () => {
      const inactive = await quote('cashierA', {
        items: [{ productId: retired, unitId: retiredUnit }],
      }).expect(400);
      expect(inactive.body).toMatchObject({
        code: 'PRODUCT_NOT_SELLABLE',
        details: [
          { field: 'items.0.productId', messages: ['LAPTOP-OLD is inactive'] },
        ],
      });
      const unknown = await quote('cashierA', {
        items: [{ productId: randomUUID(), quantity: 1 }],
      }).expect(400);
      expect(unknown.body.code).toBe('PRODUCT_NOT_SELLABLE');
    });

    it.each([
      [
        'a serialized line without a unit',
        () => [{ productId: laptop }],
        'items.0.unitId',
      ],
      [
        'a serialized line with quantity 2',
        () => [{ productId: laptop, unitId: laptopUnits[0], quantity: 2 }],
        'items.0.quantity',
      ],
      [
        'a unit under the wrong product',
        () => [{ productId: phone, unitId: laptopUnits[0] }],
        'items.0.unitId',
      ],
      [
        'the same unit twice',
        () => [
          { productId: laptop, unitId: laptopUnits[0] },
          { productId: laptop, identifier: laptopSerials[0] },
        ],
        'items.1.unitId',
      ],
      [
        'a unit on a quantity product',
        () => [{ productId: cable, quantity: 1, unitId: laptopUnits[0] }],
        'items.0.unitId',
      ],
    ])('rejects %s (400 VALIDATION_ERROR)', async (_l, items, field) => {
      const res = await quote('cashierA', { items: items() }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual([expect.objectContaining({ field })]);
    });

    it('the same quantity product on two lines → 400 DUPLICATE_PRODUCT_LINE', async () => {
      const res = await quote('cashierA', {
        items: [
          { productId: cable, quantity: 1 },
          { productId: cable, quantity: 1 },
        ],
      }).expect(400);
      expect(res.body.code).toBe('DUPLICATE_PRODUCT_LINE');
    });

    it('SYSTEM_ADMIN quotes at a chosen branch using that branch’s units', async () => {
      const res = await quote('admin', {
        branchId: B,
        items: [{ productId: laptop, unitId: unitAtB }],
      }).expect(200);
      expect(res.body.data.branch).toEqual({ id: B, code: 'BR-B' });
      await quote('admin', {
        branchId: A,
        items: [{ productId: laptop, unitId: unitAtB }],
      }).expect(409);
    });

    it('has no side effects: stock, units, sales, sequences and audit unchanged', async () => {
      const before = await snapshot();
      await quote('cashierA', {
        items: [
          { productId: laptop, unitId: laptopUnits[0] },
          { productId: cable, quantity: 20 },
        ],
      }).expect(200);
      await quote('cashierA', {
        items: [{ productId: cable, quantity: 21 }],
      }).expect(409);
      await get('cashierA', '/api/v1/pos/units', { productId: laptop }).expect(
        200,
      );
      await get('cashierA', '/api/v1/pos/catalogue').expect(200);
      expect(await snapshot()).toEqual(before);
    });

    it('uses the current VAT rate: 0% yields total = subtotal', async () => {
      await setVat('0');
      const res = await quote('cashierA', {
        items: [{ productId: cable, quantity: 2 }],
      }).expect(200);
      expect(res.body.data).toMatchObject({
        taxRatePercent: '0.00',
        subtotal: '30000.00',
        taxAmount: '0.00',
        total: '30000.00',
      });
      await setVat('18');
    });

    it('a selling-price change by the manager is reflected in the next quote', async () => {
      await http()
        .patch(`/api/v1/products/${cable}`)
        .set(as('managerA'))
        .send({ sellingPrice: '16500' })
        .expect(200);
      const res = await quote('cashierA', {
        items: [{ productId: cable, quantity: 2 }],
      }).expect(200);
      expect(res.body.data).toMatchObject({
        lines: [{ unitPrice: '16500.00', lineTotal: '33000.00' }],
        subtotal: '33000.00',
        taxAmount: '5940.00',
        total: '38940.00',
      });
    });
  });
});
