import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BranchAccessService } from '../access/branch-access.service';
import { PERMISSIONS } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import {
  businessDate,
  businessDateTime,
  businessDayRangeUtc,
} from '../common/time/business-time';
import { toMoneyString } from '../common/validation/money';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { requestHash } from '../inventory/inventory-rules';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSequenceService } from '../procurement/document-sequence.service';
import { TaxSettingsService } from '../settings/tax-settings.service';
import {
  CheckoutDto,
  SalesQueryDto,
  SalesSummaryQueryDto,
} from './dto/sales.dto';
import { PosService, type ResolvedLine } from './pos.service';
import {
  formatReceiptNumber,
  ledgerUnitCost,
  PAYMENT_METHODS,
  priceCart,
  settlePayments,
} from './pricing';

type Tx = Prisma.TransactionClient;

const SALE_DETAIL = {
  include: {
    branch: {
      select: { id: true, code: true, name: true, address: true, phone: true },
    },
    cashier: { select: { id: true, fullName: true } },
    customer: { select: { id: true, name: true, phone: true } },
    items: {
      orderBy: { lineNumber: 'asc' },
      include: {
        productUnit: {
          select: {
            id: true,
            identifiers: {
              select: { type: true, value: true, isPrimary: true },
              orderBy: { isPrimary: 'desc' },
            },
          },
        },
      },
    },
    payments: { orderBy: { createdAt: 'asc' } },
  },
} as const satisfies Prisma.SaleDefaultArgs;

type SaleDetailRow = Prisma.SaleGetPayload<typeof SALE_DETAIL>;

/**
 * Checkout (FR-SALE-02..07, FR-SALE-10/11, ADR-031) and sales reads
 * (FR-SALE-09, S8, S17). One transaction per sale. Lock order:
 * idempotency key → products (sorted) → tax rate → valuations (sorted) →
 * balances (sorted) → units (sorted), compatible with receiving.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pos: PosService,
    private readonly tax: TaxSettingsService,
    private readonly ledger: StockLedgerService,
    private readonly sequences: DocumentSequenceService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------ checkout --

  async checkout(
    dto: CheckoutDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<{
    replayed: boolean;
    sale: ReturnType<SalesService['toDetail']>;
  }> {
    const { idempotencyKey, ...body } = dto;
    const hash = requestHash('sale', body);

    const replay = await this.findReplay(
      this.prisma,
      idempotencyKey,
      hash,
      actor.id,
    );
    if (replay)
      return { replayed: true, sale: await this.getSale(replay, actor) };

    let outcome: { replayed: boolean; saleId: string };
    try {
      outcome = await this.prisma.$transaction(
        (tx) => this.checkoutInTx(tx, dto, hash, actor, context),
        { timeout: 20_000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Defensive: the advisory lock serialises equal keys, and conditional
        // updates guard units; a unique violation still means "lost a race".
        const winner = await this.findReplay(
          this.prisma,
          idempotencyKey,
          hash,
          actor.id,
        );
        if (winner)
          return { replayed: true, sale: await this.getSale(winner, actor) };
        throw unitNotAvailable();
      }
      throw e;
    }
    return {
      replayed: outcome.replayed,
      sale: await this.getSale(outcome.saleId, actor),
    };
  }

  private async checkoutInTx(
    tx: Tx,
    dto: CheckoutDto,
    hash: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<{ replayed: boolean; saleId: string }> {
    // 1. Idempotency key first: concurrent retries of one sale serialise here.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.idempotencyKey}, 0))`;
    const earlier = await this.findReplay(
      tx,
      dto.idempotencyKey,
      hash,
      actor.id,
    );
    if (earlier) return { replayed: true, saleId: earlier };

    // 2. Branch (in scope, active) and optional customer.
    const branch = await this.pos.resolveBranch(actor, dto.branchId, tx);
    if (dto.customerId) await this.assertCustomer(tx, dto.customerId);

    // 3. Products FOR SHARE (sorted): price and active flag cannot change mid-sale (S20).
    const productIds = [...new Set(dto.items.map((i) => i.productId))].sort();
    await tx.$queryRaw`
      SELECT "id" FROM "products" WHERE "id" = ANY(${productIds}::uuid[])
      ORDER BY "id" FOR SHARE`;

    // 4. VAT rate FOR SHARE (a concurrent rate change waits for this sale).
    await tx.$queryRaw`SELECT "id" FROM "tax_settings" WHERE "is_active" FOR SHARE`;
    const rate = await this.tax.requireActive(tx);

    // 5. Cart: active products, units IN_STOCK at this branch, line rules.
    const lines = await this.pos.resolveCart(tx, branch.id, dto.items);

    // 6. Server-side totals (S2) and payment rules (S4).
    const totals = priceCart(
      lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.product.sellingPrice,
      })),
      rate.ratePercent,
    );
    if (!totals) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'items',
            messages: ['sale total exceeds the maximum amount'],
          },
        ],
      );
    }
    const settled = settlePayments(totals.total, dto.payments);
    if (!settled.ok) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        settled.mismatch
          ? ErrorCode.PAYMENT_MISMATCH
          : ErrorCode.VALIDATION_ERROR,
        settled.mismatch
          ? 'Payments must equal the sale total'
          : 'Validation failed',
        [{ field: settled.field, messages: [settled.message] }],
      );
    }

    // 7. Valuations (sorted) → WAC for costAtSale (S11).
    await this.ledger.lockValuations(tx, productIds);
    const valuations = await tx.inventoryValuation.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, averageCost: true },
    });
    const wac = new Map(valuations.map((v) => [v.productId, v.averageCost]));

    // 8. Balances (sorted): conditional decrements — no overselling (BR-04).
    const saleId = randomUUID();
    const byProduct = new Map<
      string,
      { quantity: number; units: string[]; sku: string }
    >();
    for (const l of lines) {
      const agg = byProduct.get(l.product.id) ?? {
        quantity: 0,
        units: [],
        sku: l.product.sku,
      };
      agg.quantity += l.quantity;
      if (l.unit) agg.units.push(l.unit.id);
      byProduct.set(l.product.id, agg);
    }
    const short: { field: string; messages: string[] }[] = [];
    for (const productId of productIds) {
      const agg = byProduct.get(productId)!;
      const ok = await this.ledger.decrease(tx, {
        productId,
        branchId: branch.id,
        quantity: agg.quantity,
        unitCost: ledgerUnitCost(wac.get(productId) ?? new Prisma.Decimal(0)),
        movementType: 'SALE',
        productUnitIds: agg.units.length > 0 ? agg.units.sort() : undefined,
        referenceType: 'SALE',
        referenceId: saleId,
        actorId: actor.id,
      });
      if (!ok) {
        if (agg.units.length > 0) throw unitNotAvailable();
        const line = lines.find((l) => l.product.id === productId)!;
        short.push({
          field: `items.${line.lineNumber - 1}.quantity`,
          messages: [`not enough ${agg.sku} available at this branch`],
        });
      }
    }
    if (short.length) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_STOCK,
        'Not enough available stock',
        short,
      );
    }

    // 9. Units (sorted): IN_STOCK → SOLD only if still here and in stock (BR-02).
    const unitIds = lines.flatMap((l) => (l.unit ? [l.unit.id] : [])).sort();
    for (const unitId of unitIds) {
      const n = await tx.$executeRaw`
        UPDATE "product_units" SET "status" = 'SOLD', "updated_at" = now()
        WHERE "id" = ${unitId}::uuid AND "branch_id" = ${branch.id}::uuid AND "status" = 'IN_STOCK'`;
      if (n !== 1) throw unitNotAvailable();
    }

    // 10. Sale, lines (snapshots, scalar unit FK), payments. Deferred DB
    //     triggers re-check line and payment sums at COMMIT.
    const year = businessDate(new Date(), this.config.businessTimeZone).slice(
      0,
      4,
    );
    const seq = await this.sequences.next(tx, `RCT:${branch.code}:${year}`);
    const receiptNumber = formatReceiptNumber(branch.code, year, seq);
    await tx.sale.create({
      data: {
        id: saleId,
        receiptNumber,
        branchId: branch.id,
        cashierId: actor.id,
        customerId: dto.customerId ?? null,
        currency: this.config.currency,
        subtotal: totals.subtotal,
        taxRatePercent: totals.taxRatePercent,
        taxAmount: totals.taxAmount,
        total: totals.total,
        amountPaid: totals.total,
        changeGiven: settled.changeGiven,
        idempotencyKey: dto.idempotencyKey,
        requestHash: hash,
        items: {
          createMany: {
            data: lines.map((l: ResolvedLine, i) => ({
              lineNumber: l.lineNumber,
              productId: l.product.id,
              sku: l.product.sku,
              productName: l.product.name,
              productUnitId: l.unit?.id ?? null,
              quantity: l.quantity,
              unitPrice: l.product.sellingPrice,
              lineTotal: totals.lines[i].lineTotal,
              costAtSale: wac.get(l.product.id) ?? new Prisma.Decimal(0),
            })),
          },
        },
        payments: {
          createMany: {
            data: settled.payments.map((p) => ({
              method: p.method,
              amount: p.amount,
              amountTendered: p.amountTendered,
              reference: p.reference,
            })),
          },
        },
      },
      select: { id: true },
    });

    // 11. Audit in the same transaction (no payment references or card data).
    await this.audit.record(
      {
        action: 'sale.completed',
        entityType: 'Sale',
        entityId: saleId,
        branchId: branch.id,
        actorId: actor.id,
        metadata: {
          receiptNumber,
          total: toMoneyString(totals.total),
          taxRatePercent: totals.taxRatePercent.toFixed(2),
          paymentMethods: [...new Set(settled.payments.map((p) => p.method))],
          lineCount: lines.length,
          unitCount: lines.reduce((n, l) => n + l.quantity, 0),
          customerId: dto.customerId ?? null,
        },
        context,
      },
      tx,
    );
    return { replayed: false, saleId };
  }

  /** S16: same key + same body + same cashier → original sale; otherwise 409. */
  private async findReplay(
    db: PrismaService | Tx,
    key: string,
    hash: string,
    actorId: string,
  ): Promise<string | null> {
    const existing = await db.sale.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, requestHash: true, cashierId: true },
    });
    if (!existing) return null;
    if (existing.requestHash === hash && existing.cashierId === actorId)
      return existing.id;
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      'This idempotency key was already used for a different request',
    );
  }

  private async assertCustomer(tx: Tx, customerId: string) {
    const c = await tx.customer.findUnique({
      where: { id: customerId },
      select: { isActive: true },
    });
    if (!c) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [{ field: 'customerId', messages: ['customer not found'] }],
      );
    }
    if (!c.isActive) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERENCE_INACTIVE,
        'The customer is inactive',
        [{ field: 'customerId', messages: ['customer is inactive'] }],
      );
    }
  }

  // --------------------------------------------------------------- reads --

  async getSale(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.sale.findUnique({
      where: { id },
      ...SALE_DETAIL,
    });
    if (!row)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Sale not found',
      );
    this.branchAccess.assertCanAccess(user, row.branchId);
    return this.toDetail(row, user);
  }

  /** Receipt data for printing (S12): never costs, whoever prints it. */
  async getReceipt(id: string, user: AuthenticatedUser) {
    const sale = await this.getSale(id, user);
    return {
      ...sale,
      lines: sale.lines.map(({ costAtSale: _cost, ...l }) => l),
    };
  }

  private toDetail(s: SaleDetailRow, user: AuthenticatedUser) {
    const cost = user.permissions.has(PERMISSIONS.CATALOGUE_COST_READ);
    const customers = user.permissions.has(PERMISSIONS.CUSTOMERS_READ);
    const tz = this.config.businessTimeZone;
    return {
      id: s.id,
      receiptNumber: s.receiptNumber,
      status: s.status,
      businessName: this.config.businessName,
      branch: s.branch,
      cashier: s.cashier,
      customer: s.customer
        ? customers
          ? s.customer
          : { id: s.customer.id, name: s.customer.name }
        : null,
      completedAt: s.completedAt.toISOString(),
      businessDate: businessDate(s.completedAt, tz),
      businessDateTime: businessDateTime(s.completedAt, tz),
      timeZone: tz,
      currency: s.currency,
      priceIncludesTax: false,
      lines: s.items.map((i) => ({
        lineNumber: i.lineNumber,
        productId: i.productId,
        sku: i.sku,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: toMoneyString(i.unitPrice),
        lineTotal: toMoneyString(i.lineTotal),
        unit: i.productUnit,
        ...(cost ? { costAtSale: i.costAtSale.toFixed(4) } : {}),
      })),
      subtotal: toMoneyString(s.subtotal),
      discountTotal: toMoneyString(s.discountTotal),
      taxRatePercent: s.taxRatePercent.toFixed(2),
      taxAmount: toMoneyString(s.taxAmount),
      total: toMoneyString(s.total),
      payments: s.payments.map((p) => ({
        method: p.method,
        amount: toMoneyString(p.amount),
        amountTendered: p.amountTendered
          ? toMoneyString(p.amountTendered)
          : null,
        reference: p.reference,
      })),
      amountPaid: toMoneyString(s.amountPaid),
      changeGiven: toMoneyString(s.changeGiven),
    };
  }

  async list(query: SalesQueryDto, user: AuthenticatedUser) {
    if (query.branchId) this.branchAccess.assertCanAccess(user, query.branchId);
    const tz = this.config.businessTimeZone;
    if (query.from && query.to && query.from > query.to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [{ field: 'to', messages: ['to must not be before from'] }],
      );
    }
    const completedAt: Prisma.DateTimeFilter = {};
    if (query.from) completedAt.gte = businessDayRangeUtc(query.from, tz).start;
    if (query.to) completedAt.lt = businessDayRangeUtc(query.to, tz).end;
    const where: Prisma.SaleWhereInput = {
      branchId: query.branchId ?? this.branchAccess.scopeFilter(user),
      ...(query.from || query.to ? { completedAt } : {}),
      ...(query.cashierId ? { cashierId: query.cashierId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.receiptNumber
        ? { receiptNumber: query.receiptNumber.trim().toUpperCase() }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
        select: {
          id: true,
          receiptNumber: true,
          completedAt: true,
          total: true,
          branch: { select: { id: true, code: true } },
          cashier: { select: { id: true, fullName: true } },
          customer: { select: { id: true, name: true } },
          payments: { select: { method: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map((s) => ({
        id: s.id,
        receiptNumber: s.receiptNumber,
        completedAt: s.completedAt.toISOString(),
        businessDateTime: businessDateTime(s.completedAt, tz),
        branch: s.branch,
        cashier: s.cashier,
        customer: s.customer,
        lineCount: s._count.items,
        total: toMoneyString(s.total),
        paymentMethods: [...new Set(s.payments.map((p) => p.method))],
      })),
      total,
      query,
    );
  }

  /** Daily summary (S17, FR-RPT-02): one business day, one or all branches in scope. */
  async summary(query: SalesSummaryQueryDto, user: AuthenticatedUser) {
    const tz = this.config.businessTimeZone;
    const date = query.date ?? businessDate(new Date(), tz);
    if (query.branchId) this.branchAccess.assertCanAccess(user, query.branchId);
    const branches = await this.prisma.branch.findMany({
      where: query.branchId
        ? { id: query.branchId }
        : user.allBranches
          ? {}
          : { id: { in: [...user.branchIds] } },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    if (query.branchId && branches.length === 0) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Branch not found',
      );
    }
    const ids = branches.map((b) => b.id);
    const { start, end } = businessDayRangeUtc(date, tz);
    const saleWhere: Prisma.SaleWhereInput = {
      branchId: { in: ids },
      completedAt: { gte: start, lt: end },
    };

    const [agg, byMethod, byCashier, [items]] = await Promise.all([
      this.prisma.sale.aggregate({
        where: saleWhere,
        _count: { _all: true },
        _sum: {
          subtotal: true,
          taxAmount: true,
          total: true,
          changeGiven: true,
        },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { sale: saleWhere },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.sale.groupBy({
        by: ['cashierId'],
        where: saleWhere,
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.$queryRaw<{ units: number; cost: Prisma.Decimal | null }[]>`
        SELECT COALESCE(SUM(i.quantity), 0)::int AS units,
               SUM(i.quantity * i.cost_at_sale) AS cost
        FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.branch_id = ANY(${ids}::uuid[])
          AND s.completed_at >= ${start} AND s.completed_at < ${end}`,
    ]);
    const cashiers = await this.prisma.user.findMany({
      where: { id: { in: byCashier.map((c) => c.cashierId) } },
      select: { id: true, fullName: true },
    });
    const name = new Map(cashiers.map((c) => [c.id, c.fullName]));
    const money = (v: Prisma.Decimal | null | undefined) =>
      toMoneyString(v ?? new Prisma.Decimal(0));
    const subtotal = agg._sum.subtotal ?? new Prisma.Decimal(0);
    const cost = items.cost ?? new Prisma.Decimal(0);

    return {
      date,
      timeZone: tz,
      currency: this.config.currency,
      branches,
      saleCount: agg._count._all,
      unitsSold: items.units,
      subtotal: money(agg._sum.subtotal),
      taxAmount: money(agg._sum.taxAmount),
      total: money(agg._sum.total),
      byPaymentMethod: PAYMENT_METHODS.map((m) => {
        const r = byMethod.find((x) => x.method === m);
        return {
          method: m,
          count: r?._count._all ?? 0,
          amount: money(r?._sum.amount),
        };
      }),
      byCashier: byCashier
        .map((c) => ({
          cashier: { id: c.cashierId, fullName: name.get(c.cashierId) ?? null },
          saleCount: c._count._all,
          total: money(c._sum.total),
        }))
        .sort(
          (a, b) =>
            b.saleCount - a.saleCount || (a.cashier.id < b.cashier.id ? -1 : 1),
        ),
      ...(user.permissions.has(PERMISSIONS.CATALOGUE_COST_READ)
        ? {
            costOfGoodsSold: cost
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              .toFixed(2),
            grossProfit: subtotal
              .minus(cost)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              .toFixed(2),
          }
        : {}),
    };
  }
}

function unitNotAvailable(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.UNIT_NOT_AVAILABLE,
    'This unit is not available for sale at this branch',
  );
}
