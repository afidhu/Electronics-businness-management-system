/**
 * Module 6 — Stage 6.4: complete POS sales workflow (FR-SALE-02..07/09..11,
 * BR-02, BR-04, S4, S5, S8, S11, S16, S17, ADR-031). Stock is received
 * through the real PO → approve → receive API; sales go through POST /sales.
 */
import { randomUUID } from 'node:crypto';
import type { RoleKey } from '../src/access/permissions';
import { AuditService } from '../src/audit/audit.service';
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
  | 'cashierA2'
  | 'cashierB'
  | 'managerA'
  | 'managerB'
  | 'procA'
  | 'procB'
  | 'invA'
  | 'invB'
  | 'techA'
  | 'auditorA';

const YEAR = String(new Date().getUTCFullYear());

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
let imeiSeq = 35209900000500;
const nextImei = () => imei(String(imeiSeq++));

describe('POS sales workflow — Module 6 stage 6.4 (e2e)', () => {
  let ctx: TestContext;
  let A: string;
  let B: string;
  let C: string; // inactive
  const token: Partial<Record<Who, string>> = {};
  const ids: Partial<Record<Who, string>> = {};
  const as = (who: Who) => bearer(token[who]!);
  let supplierId: string;
  let laptop: string; // SERIAL ×1, sells 1,750,000, cost 1,400,000
  let phone: string; // IMEI ×2, sells 900,000, cost 700,000
  let cable: string; // QUANTITY, sells 15,000, cost 8,000
  let simcard: string; // QUANTITY, 3 in stock (last-stock race), sells 5,000
  let retired: string; // QUANTITY, deactivated after receiving
  const laptopSerials = [
    '5CG8001AAA',
    '5CG8002BBB',
    '5CG8003CCC',
    '5CG8004DDD',
    '5CG8005EEE',
  ];
  const laptopSerialB = '5CG8999BBB';
  let phoneImeis: string[];
  let customerId: string;
  let inactiveCustomerId: string;

  const users: [Who, RoleKey, () => string[]][] = [
    ['admin', 'SYSTEM_ADMIN', () => []],
    ['cashierA', 'CASHIER', () => [A]],
    ['cashierA2', 'CASHIER', () => [A]],
    ['cashierB', 'CASHIER', () => [B]],
    ['managerA', 'MANAGER', () => [A]],
    ['managerB', 'MANAGER', () => [B]],
    ['procA', 'PROCUREMENT_OFFICER', () => [A]],
    ['procB', 'PROCUREMENT_OFFICER', () => [B]],
    ['invA', 'INVENTORY_OFFICER', () => [A]],
    ['invB', 'INVENTORY_OFFICER', () => [B]],
    ['techA', 'TECHNICIAN', () => [A]],
    ['auditorA', 'AUDITOR', () => [A]],
  ];

  const http = () => ctx.http();
  const post = (who: Who, url: string, body: unknown = {}) =>
    http()
      .post(url)
      .set(as(who))
      .send(body as object);
  const get = (who: Who, url: string, query: Record<string, unknown> = {}) =>
    http().get(url).set(as(who)).query(query);
  const checkout = (who: Who, body: Record<string, unknown>) =>
    post(who, '/api/v1/sales', { idempotencyKey: randomUUID(), ...body });
  const setVat = (ratePercent: string) =>
    http()
      .put('/api/v1/settings/tax')
      .set(as('admin'))
      .send({ ratePercent })
      .expect(200);
  const cash = (amount: string, amountTendered?: string) => ({
    method: 'CASH',
    amount,
    ...(amountTendered ? { amountTendered } : {}),
  });
  const balance = async (productId: string, branchId = A) =>
    (
      await ctx.prisma.stockBalance.findUnique({
        where: { productId_branchId: { productId, branchId } },
      })
    )?.onHand ?? 0;
  const unitBySerial = async (value: string) =>
    ctx.prisma.productUnit.findFirstOrThrow({
      where: { identifiers: { some: { value } } },
    });

  /** Everything a refused or rolled-back checkout must leave untouched. */
  const snapshot = async () => ({
    sales: await ctx.prisma.sale.count(),
    items: await ctx.prisma.saleItem.count(),
    payments: await ctx.prisma.payment.count(),
    movements: await ctx.prisma.stockMovement.count(),
    audit: await ctx.prisma.auditLog.count(),
    balances: (
      await ctx.prisma.stockBalance.findMany({
        orderBy: [{ productId: 'asc' }, { branchId: 'asc' }],
      })
    ).map((b) => `${b.productId}/${b.branchId}/${b.onHand}`),
    units: (
      await ctx.prisma.productUnit.findMany({ orderBy: { id: 'asc' } })
    ).map((u) => `${u.id}/${u.status}`),
    sequences: (
      await ctx.prisma.documentSequence.findMany({ orderBy: { scope: 'asc' } })
    ).map((s) => `${s.scope}=${s.lastValue}`),
  });

  async function receiveAt(
    branch: 'A' | 'B',
    items: {
      productId: string;
      quantity: number;
      unitCost: string;
      units?: string[][];
    }[],
  ) {
    const [proc, mgr, inv, branchId] =
      branch === 'A'
        ? (['procA', 'managerA', 'invA', A] as const)
        : (['procB', 'managerB', 'invB', B] as const);
    const created = await post(proc, '/api/v1/purchases', {
      branchId,
      supplierId,
      items: items.map(({ productId, quantity, unitCost }) => ({
        productId,
        quantity,
        unitCost,
      })),
    }).expect(201);
    const poId = created.body.data.id as string;
    await post(proc, `/api/v1/purchases/${poId}/submit`).expect(200);
    await post(mgr, `/api/v1/purchases/${poId}/approve`).expect(200);
    const lines = await ctx.prisma.purchaseItem.findMany({
      where: { purchaseId: poId },
    });
    await post(inv, `/api/v1/purchases/${poId}/receive`, {
      idempotencyKey: randomUUID(),
      items: items.map((i) => ({
        purchaseItemId: lines.find((l) => l.productId === i.productId)!.id,
        quantity: i.quantity,
        ...(i.units
          ? { units: i.units.map((identifiers) => ({ identifiers })) }
          : {}),
      })),
    }).expect(201);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    A = await createBranch(ctx.prisma, 'BR-A');
    B = await createBranch(ctx.prisma, 'BR-B');
    C = await createBranch(ctx.prisma, 'BR-C', false);
    for (const [who, role, branches] of users) {
      const email = `${who.toLowerCase()}@sales.test`;
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
      data: { name: 'HP', nameKey: 'hp' },
    });
    const mk = async (
      sku: string,
      mode: 'SERIALIZED' | 'QUANTITY',
      type: 'IMEI' | 'SERIAL' | null,
      per: number | null,
      sellingPrice: string,
    ) =>
      (
        await ctx.prisma.product.create({
          data: {
            sku,
            name: `${sku} name`,
            categoryId: cat.id,
            brandId: brand.id,
            trackingMode: mode,
            identifierType: type,
            identifiersPerUnit: per,
            costPrice: '1',
            sellingPrice,
            reorderLevel: 1,
          },
        })
      ).id;
    laptop = await mk('LAPTOP-450', 'SERIALIZED', 'SERIAL', 1, '1750000');
    phone = await mk('PHONE-DS', 'SERIALIZED', 'IMEI', 2, '900000');
    cable = await mk('CABLE-USBC', 'QUANTITY', null, null, '15000');
    simcard = await mk('SIM-STARTER', 'QUANTITY', null, null, '5000');
    retired = await mk('OLD-CASE', 'QUANTITY', null, null, '1000');
    supplierId = (
      await ctx.prisma.supplier.create({
        data: { name: 'Supplier', nameKey: 'supplier' },
      })
    ).id;
    phoneImeis = [nextImei(), nextImei()];
    await receiveAt('A', [
      {
        productId: laptop,
        quantity: laptopSerials.length,
        unitCost: '1400000',
        units: laptopSerials.map((s) => [s]),
      },
      {
        productId: phone,
        quantity: 1,
        unitCost: '700000',
        units: [phoneImeis],
      },
      { productId: cable, quantity: 40, unitCost: '8000' },
      { productId: simcard, quantity: 3, unitCost: '2000' },
      { productId: retired, quantity: 2, unitCost: '500' },
    ]);
    await receiveAt('B', [
      {
        productId: laptop,
        quantity: 1,
        unitCost: '1400000',
        units: [[laptopSerialB]],
      },
      { productId: cable, quantity: 5, unitCost: '8000' },
    ]);
    await ctx.prisma.product.update({
      where: { id: retired },
      data: { isActive: false },
    });
    customerId = (
      await post('cashierA', '/api/v1/customers', {
        name: 'Asha Mwinyi',
        phone: '0712 345 678',
      }).expect(201)
    ).body.data.id;
    inactiveCustomerId = (
      await ctx.prisma.customer.create({
        data: { name: 'Gone', isActive: false, createdById: ids.admin! },
      })
    ).id;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ======================================================== VAT guard
  it('checkout is blocked until VAT is configured (409 TAX_NOT_CONFIGURED), changing nothing', async () => {
    const before = await snapshot();
    const res = await checkout('cashierA', {
      items: [{ productId: cable, quantity: 1 }],
      payments: [cash('17700')],
    }).expect(409);
    expect(res.body.code).toBe('TAX_NOT_CONFIGURED');
    expect(await snapshot()).toEqual(before);
    await setVat('18');
  });

  // ================================================ complete workflow
  describe('complete workflow: receive → search → quote → checkout → receipt', () => {
    let saleId: string;

    it('search, choose a device, preview, check out with split payment', async () => {
      // Search (6.3)
      const found = await get('cashierA', '/api/v1/pos/catalogue', {
        q: 'laptop',
      }).expect(200);
      expect(found.body.data[0]).toMatchObject({
        id: laptop,
        available: 5,
        sellingPrice: '1750000.00',
      });
      // Choose a device by scanning its serial
      const unit = await get('cashierA', '/api/v1/pos/units', {
        identifier: laptopSerials[0].toLowerCase(),
      }).expect(200);
      const unitId = unit.body.data[0].id as string;
      // Preview
      const items = [
        { productId: laptop, unitId },
        { productId: cable, quantity: 2 },
      ];
      const quote = await post('cashierA', '/api/v1/pos/quote', {
        items,
      }).expect(200);
      expect(quote.body.data.total).toBe('2100400.00');
      // Checkout
      const res = await checkout('cashierA', {
        customerId,
        items,
        payments: [
          {
            method: 'MOBILE_MONEY',
            amount: '1500000.00',
            reference: 'MP26111712AB',
          },
          cash('600400.00', '601000.00'),
        ],
      }).expect(201);
      const sale = res.body.data;
      saleId = sale.id;
      expect(sale).toMatchObject({
        receiptNumber: `RCT-BR-A-${YEAR}-000001`,
        status: 'COMPLETED',
        businessName: 'ElectroCore Electronics',
        branch: { id: A, code: 'BR-A', name: 'Branch BR-A' },
        cashier: { id: ids.cashierA },
        customer: {
          id: customerId,
          name: 'Asha Mwinyi',
          phone: '+255712345678',
        },
        timeZone: 'Africa/Dar_es_Salaam',
        currency: 'TZS',
        priceIncludesTax: false,
        subtotal: '1780000.00',
        discountTotal: '0.00',
        taxRatePercent: '18.00',
        taxAmount: '320400.00',
        total: '2100400.00',
        amountPaid: '2100400.00',
        changeGiven: '600.00',
        payments: [
          {
            method: 'MOBILE_MONEY',
            amount: '1500000.00',
            amountTendered: null,
            reference: 'MP26111712AB',
          },
          {
            method: 'CASH',
            amount: '600400.00',
            amountTendered: '601000.00',
            reference: null,
          },
        ],
        lines: [
          {
            lineNumber: 1,
            productId: laptop,
            sku: 'LAPTOP-450',
            productName: 'LAPTOP-450 name',
            quantity: 1,
            unitPrice: '1750000.00',
            lineTotal: '1750000.00',
            unit: {
              id: unitId,
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
      expect(sale.businessDateTime).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
      // Cashiers never see costs (FR-INV-12, S11).
      expect(JSON.stringify(res.body)).not.toMatch(/cost/i);
    });

    it('stock was deducted, the device is SOLD, and SALE ledger rows reference the sale', async () => {
      expect(await balance(cable)).toBe(38);
      expect(await balance(laptop)).toBe(4);
      expect((await unitBySerial(laptopSerials[0])).status).toBe('SOLD');
      const movements = await ctx.prisma.stockMovement.findMany({
        where: { referenceType: 'SALE', referenceId: saleId },
        orderBy: { quantityDelta: 'asc' },
      });
      expect(
        movements.map((m) => ({
          productId: m.productId,
          branchId: m.branchId,
          type: m.movementType,
          qty: m.quantityDelta,
          unitCost: m.unitCost.toFixed(2),
          value: m.valueDelta.toFixed(2),
          unit: m.productUnitId !== null,
          actor: m.actorId,
        })),
      ).toEqual([
        {
          productId: cable,
          branchId: A,
          type: 'SALE',
          qty: -2,
          unitCost: '8000.00',
          value: '-16000.00',
          unit: false,
          actor: ids.cashierA,
        },
        {
          productId: laptop,
          branchId: A,
          type: 'SALE',
          qty: -1,
          unitCost: '1400000.00',
          value: '-1400000.00',
          unit: true,
          actor: ids.cashierA,
        },
      ]);
      // Moving WAC is unchanged by an outflow.
      const wac = await ctx.prisma.inventoryValuation.findUniqueOrThrow({
        where: { productId: cable },
      });
      expect(wac.averageCost.toFixed(4)).toBe('8000.0000');
    });

    it('sale.completed is audited in the same transaction, without payment references', async () => {
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'sale.completed', entityId: saleId },
      });
      expect(log).toMatchObject({
        entityType: 'Sale',
        branchId: A,
        actorId: ids.cashierA,
      });
      expect(log.metadata).toEqual({
        receiptNumber: `RCT-BR-A-${YEAR}-000001`,
        total: '2100400.00',
        taxRatePercent: '18.00',
        paymentMethods: ['MOBILE_MONEY', 'CASH'],
        lineCount: 2,
        unitCount: 3,
        customerId,
      });
      expect(JSON.stringify(log.metadata)).not.toContain('MP2611');
    });

    it('receipt data for printing; costs only in the detail and only with catalogue:cost_read', async () => {
      const receipt = await get(
        'cashierA',
        `/api/v1/sales/${saleId}/receipt`,
      ).expect(200);
      expect(receipt.body.data.receiptNumber).toBe(`RCT-BR-A-${YEAR}-000001`);
      expect(receipt.body.data.lines).toHaveLength(2);
      const mgrReceipt = await get(
        'managerA',
        `/api/v1/sales/${saleId}/receipt`,
      ).expect(200);
      expect(JSON.stringify(mgrReceipt.body)).not.toMatch(/cost/i);

      const cashierDetail = await get(
        'cashierA',
        `/api/v1/sales/${saleId}`,
      ).expect(200);
      expect(JSON.stringify(cashierDetail.body)).not.toMatch(/cost/i);
      for (const who of ['managerA', 'auditorA', 'admin'] as const) {
        const d = await get(who, `/api/v1/sales/${saleId}`).expect(200);
        expect(
          d.body.data.lines.map((l: { costAtSale: string }) => l.costAtSale),
        ).toEqual(['1400000.0000', '8000.0000']);
      }
    });

    it('receipt numbers are sequential per branch and year', async () => {
      const second = await checkout('cashierA2', {
        items: [{ productId: cable, quantity: 1 }],
        payments: [{ method: 'CARD', amount: '17700.00' }],
      }).expect(201);
      expect(second.body.data.receiptNumber).toBe(`RCT-BR-A-${YEAR}-000002`);
      const atB = await checkout('cashierB', {
        items: [{ productId: cable, quantity: 1 }],
        payments: [
          { method: 'BANK_TRANSFER', amount: '17700', reference: 'TRX-889' },
        ],
      }).expect(201);
      expect(atB.body.data.receiptNumber).toBe(`RCT-BR-B-${YEAR}-000001`);
      expect(atB.body.data.branch.id).toBe(B);
    });
  });

  // ========================================================= payments
  describe('payments (S4)', () => {
    const cableItem = () => [{ productId: cable, quantity: 2 }]; // 30,000 + 5,400 = 35,400

    it('all four methods in one sale (split), exact total, no change', async () => {
      const res = await checkout('cashierA', {
        items: cableItem(),
        payments: [
          { method: 'CARD', amount: '10000', reference: 'AUTH-1234' },
          { method: 'MOBILE_MONEY', amount: '10000', reference: 'MP-1' },
          { method: 'BANK_TRANSFER', amount: '10000', reference: 'BT-1' },
          cash('5400'),
        ],
      }).expect(201);
      expect(
        res.body.data.payments.map((p: { method: string }) => p.method),
      ).toEqual(['CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CASH']);
      expect(res.body.data.changeGiven).toBe('0.00');
    });

    it.each([
      ['underpayment', [cash('35399.99')]],
      ['overpayment', [{ method: 'CARD', amount: '35400.01' }]],
      [
        'split short by one cent',
        [{ method: 'CARD', amount: '20000' }, cash('15399.99', '20000')],
      ],
    ])('%s → 400 PAYMENT_MISMATCH; nothing changes', async (_l, payments) => {
      const before = await snapshot();
      const res = await checkout('cashierA', {
        items: cableItem(),
        payments,
      }).expect(400);
      expect(res.body.code).toBe('PAYMENT_MISMATCH');
      expect(await snapshot()).toEqual(before);
    });

    it.each([
      [
        'mobile money without reference',
        [{ method: 'MOBILE_MONEY', amount: '35400' }],
      ],
      [
        'bank transfer with a blank reference',
        [{ method: 'BANK_TRANSFER', amount: '35400', reference: '   ' }],
      ],
      ['cash tendered below the amount', [cash('35400', '35000')]],
      [
        'amount tendered on a card',
        [{ method: 'CARD', amount: '35400', amountTendered: '40000' }],
      ],
      ['a zero amount', [cash('0'), cash('35400')]],
      ['a negative amount', [cash('-1')]],
      ['three decimals', [cash('35400.001')]],
      ['a numeric amount', [{ method: 'CASH', amount: 35400 }]],
      ['an unknown method', [{ method: 'CREDIT', amount: '35400' }]],
      ['no payments', []],
      ['six payments', Array.from({ length: 6 }, () => cash('5900'))],
    ])('%s → 400; nothing changes', async (_l, payments) => {
      const before = await snapshot();
      const res = await checkout('cashierA', {
        items: cableItem(),
        payments,
      }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.details)).toContain('payments');
      expect(await snapshot()).toEqual(before);
    });
  });

  // ======================================================== tampering
  describe('client prices, totals and tax are never trusted (FR-SALE-03)', () => {
    it.each([
      ['unitPrice on a line', { line: { unitPrice: '1' } }],
      ['lineTotal on a line', { line: { lineTotal: '1' } }],
      ['costAtSale on a line', { line: { costAtSale: '1' } }],
      ['subtotal', { subtotal: '1' }],
      ['taxAmount', { taxAmount: '0' }],
      ['taxRatePercent', { taxRatePercent: '0' }],
      ['total', { total: '1' }],
      ['discountTotal', { discountTotal: '100' }],
      ['amountPaid', { amountPaid: '1' }],
      ['changeGiven', { changeGiven: '1000000' }],
      ['cashierId', { cashierId: randomUUID() }],
      ['receiptNumber', { receiptNumber: 'RCT-BR-A-2026-999999' }],
      ['status', { status: 'COMPLETED' }],
    ] as [string, Record<string, unknown>][])(
      'rejects a client-supplied %s (400); nothing changes',
      async (_l, extra) => {
        const { line, ...top } = extra as {
          line?: Record<string, unknown>;
        };
        const field = Object.keys(line ?? top)[0];
        const before = await snapshot();
        const res = await checkout('cashierA', {
          items: [{ productId: cable, quantity: 1, ...line }],
          payments: [cash('17700')],
          ...top,
        }).expect(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        // Refused because of the tampered field itself (the rest is valid).
        expect(JSON.stringify(res.body.details)).toContain(field);
        expect(await snapshot()).toEqual(before);
      },
    );

    it('a payment computed from a tampered (lower) price is refused as a mismatch', async () => {
      const res = await checkout('cashierA', {
        items: [{ productId: laptop, identifier: laptopSerials[1] }],
        payments: [cash('1180')], // as if the laptop cost 1,000
      }).expect(400);
      expect(res.body.code).toBe('PAYMENT_MISMATCH');
      expect((await unitBySerial(laptopSerials[1])).status).toBe('IN_STOCK');
    });
  });

  // ============================================== stock and devices
  describe('stock and device rules', () => {
    it('insufficient stock → 409 INSUFFICIENT_STOCK; nothing changes', async () => {
      const before = await snapshot();
      const res = await checkout('cashierB', {
        items: [{ productId: cable, quantity: 5 }], // B has 4 left
        payments: [cash('88500')],
      }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(await snapshot()).toEqual(before);
    });

    it('a sold device, or one at another branch, cannot be sold (409 UNIT_NOT_AVAILABLE)', async () => {
      for (const identifier of [laptopSerials[0], laptopSerialB]) {
        const res = await checkout('cashierA', {
          items: [{ productId: laptop, identifier }],
          payments: [cash('2065000')],
        }).expect(409);
        expect(res.body.code).toBe('UNIT_NOT_AVAILABLE');
      }
    });

    it('inactive product → 400 PRODUCT_NOT_SELLABLE', async () => {
      const res = await checkout('cashierA', {
        items: [{ productId: retired, quantity: 1 }],
        payments: [cash('1180')],
      }).expect(400);
      expect(res.body.code).toBe('PRODUCT_NOT_SELLABLE');
    });

    it('a dual-IMEI phone sells by either IMEI and leaves no stock', async () => {
      const res = await checkout('cashierA', {
        items: [{ productId: phone, identifier: phoneImeis[1] }],
        payments: [cash('1062000', '1100000')],
      }).expect(201);
      expect(res.body.data.changeGiven).toBe('38000.00');
      expect(
        res.body.data.lines[0].unit.identifiers.map(
          (i: { value: string }) => i.value,
        ),
      ).toEqual(phoneImeis);
      expect(await balance(phone)).toBe(0);
    });
  });

  // ================================================== idempotency
  describe('idempotency and retries (S16)', () => {
    it('a retry returns the original sale (200) and changes nothing', async () => {
      const body = {
        idempotencyKey: randomUUID(),
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700', '20000')],
      };
      const first = await post('cashierA', '/api/v1/sales', body).expect(201);
      const after = await snapshot();
      const retry = await post('cashierA', '/api/v1/sales', body).expect(200);
      expect(retry.body.data).toEqual(first.body.data);
      expect(await snapshot()).toEqual(after);
    });

    it('same key with a different body, or by another cashier → 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const key = randomUUID();
      await post('cashierA', '/api/v1/sales', {
        idempotencyKey: key,
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(201);
      const before = await snapshot();
      const changed = await post('cashierA', '/api/v1/sales', {
        idempotencyKey: key,
        items: [{ productId: cable, quantity: 2 }],
        payments: [cash('35400')],
      }).expect(409);
      expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherCashier = await post('cashierA2', '/api/v1/sales', {
        idempotencyKey: key,
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(409);
      expect(otherCashier.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await snapshot()).toEqual(before);
    });

    it('missing or malformed idempotency key → 400', async () => {
      await post('cashierA', '/api/v1/sales', {
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(400);
      await post('cashierA', '/api/v1/sales', {
        idempotencyKey: 'abc',
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(400);
    });

    it('6 simultaneous submissions of one sale (double-click/retry) create exactly one sale', async () => {
      const body = {
        idempotencyKey: randomUUID(),
        items: [{ productId: laptop, identifier: laptopSerials[1] }],
        payments: [cash('2065000')],
      };
      const before = await ctx.prisma.sale.count();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          post('cashierA', '/api/v1/sales', body),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 200, 201]);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await ctx.prisma.sale.count()).toBe(before + 1);
    });
  });

  // ================================================== concurrency
  describe('simultaneous checkouts (BR-02, BR-04)', () => {
    it('6 cashiers race for the last 3 SIM cards: exactly 3 sales, stock 0, never negative', async () => {
      expect(await balance(simcard)).toBe(3);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          checkout(i % 2 ? 'cashierA' : 'cashierA2', {
            items: [{ productId: simcard, quantity: 1 }],
            payments: [cash('5900')],
          }),
        ),
      );
      const ok = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(3);
      expect(refused).toHaveLength(3);
      for (const r of refused) expect(r.body.code).toBe('INSUFFICIENT_STOCK');
      expect(await balance(simcard)).toBe(0);
      const sold = await ctx.prisma.saleItem.aggregate({
        where: { productId: simcard },
        _sum: { quantity: true },
      });
      expect(sold._sum.quantity).toBe(3);
    });

    it('5 different checkouts of the same device: exactly one succeeds', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          checkout(i % 2 ? 'cashierA' : 'cashierA2', {
            items: [{ productId: laptop, identifier: laptopSerials[2] }],
            payments: [cash('2065000')],
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        201, 409, 409, 409, 409,
      ]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('UNIT_NOT_AVAILABLE');
      }
      const unit = await unitBySerial(laptopSerials[2]);
      expect(unit.status).toBe('SOLD');
      expect(
        await ctx.prisma.saleItem.count({ where: { productUnitId: unit.id } }),
      ).toBe(1);
      expect(
        await ctx.prisma.stockMovement.count({
          where: { productUnitId: unit.id, movementType: 'SALE' },
        }),
      ).toBe(1);
    });
  });

  // ===================================================== rollback
  describe('rollback (T-10)', () => {
    it('a failure after stock, units, sale and payments were written rolls back everything', async () => {
      const audit = ctx.app.get(AuditService);
      const spy = jest
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('simulated failure'));
      const before = await snapshot();
      try {
        const res = await checkout('cashierA', {
          items: [
            { productId: laptop, identifier: laptopSerials[3] },
            { productId: cable, quantity: 3 },
          ],
          payments: [cash('2118100')],
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('simulated');
      } finally {
        spy.mockRestore();
      }
      expect(await snapshot()).toEqual(before);
      expect((await unitBySerial(laptopSerials[3])).status).toBe('IN_STOCK');
      // The receipt sequence was rolled back too: no gap.
      const next = await checkout('cashierA', {
        items: [{ productId: laptop, identifier: laptopSerials[3] }],
        payments: [cash('2065000')],
      }).expect(201);
      const prev = before.sequences
        .find((s) => s.startsWith(`RCT:BR-A:`))!
        .split('=')[1];
      expect(next.body.data.receiptNumber).toBe(
        `RCT-BR-A-${YEAR}-${String(Number(prev) + 1).padStart(6, '0')}`,
      );
    });

    it('a mixed cart failing on its last line leaves the earlier lines untouched', async () => {
      const before = await snapshot();
      const res = await checkout('cashierA', {
        items: [
          { productId: cable, quantity: 1 },
          { productId: simcard, quantity: 1 }, // sold out
        ],
        payments: [cash('23600')],
      }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(await snapshot()).toEqual(before);
    });
  });

  // ============================================ roles and branches
  describe('permissions and branch access', () => {
    const NON_SELLERS: Who[] = [
      'managerA',
      'procA',
      'invA',
      'techA',
      'auditorA',
    ];

    it('401 without a token', async () => {
      await http().post('/api/v1/sales').send({}).expect(401);
      await http().get('/api/v1/sales').expect(401);
      await http().get('/api/v1/sales/summary').expect(401);
    });

    it.each(NON_SELLERS)(
      '%s cannot check out (403); nothing changes',
      async (who) => {
        const before = await snapshot();
        const res = await checkout(who, {
          branchId: A,
          items: [{ productId: cable, quantity: 1 }],
          payments: [cash('17700')],
        }).expect(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
        expect(await snapshot()).toEqual(before);
      },
    );

    it('a cashier cannot sell at another branch; admin must choose an active branch', async () => {
      const other = await checkout('cashierA', {
        branchId: B,
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(403);
      expect(other.body.code).toBe('BRANCH_ACCESS_DENIED');
      await checkout('admin', {
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(400);
      const inactive = await checkout('admin', {
        branchId: C,
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(400);
      expect(inactive.body.code).toBe('REFERENCE_INACTIVE');
      const ok = await checkout('admin', {
        branchId: B,
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(201);
      expect(ok.body.data.receiptNumber).toMatch(/^RCT-BR-B-/);
    });

    it('unknown or inactive customer → 400', async () => {
      await checkout('cashierA', {
        customerId: randomUUID(),
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(400);
      const res = await checkout('cashierA', {
        customerId: inactiveCustomerId,
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('17700')],
      }).expect(400);
      expect(res.body.code).toBe('REFERENCE_INACTIVE');
    });

    it('sales list is branch-scoped: cashiers see their whole branch (S8), managers their branches, admin all', async () => {
      const branchesSeen = async (who: Who) => {
        const res = await get(who, '/api/v1/sales', { limit: 100 }).expect(200);
        return [
          ...new Set(
            res.body.data.map(
              (s: { branch: { code: string } }) => s.branch.code,
            ),
          ),
        ].sort();
      };
      expect(await branchesSeen('cashierA')).toEqual(['BR-A']);
      expect(await branchesSeen('cashierB')).toEqual(['BR-B']);
      expect(await branchesSeen('managerA')).toEqual(['BR-A']);
      expect(await branchesSeen('auditorA')).toEqual(['BR-A']);
      expect(await branchesSeen('admin')).toEqual(['BR-A', 'BR-B']);
      const mine = await get('cashierA', '/api/v1/sales', { limit: 100 });
      const cashiers = new Set(
        mine.body.data.map((s: { cashier: { id: string } }) => s.cashier.id),
      );
      expect(cashiers.has(ids.cashierA2!)).toBe(true);
      for (const who of ['invA', 'procA', 'techA'] as Who[]) {
        await get(who, '/api/v1/sales').expect(403);
      }
      await get('cashierA', '/api/v1/sales', { branchId: B }).expect(403);
    });

    it('a sale at another branch is refused (403); unknown sale → 404', async () => {
      const bSale = await ctx.prisma.sale.findFirstOrThrow({
        where: { branchId: B },
      });
      for (const path of [
        `/api/v1/sales/${bSale.id}`,
        `/api/v1/sales/${bSale.id}/receipt`,
      ]) {
        const res = await get('cashierA', path).expect(403);
        expect(res.body.code).toBe('BRANCH_ACCESS_DENIED');
      }
      await get('cashierA', `/api/v1/sales/${randomUUID()}`).expect(404);
      await get('cashierA', '/api/v1/sales/not-a-uuid').expect(400);
    });

    it('filters: receipt number, cashier, customer, business-date range', async () => {
      const byReceipt = await get('cashierA', '/api/v1/sales', {
        receiptNumber: `rct-br-a-${YEAR}-000001`,
      }).expect(200);
      expect(byReceipt.body.data).toHaveLength(1);
      expect(byReceipt.body.data[0]).toMatchObject({
        receiptNumber: `RCT-BR-A-${YEAR}-000001`,
        total: '2100400.00',
        lineCount: 2,
        paymentMethods: ['MOBILE_MONEY', 'CASH'],
        customer: { id: customerId, name: 'Asha Mwinyi' },
      });
      const byCashier = await get('managerA', '/api/v1/sales', {
        cashierId: ids.cashierA2,
        limit: 100,
      }).expect(200);
      expect(
        byCashier.body.data.every(
          (s: { cashier: { id: string } }) => s.cashier.id === ids.cashierA2,
        ),
      ).toBe(true);
      const byCustomer = await get('managerA', '/api/v1/sales', {
        customerId,
      }).expect(200);
      expect(byCustomer.body.meta.pagination.total).toBe(1);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Dar_es_Salaam',
      }).format(new Date());
      const todays = await get('managerA', '/api/v1/sales', {
        from: today,
        to: today,
      }).expect(200);
      expect(todays.body.meta.pagination.total).toBe(
        await ctx.prisma.sale.count({ where: { branchId: A } }),
      );
      const past = await get('managerA', '/api/v1/sales', {
        from: '2020-01-01',
        to: '2020-01-31',
      }).expect(200);
      expect(past.body.data).toEqual([]);
      await get('managerA', '/api/v1/sales', {
        from: today,
        to: '2020-01-01',
      }).expect(400);
      await get('managerA', '/api/v1/sales', { from: '16-11-2026' }).expect(
        400,
      );
    });
  });

  // ======================================================== snapshots
  describe('price and VAT snapshots (S20, FR-SALE-11)', () => {
    it('later price and VAT changes never alter completed sales; new sales use the new values', async () => {
      const first = await ctx.prisma.sale.findFirstOrThrow({
        where: { receiptNumber: `RCT-BR-A-${YEAR}-000001` },
        include: { items: true },
      });
      await http()
        .patch(`/api/v1/products/${cable}`)
        .set(as('managerA'))
        .send({ sellingPrice: '16000' })
        .expect(200);
      await setVat('16');
      const res = await checkout('cashierA', {
        items: [{ productId: cable, quantity: 1 }],
        payments: [cash('18560')],
      }).expect(201);
      expect(res.body.data).toMatchObject({
        taxRatePercent: '16.00',
        subtotal: '16000.00',
        taxAmount: '2560.00',
        total: '18560.00',
      });
      const again = await get('cashierA', `/api/v1/sales/${first.id}`).expect(
        200,
      );
      expect(again.body.data).toMatchObject({
        taxRatePercent: '18.00',
        total: '2100400.00',
        lines: [{ unitPrice: '1750000.00' }, { unitPrice: '15000.00' }],
      });
      await setVat('18');
    });
  });

  // ========================================================== summary
  describe('daily sales summary (S17)', () => {
    const today = () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Dar_es_Salaam',
      }).format(new Date());

    it('matches the database for the manager’s branch; payment methods add up to the total', async () => {
      const res = await get('managerA', '/api/v1/sales/summary').expect(200);
      const s = res.body.data;
      const sales = await ctx.prisma.sale.findMany({
        where: { branchId: A },
        include: { items: true, payments: true },
      });
      const sum = (xs: { toString(): string }[]) =>
        xs.reduce(
          (a: number, v) => a + Math.round(Number(v.toString()) * 100),
          0,
        );
      expect(s).toMatchObject({
        date: today(),
        timeZone: 'Africa/Dar_es_Salaam',
        currency: 'TZS',
        branches: [{ id: A, code: 'BR-A' }],
        saleCount: sales.length,
        unitsSold: sales
          .flatMap((x) => x.items)
          .reduce((n, i) => n + i.quantity, 0),
      });
      expect(Math.round(Number(s.total) * 100)).toBe(
        sum(sales.map((x) => x.total)),
      );
      expect(Math.round(Number(s.taxAmount) * 100)).toBe(
        sum(sales.map((x) => x.taxAmount)),
      );
      expect(
        s.byPaymentMethod.reduce(
          (a: number, m: { amount: string }) =>
            a + Math.round(Number(m.amount) * 100),
          0,
        ),
      ).toBe(sum(sales.map((x) => x.total)));
      expect(
        s.byPaymentMethod.map((m: { method: string }) => m.method),
      ).toEqual(['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER']);
      expect(
        s.byCashier.reduce(
          (n: number, c: { saleCount: number }) => n + c.saleCount,
          0,
        ),
      ).toBe(sales.length);
      expect(s.costOfGoodsSold).toMatch(/^\d+\.\d{2}$/);
      expect(s.grossProfit).toMatch(/^-?\d+\.\d{2}$/);
    });

    it('auditor and admin may read it; cashiers and other roles may not; branch scope enforced', async () => {
      await get('auditorA', '/api/v1/sales/summary').expect(200);
      const all = await get('admin', '/api/v1/sales/summary').expect(200);
      expect(
        all.body.data.branches.map((b: { code: string }) => b.code),
      ).toEqual(['BR-A', 'BR-B', 'BR-C']);
      expect(all.body.data.saleCount).toBe(await ctx.prisma.sale.count());
      for (const who of ['cashierA', 'invA', 'procA', 'techA'] as Who[]) {
        const res = await get(who, '/api/v1/sales/summary').expect(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
      }
      await get('managerA', '/api/v1/sales/summary', { branchId: B }).expect(
        403,
      );
    });

    it('a day without sales is all zeros; bad dates → 400', async () => {
      const res = await get('managerA', '/api/v1/sales/summary', {
        date: '2020-01-01',
      }).expect(200);
      expect(res.body.data).toMatchObject({
        saleCount: 0,
        unitsSold: 0,
        total: '0.00',
        byCashier: [],
        costOfGoodsSold: '0.00',
      });
      await get('managerA', '/api/v1/sales/summary', { date: 'today' }).expect(
        400,
      );
    });
  });

  // ================================================== reconciliation
  describe('reconciliation (BR-04, BR-16, BR-19)', () => {
    it('balances = Σ movements; serialized on-hand = IN_STOCK units; never negative', async () => {
      expect(
        await ctx.prisma.$queryRaw<unknown[]>`
          SELECT b.product_id, b.branch_id FROM stock_balances b
          LEFT JOIN (SELECT product_id, branch_id, SUM(quantity_delta)::int s FROM stock_movements GROUP BY 1, 2) m
            ON m.product_id = b.product_id AND m.branch_id = b.branch_id
          WHERE b.on_hand <> COALESCE(m.s, 0) OR b.on_hand < 0`,
      ).toEqual([]);
      expect(
        await ctx.prisma.$queryRaw<unknown[]>`
          SELECT b.product_id, b.branch_id FROM stock_balances b
          JOIN products p ON p.id = b.product_id AND p.tracking_mode = 'SERIALIZED'
          LEFT JOIN (SELECT product_id, branch_id, count(*)::int n FROM product_units WHERE status = 'IN_STOCK' GROUP BY 1, 2) u
            ON u.product_id = b.product_id AND u.branch_id = b.branch_id
          WHERE b.on_hand <> COALESCE(u.n, 0)`,
      ).toEqual([]);
    });

    it('every sale’s SALE movements equal its lines; SOLD units = sold lines; payments = totals', async () => {
      expect(
        await ctx.prisma.$queryRaw<unknown[]>`
          SELECT s.id FROM sales s
          LEFT JOIN (SELECT sale_id, SUM(quantity)::int q FROM sale_items GROUP BY 1) i ON i.sale_id = s.id
          LEFT JOIN (SELECT reference_id, SUM(-quantity_delta)::int q FROM stock_movements
                     WHERE reference_type = 'SALE' AND movement_type = 'SALE' GROUP BY 1) m ON m.reference_id = s.id
          WHERE COALESCE(i.q, 0) <> COALESCE(m.q, 0)`,
      ).toEqual([]);
      expect(
        await ctx.prisma.$queryRaw<unknown[]>`
          SELECT u.id FROM product_units u
          LEFT JOIN sale_items i ON i.product_unit_id = u.id
          WHERE (u.status = 'SOLD') <> (i.id IS NOT NULL)`,
      ).toEqual([]);
      expect(
        await ctx.prisma.$queryRaw<unknown[]>`
          SELECT s.id FROM sales s
          JOIN (SELECT sale_id, SUM(amount) a FROM payments GROUP BY 1) p ON p.sale_id = s.id
          WHERE p.a <> s.total OR s.amount_paid <> s.total`,
      ).toEqual([]);
      // Every movement references an existing sale (no orphans from rollbacks).
      expect(
        await ctx.prisma.$queryRaw<unknown[]>`
          SELECT m.id FROM stock_movements m LEFT JOIN sales s ON s.id = m.reference_id
          WHERE m.reference_type = 'SALE' AND s.id IS NULL`,
      ).toEqual([]);
      // One audit event per sale.
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'sale.completed' },
        }),
      ).toBe(await ctx.prisma.sale.count());
    });
  });
});
