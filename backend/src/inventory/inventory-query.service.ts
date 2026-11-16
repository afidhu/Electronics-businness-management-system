import { HttpStatus, Injectable } from '@nestjs/common';
import { BranchAccessService } from '../access/branch-access.service';
import { PERMISSIONS } from '../access/permissions';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import { toMoneyString } from '../common/validation/money';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BalanceQueryDto,
  MovementQueryDto,
  ReceiptQueryDto,
  UnitQueryDto,
  ValuationQueryDto,
} from './dto/inventory-query.dto';

const UNIT_INCLUDE = {
  product: { select: { id: true, sku: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  identifiers: {
    select: { type: true, value: true, isPrimary: true },
    orderBy: { isPrimary: 'desc' },
  },
} as const satisfies Prisma.ProductUnitInclude;

type UnitRow = Prisma.ProductUnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

/**
 * Read side of inventory. Every response passes through these mappers:
 * branch scope is enforced and costs are omitted without catalogue:cost_read
 * (FR-INV-12, D4).
 */
@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly config: AppConfigService,
  ) {}

  private canSeeCost(user: AuthenticatedUser) {
    return user.permissions.has(PERMISSIONS.CATALOGUE_COST_READ);
  }

  private scopedBranch(user: AuthenticatedUser, branchId?: string) {
    if (branchId) this.branchAccess.assertCanAccess(user, branchId);
    return branchId ?? this.branchAccess.scopeFilter(user);
  }

  // ------------------------------------------------------------ receipts --

  async getReceipt(id: string, user: AuthenticatedUser) {
    const r = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        purchase: { select: { id: true, reference: true, status: true } },
        branch: { select: { id: true, code: true, name: true } },
        receivedBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { sku: true, name: true, trackingMode: true } },
            units: {
              include: {
                identifiers: {
                  select: { type: true, value: true, isPrimary: true },
                  orderBy: { isPrimary: 'desc' },
                },
              },
            },
          },
        },
      },
    });
    if (!r)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Goods receipt not found',
      );
    this.branchAccess.assertCanAccess(user, r.branchId);
    const cost = this.canSeeCost(user);
    return {
      id: r.id,
      reference: r.reference,
      purchase: r.purchase,
      branch: r.branch,
      receivedBy: r.receivedBy,
      receivedAt: r.receivedAt,
      supplierDeliveryRef: r.supplierDeliveryRef,
      supplierInvoiceRef: r.supplierInvoiceRef,
      notes: r.notes,
      currency: this.config.currency,
      items: r.items.map((i) => ({
        purchaseItemId: i.purchaseItemId,
        productId: i.productId,
        sku: i.product.sku,
        productName: i.product.name,
        trackingMode: i.product.trackingMode,
        quantity: i.quantity,
        ...(cost ? { unitCost: toMoneyString(i.unitCost) } : {}),
        units: i.units.map((u) => ({
          id: u.id,
          status: u.status,
          identifiers: u.identifiers,
        })),
      })),
    };
  }

  async listReceipts(query: ReceiptQueryDto, user: AuthenticatedUser) {
    const where: Prisma.GoodsReceiptWhereInput = {
      branchId: this.scopedBranch(user, query.branchId),
      purchaseId: query.purchaseId,
      receivedAt: { gte: query.from, lt: query.to },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.goodsReceipt.findMany({
        where,
        orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          reference: true,
          receivedAt: true,
          supplierDeliveryRef: true,
          supplierInvoiceRef: true,
          purchase: { select: { id: true, reference: true, status: true } },
          branch: { select: { id: true, code: true } },
          receivedBy: { select: { id: true, fullName: true } },
          _count: { select: { items: true } },
        },
        ...toSkipTake(query),
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map(({ _count, ...r }) => ({ ...r, lineCount: _count.items })),
      total,
      query,
    );
  }

  // ------------------------------------------------------------ balances --

  async balances(query: BalanceQueryDto, user: AuthenticatedUser) {
    if (query.branchId) this.branchAccess.assertCanAccess(user, query.branchId);
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.branchId)
      conds.push(Prisma.sql`b.branch_id = ${query.branchId}::uuid`);
    else if (!user.allBranches)
      conds.push(Prisma.sql`b.branch_id = ANY(${[...user.branchIds]}::uuid[])`);
    if (query.productId)
      conds.push(Prisma.sql`b.product_id = ${query.productId}::uuid`);
    if (query.q) {
      const like = `%${query.q.trim()}%`;
      conds.push(Prisma.sql`(p.sku ILIKE ${like} OR p.name ILIKE ${like})`);
    }
    if (query.lowStock)
      conds.push(Prisma.sql`(b.on_hand - b.reserved) <= p.reorder_level`);
    const where = Prisma.join(conds, ' AND ');
    const { skip, take } = toSkipTake(query);

    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        sku: string;
        name: string;
        tracking_mode: string;
        reorder_level: number;
        branch_id: string;
        branch_code: string;
        on_hand: number;
        reserved: number;
      }[]
    >`SELECT b.product_id, p.sku, p.name, p.tracking_mode::text AS tracking_mode, p.reorder_level,
             b.branch_id, br.code AS branch_code, b.on_hand, b.reserved
      FROM stock_balances b
      JOIN products p ON p.id = b.product_id
      JOIN branches br ON br.id = b.branch_id
      WHERE ${where}
      ORDER BY br.code, p.sku
      LIMIT ${take} OFFSET ${skip}`;
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE ${where}`;

    return new PaginatedResult(
      rows.map((r) => {
        const available = r.on_hand - r.reserved;
        return {
          product: {
            id: r.product_id,
            sku: r.sku,
            name: r.name,
            trackingMode: r.tracking_mode,
          },
          branch: { id: r.branch_id, code: r.branch_code },
          onHand: r.on_hand,
          reserved: r.reserved,
          available,
          inTransit: 0, // transfers are stage 5.2 (deferred)
          reorderLevel: r.reorder_level,
          lowStock: available <= r.reorder_level,
        };
      }),
      n,
      query,
    );
  }

  // ----------------------------------------------------------- movements --

  async movements(query: MovementQueryDto, user: AuthenticatedUser) {
    const where: Prisma.StockMovementWhereInput = {
      branchId: this.scopedBranch(user, query.branchId),
      productId: query.productId,
      movementType: query.type,
      referenceId: query.referenceId,
      createdAt: { gte: query.from, lt: query.to },
    };
    const cost = this.canSeeCost(user);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          product: { select: { sku: true } },
          branch: { select: { code: true } },
          actor: { select: { id: true, fullName: true } },
        },
        ...toSkipTake(query),
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        movementType: m.movementType,
        productId: m.productId,
        sku: m.product.sku,
        branchId: m.branchId,
        branchCode: m.branch.code,
        quantityDelta: m.quantityDelta,
        ...(cost
          ? {
              unitCost: toMoneyString(m.unitCost),
              valueDelta: toMoneyString(m.valueDelta),
            }
          : {}),
        productUnitId: m.productUnitId,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        actor: m.actor,
      })),
      total,
      query,
    );
  }

  // --------------------------------------------------------------- units --

  private unitResponse(u: UnitRow, user: AuthenticatedUser) {
    return {
      id: u.id,
      status: u.status,
      product: u.product,
      branch: u.branch,
      identifiers: u.identifiers,
      ...(this.canSeeCost(user) ? { unitCost: toMoneyString(u.unitCost) } : {}),
      goodsReceiptItemId: u.goodsReceiptItemId,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  async units(query: UnitQueryDto, user: AuthenticatedUser) {
    const where: Prisma.ProductUnitWhereInput = {
      branchId: this.scopedBranch(user, query.branchId),
      productId: query.productId,
      status: query.status,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productUnit.findMany({
        where,
        include: UNIT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.productUnit.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map((u) => this.unitResponse(u, user)),
      total,
      query,
    );
  }

  async unit(id: string, user: AuthenticatedUser) {
    const u = await this.prisma.productUnit.findUnique({
      where: { id },
      include: UNIT_INCLUDE,
    });
    if (!u)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Unit not found',
      );
    this.branchAccess.assertCanAccess(user, u.branchId);
    const movements = await this.prisma.stockMovement.findMany({
      where: { productUnitId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        movementType: true,
        quantityDelta: true,
        branchId: true,
        referenceType: true,
        referenceId: true,
      },
    });
    return { ...this.unitResponse(u, user), movements };
  }

  /**
   * Identifier lookup. In scope: full unit. Outside scope: only that it exists
   * elsewhere (I15) — no branch, product or status details leak.
   */
  async lookup(raw: string, user: AuthenticatedUser) {
    const candidates = [
      ...new Set([raw.replace(/[\s-]/g, ''), raw.trim().toUpperCase()]),
    ];
    const ident = await this.prisma.unitIdentifier.findFirst({
      where: { value: { in: candidates } },
      select: { productUnit: { include: UNIT_INCLUDE } },
    });
    if (!ident) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'No unit with this identifier',
      );
    }
    const u = ident.productUnit;
    if (!this.branchAccess.canAccess(user, u.branchId)) {
      return { exists: true, inYourBranches: false };
    }
    return {
      exists: true,
      inYourBranches: true,
      unit: this.unitResponse(u, user),
    };
  }

  // ----------------------------------------------------------- valuation --

  /** WAC valuation per branch and product (ADR-029); in-transit separate (I18). */
  async valuation(query: ValuationQueryDto, user: AuthenticatedUser) {
    if (query.branchId) this.branchAccess.assertCanAccess(user, query.branchId);
    const scope = query.branchId
      ? Prisma.sql`b.branch_id = ${query.branchId}::uuid`
      : user.allBranches
        ? Prisma.sql`TRUE`
        : Prisma.sql`b.branch_id = ANY(${[...user.branchIds]}::uuid[])`;
    const rows = await this.prisma.$queryRaw<
      {
        branch_id: string;
        branch_code: string;
        product_id: string;
        sku: string;
        on_hand: number;
        average_cost: Prisma.Decimal;
      }[]
    >`SELECT b.branch_id, br.code AS branch_code, b.product_id, p.sku, b.on_hand,
             COALESCE(v.average_cost, 0) AS average_cost
      FROM stock_balances b
      JOIN branches br ON br.id = b.branch_id
      JOIN products p ON p.id = b.product_id
      LEFT JOIN inventory_valuations v ON v.product_id = b.product_id
      WHERE ${scope} AND b.on_hand > 0
      ORDER BY br.code, p.sku`;

    let total = new Prisma.Decimal(0);
    const lines = rows.map((r) => {
      const avg = new Prisma.Decimal(r.average_cost);
      const value = avg
        .times(r.on_hand)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      total = total.plus(value);
      return {
        branch: { id: r.branch_id, code: r.branch_code },
        product: { id: r.product_id, sku: r.sku },
        onHand: r.on_hand,
        averageCost: avg.toFixed(4),
        value: toMoneyString(value),
      };
    });
    return {
      method: 'MOVING_WEIGHTED_AVERAGE_ORGANISATION_WIDE',
      currency: this.config.currency,
      lines,
      totals: {
        onHandValue: toMoneyString(total),
        inTransitValue: '0.00',
        totalValue: toMoneyString(total),
      },
    };
  }
}
