/**
 * Module 6 — Stage 6.1: database integrity rules for POS tables (ADR-031).
 * These tests write directly to the TEST database to prove the constraints
 * and triggers hold even if application code were wrong. No API yet (6.2+).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createBranch,
  createTestApp,
  createUser,
  resetDatabase,
  TestContext,
} from './utils/test-app';

const YEAR = String(new Date().getUTCFullYear());

describe('POS schema integrity — Module 6 stage 6.1 (integration)', () => {
  let ctx: TestContext;
  let db: PrismaService;
  let branchId: string;
  let cashierId: string;
  let adminId: string;
  let laptop: string; // SERIALIZED, SERIAL ×1
  let cable: string; // QUANTITY
  let receiptSeq = 1;
  let serialSeq = 1;

  /** Creates an IN_STOCK laptop unit (with its identifier) for sale tests. */
  async function newUnit(productId = laptop): Promise<string> {
    return db.$transaction(async (tx) => {
      const u = await tx.productUnit.create({
        data: { productId, branchId, unitCost: '1400000' },
      });
      await tx.unitIdentifier.create({
        data: {
          productUnitId: u.id,
          type: 'SERIAL',
          value: `POSUNIT${serialSeq++}X`,
          isPrimary: true,
        },
      });
      return u.id;
    });
  }

  interface SaleOpts {
    unitId?: string;
    subtotal?: string;
    taxAmount?: string;
    total?: string;
    amountPaid?: string;
    changeGiven?: string;
    discountTotal?: string;
    receiptNumber?: string;
    items?: Prisma.SaleItemUncheckedCreateWithoutSaleInput[];
    payments?: Prisma.PaymentUncheckedCreateWithoutSaleInput[];
  }

  /**
   * A valid sale: 1 laptop @ 1,750,000 + 2 cables @ 15,000 = 1,780,000;
   * VAT 18% = 320,400; total 2,100,400; paid by mobile money 1,500,000 +
   * cash 600,400 (tendered 601,000 → change 600).
   */
  function sale(o: SaleOpts = {}) {
    return db.sale.create({
      data: {
        receiptNumber:
          o.receiptNumber ??
          `RCT-BR-A-${YEAR}-${String(receiptSeq++).padStart(6, '0')}`,
        branchId,
        cashierId,
        subtotal: o.subtotal ?? '1780000',
        discountTotal: o.discountTotal ?? '0',
        taxRatePercent: '18',
        taxAmount: o.taxAmount ?? '320400',
        total: o.total ?? '2100400',
        amountPaid: o.amountPaid ?? o.total ?? '2100400',
        changeGiven: o.changeGiven ?? '600',
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        items: {
          create: o.items ?? [
            {
              // Scalar FK (never relation `connect`): Prisma treats the unique
              // product_unit_id as 1:1 and a connect would first DETACH the unit
              // from its earlier sale. Checkout code must use scalars too.
              lineNumber: 1,
              productId: laptop,
              productUnitId: o.unitId!,
              sku: 'LAPTOP-1',
              productName: 'Laptop',
              quantity: 1,
              unitPrice: '1750000',
              lineTotal: '1750000',
              costAtSale: '1400000',
            },
            {
              lineNumber: 2,
              productId: cable,
              sku: 'CABLE-1M',
              productName: 'Cable',
              quantity: 2,
              unitPrice: '15000',
              lineTotal: '30000',
              costAtSale: '8000',
            },
          ],
        },
        payments: {
          create: o.payments ?? [
            {
              method: 'MOBILE_MONEY',
              amount: '1500000',
              reference: 'MP26111712AB',
            },
            { method: 'CASH', amount: '600400', amountTendered: '601000' },
          ],
        },
      },
    });
  }

  const cableLine = (lineNumber = 1, quantity = 1, price = '15000') => ({
    lineNumber,
    productId: cable,
    sku: 'CABLE-1M',
    productName: 'Cable',
    quantity,
    unitPrice: price,
    lineTotal: new Prisma.Decimal(price).times(quantity).toFixed(2),
    costAtSale: '8000',
  });

  /** A minimal one-line sale of `qty` cables, paid in cash, no VAT. */
  const cableSale = (overrides: SaleOpts = {}, qty = 1) =>
    sale({
      subtotal: (15000 * qty).toFixed(2),
      taxAmount: '0',
      total: (15000 * qty).toFixed(2),
      changeGiven: '0',
      items: [cableLine(1, qty)],
      payments: [{ method: 'CASH', amount: (15000 * qty).toFixed(2) }],
      ...overrides,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.prisma;
    await resetDatabase(db);
    branchId = await createBranch(db, 'BR-A');
    cashierId = await createUser(db, {
      email: 'cashier@pos.test',
      roleKey: 'CASHIER',
      branchIds: [branchId],
    });
    adminId = await createUser(db, {
      email: 'admin@pos.test',
      roleKey: 'SYSTEM_ADMIN',
    });
    const cat = await db.category.create({ data: { name: 'C', nameKey: 'c' } });
    const brand = await db.brand.create({ data: { name: 'B', nameKey: 'b' } });
    laptop = (
      await db.product.create({
        data: {
          sku: 'LAPTOP-1',
          name: 'Laptop',
          categoryId: cat.id,
          brandId: brand.id,
          trackingMode: 'SERIALIZED',
          identifierType: 'SERIAL',
          identifiersPerUnit: 1,
          costPrice: '1',
          sellingPrice: '1750000',
        },
      })
    ).id;
    cable = (
      await db.product.create({
        data: {
          sku: 'CABLE-1M',
          name: 'Cable',
          categoryId: cat.id,
          brandId: brand.id,
          trackingMode: 'QUANTITY',
          costPrice: '1',
          sellingPrice: '15000',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ------------------------------------------------------------ valid sale
  it('accepts a consistent sale: serialized + quantity lines, split payments, cash change', async () => {
    const unitId = await newUnit();
    const s = await sale({ unitId });
    expect(s.total.toFixed(2)).toBe('2100400.00');
    expect(await db.saleItem.count({ where: { saleId: s.id } })).toBe(2);
    expect(await db.payment.count({ where: { saleId: s.id } })).toBe(2);
  });

  // ------------------------------------------------------ whole-sale rules
  describe('whole-sale consistency (deferred trigger, checked at commit)', () => {
    it('payments must equal the total', async () => {
      await expect(
        cableSale({ payments: [{ method: 'CASH', amount: '14000' }] }),
      ).rejects.toThrow(/payments .* do not equal total/);
    });

    it('a sale needs at least one payment and one line', async () => {
      await expect(cableSale({ payments: [] })).rejects.toThrow(
        /payments .* do not equal total/,
      );
      await expect(cableSale({ items: [] })).rejects.toThrow(
        /lines .* do not match subtotal/,
      );
    });

    it('line totals must sum to the subtotal', async () => {
      await expect(
        cableSale({
          items: [cableLine(1, 1, '14000')],
          payments: [{ method: 'CASH', amount: '15000' }],
        }),
      ).rejects.toThrow(/lines .* do not match subtotal/);
    });

    it('change given must equal cash tendered minus cash amount', async () => {
      await expect(
        cableSale({
          changeGiven: '0',
          payments: [
            { method: 'CASH', amount: '15000', amountTendered: '20000' },
          ],
        }),
      ).rejects.toThrow(/change_given/);
      const ok = await cableSale({
        changeGiven: '5000',
        payments: [
          { method: 'CASH', amount: '15000', amountTendered: '20000' },
        ],
      });
      expect(ok.changeGiven.toFixed(2)).toBe('5000.00');
    });

    it('nothing from a rejected sale is persisted (atomic)', async () => {
      const before = await db.sale.count();
      await expect(
        cableSale({ payments: [{ method: 'CASH', amount: '1' }] }),
      ).rejects.toThrow();
      expect(await db.sale.count()).toBe(before);
    });
  });

  // ------------------------------------------------------------- totals
  describe('sale header CHECKs', () => {
    it.each([
      ['total ≠ subtotal + tax', { total: '15001.00', amountPaid: '15001.00' }],
      ['amount paid ≠ total', { amountPaid: '14000.00' }],
      [
        'discount not zero (S3)',
        { discountTotal: '1.00', total: '14999.00', amountPaid: '14999.00' },
      ],
      ['malformed receipt number', { receiptNumber: 'RCT-1' }],
    ])('rejects %s', async (_label, overrides) => {
      await expect(cableSale(overrides)).rejects.toThrow();
    });
  });

  // ------------------------------------------------- lines and units (BR-02)
  describe('sale lines and serialized units', () => {
    it('a unit can belong to only one sale (BR-02, BR-19) — unique index', async () => {
      const unitId = await newUnit();
      const first = await sale({ unitId });
      await expect(sale({ unitId })).rejects.toThrow(
        /Unique constraint|unique/i,
      );
      // The first sale still owns the unit.
      expect(
        (
          await db.saleItem.findUniqueOrThrow({
            where: { productUnitId: unitId },
          })
        ).saleId,
      ).toBe(first.id);
    });

    it('a relation `connect` cannot steal a sold unit: append-only blocks the detach', async () => {
      const unitId = await newUnit();
      const first = await sale({ unitId });
      await expect(
        db.saleItem.create({
          data: {
            sale: { connect: { id: first.id } },
            lineNumber: 9,
            product: { connect: { id: laptop } },
            productUnit: { connect: { id: unitId } },
            sku: 'L',
            productName: 'L',
            quantity: 1,
            unitPrice: '0',
            lineTotal: '0',
            costAtSale: '0',
          },
        }),
      ).rejects.toThrow(/append-only/);
      expect(
        (
          await db.saleItem.findUniqueOrThrow({
            where: { productUnitId: unitId },
          })
        ).saleId,
      ).toBe(first.id);
    });

    it('serialized lines need their own unit; quantity lines must not have one', async () => {
      const unitId = await newUnit();
      const serializedNoUnit = {
        lineNumber: 1,
        productId: laptop,
        sku: 'L',
        productName: 'L',
        quantity: 1,
        unitPrice: '15000',
        lineTotal: '15000',
        costAtSale: '1',
      };
      await expect(cableSale({ items: [serializedNoUnit] })).rejects.toThrow(
        /must reference a unit/,
      );
      await expect(
        cableSale({ items: [{ ...cableLine(), productUnitId: unitId }] }),
      ).rejects.toThrow(/cannot reference a unit/);
      await expect(
        cableSale(
          {
            items: [
              {
                ...serializedNoUnit,
                productUnitId: unitId,
                quantity: 2,
                lineTotal: '30000',
              },
            ],
          },
          2,
        ),
      ).rejects.toThrow(/sale_items_amounts_chk/);
    });

    it('a line cannot reference a unit of a different product', async () => {
      const otherLaptop = await db.product.create({
        data: {
          sku: 'LAPTOP-2',
          name: 'L2',
          categoryId: (await db.category.findFirstOrThrow()).id,
          brandId: (await db.brand.findFirstOrThrow()).id,
          trackingMode: 'SERIALIZED',
          identifierType: 'SERIAL',
          identifiersPerUnit: 1,
          costPrice: '1',
          sellingPrice: '15000',
        },
      });
      const foreignUnit = await newUnit();
      await expect(
        cableSale({
          items: [
            {
              lineNumber: 1,
              productId: otherLaptop.id,
              productUnitId: foreignUnit,
              sku: 'LAPTOP-2',
              productName: 'L2',
              quantity: 1,
              unitPrice: '15000',
              lineTotal: '15000',
              costAtSale: '1',
            },
          ],
        }),
      ).rejects.toThrow(/different product/);
    });

    it.each([
      ['quantity above 1,000 (S15)', () => [cableLine(1, 1001)]],
      [
        'line total ≠ quantity × price',
        () => [{ ...cableLine(), lineTotal: '1' }],
      ],
    ])('rejects %s', async (_label, items) => {
      await expect(cableSale({ items: items() })).rejects.toThrow(
        /sale_items_amounts_chk/,
      );
    });
  });

  // ------------------------------------------------------------- payments
  describe('payment rules (S4)', () => {
    it.each([
      [
        'mobile money without reference',
        [{ method: 'MOBILE_MONEY' as const, amount: '15000' }],
      ],
      [
        'bank transfer with blank reference',
        [
          {
            method: 'BANK_TRANSFER' as const,
            amount: '15000',
            reference: '  ',
          },
        ],
      ],
      [
        'tendered amount on a card payment',
        [{ method: 'CARD' as const, amount: '15000', amountTendered: '20000' }],
      ],
      [
        'cash tendered below the amount',
        [{ method: 'CASH' as const, amount: '15000', amountTendered: '10000' }],
      ],
      [
        'zero amount',
        [
          { method: 'CASH' as const, amount: '0' },
          { method: 'CASH' as const, amount: '15000' },
        ],
      ],
    ])('rejects %s', async (_label, payments) => {
      await expect(cableSale({ payments })).rejects.toThrow(
        /payments_rules_chk/,
      );
    });

    it('accepts card without reference and references for mobile money / bank transfer', async () => {
      await cableSale({ payments: [{ method: 'CARD', amount: '15000' }] });
      await cableSale(
        {
          payments: [
            { method: 'MOBILE_MONEY', amount: '10000', reference: 'MP1' },
            { method: 'BANK_TRANSFER', amount: '20000', reference: 'BT-9' },
          ],
        },
        2,
      );
    });
  });

  // ---------------------------------------------------------- append-only
  describe('append-only (BR-05, BR-19)', () => {
    it('sales, lines and payments cannot be updated or deleted', async () => {
      const s = await cableSale();
      const item = await db.saleItem.findFirstOrThrow({
        where: { saleId: s.id },
      });
      const pay = await db.payment.findFirstOrThrow({
        where: { saleId: s.id },
      });
      for (const sql of [
        `UPDATE sales SET total = 1 WHERE id='${s.id}'`,
        `DELETE FROM sales WHERE id='${s.id}'`,
        `UPDATE sale_items SET quantity = 2 WHERE id='${item.id}'`,
        `DELETE FROM sale_items WHERE id='${item.id}'`,
        `UPDATE payments SET amount = 1 WHERE id='${pay.id}'`,
        `DELETE FROM payments WHERE id='${pay.id}'`,
      ]) {
        await expect(db.$executeRawUnsafe(sql)).rejects.toThrow(/append-only/);
      }
    });
  });

  // --------------------------------------------------------- tax settings
  describe('tax settings (S1, BR-20)', () => {
    it('one active rate; history immutable except deactivation; 0–100 only', async () => {
      const first = await db.taxSetting.create({
        data: { ratePercent: '18', createdById: adminId },
      });
      await expect(
        db.taxSetting.create({
          data: { ratePercent: '16', createdById: adminId },
        }),
      ).rejects.toThrow(/Unique constraint|unique/i);
      await db.$transaction([
        db.taxSetting.update({
          where: { id: first.id },
          data: { isActive: false },
        }),
        db.taxSetting.create({
          data: { ratePercent: '0', createdById: adminId },
        }), // 0% allowed
      ]);
      await expect(
        db.$executeRawUnsafe(
          `UPDATE tax_settings SET rate_percent = 10 WHERE id='${first.id}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.$executeRawUnsafe(
          `UPDATE tax_settings SET is_active = true WHERE id='${first.id}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.$executeRawUnsafe(`DELETE FROM tax_settings WHERE id='${first.id}'`),
      ).rejects.toThrow(/cannot be deleted/);
      await expect(
        db.taxSetting.create({
          data: {
            ratePercent: '100.01',
            isActive: false,
            createdById: adminId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------ customers
  describe('customers (S6)', () => {
    it('phone normalised format and unique; email lower-case; never deleted', async () => {
      const c = await db.customer.create({
        data: { name: 'Asha', phone: '+255712345678', createdById: cashierId },
      });
      await expect(
        db.customer.create({
          data: { name: 'Dup', phone: '+255712345678', createdById: cashierId },
        }),
      ).rejects.toThrow(/Unique constraint|unique/i);
      await expect(
        db.customer.create({
          data: { name: 'Bad', phone: '0712 345 678', createdById: cashierId },
        }),
      ).rejects.toThrow(/customers_fields_chk/);
      await expect(
        db.customer.create({
          data: { name: 'Bad', email: 'A@B.CO', createdById: cashierId },
        }),
      ).rejects.toThrow(/customers_fields_chk/);
      await expect(
        db.customer.create({ data: { name: '  ', createdById: cashierId } }),
      ).rejects.toThrow(/customers_fields_chk/);
      await db.customer.create({
        data: { name: 'Walk-in style, no phone', createdById: cashierId },
      });
      await expect(
        db.$executeRawUnsafe(`DELETE FROM customers WHERE id='${c.id}'`),
      ).rejects.toThrow(/append-only/);
    });
  });

  // ------------------------------------------------- Module 5 ledger hook
  describe('stock ledger accepts SALE movements (Module 5 change)', () => {
    it('SALE movement type and reference are allowed; ledger stays append-only', async () => {
      const m = await db.stockMovement.create({
        data: {
          productId: cable,
          branchId,
          movementType: 'SALE',
          quantityDelta: -2,
          unitCost: '8000',
          valueDelta: '-16000',
          referenceType: 'SALE',
          referenceId: randomUUID(),
          actorId: cashierId,
        },
      });
      expect(m.movementType).toBe('SALE');
      await expect(
        db.$executeRawUnsafe(
          `UPDATE stock_movements SET quantity_delta = -1 WHERE id='${m.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        db.stockMovement.create({
          data: {
            productId: cable,
            branchId,
            movementType: 'SALE',
            quantityDelta: -1,
            unitCost: '1',
            valueDelta: '-1',
            referenceType: 'INVOICE',
            referenceId: randomUUID(),
            actorId: cashierId,
          },
        }),
      ).rejects.toThrow(/stock_movements_reference_type_chk/);
    });
  });
});
