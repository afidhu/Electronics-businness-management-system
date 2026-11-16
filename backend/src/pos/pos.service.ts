import { HttpStatus, Injectable } from '@nestjs/common';
import { BranchAccessService } from '../access/branch-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AppException,
  type FieldErrorDetail,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import { toMoneyString } from '../common/validation/money';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaxSettingsService } from '../settings/tax-settings.service';
import {
  PosCatalogueQueryDto,
  PosUnitsQueryDto,
  QuoteDto,
  QuoteItemDto,
} from './dto/pos.dto';
import { priceCart } from './pricing';

type Db = PrismaService | Prisma.TransactionClient;

const IDENTIFIERS = {
  select: { type: true, value: true, isPrimary: true },
  orderBy: { isPrimary: 'desc' },
} as const;

export interface SellingBranch {
  id: string;
  code: string;
}

/** A validated cart line with server-side data (reused by checkout, 6.4). */
export interface ResolvedLine {
  lineNumber: number;
  product: {
    id: string;
    sku: string;
    name: string;
    trackingMode: 'SERIALIZED' | 'QUANTITY';
    sellingPrice: Prisma.Decimal;
  };
  quantity: number;
  unit: {
    id: string;
    identifiers: { type: string; value: string; isPrimary: boolean }[];
  } | null;
}

/** Candidate normalised forms of a scanned IMEI/serial (as inventory lookup). */
export function identifierCandidates(raw: string): string[] {
  return [...new Set([raw.replace(/[\s-]/g, ''), raw.trim().toUpperCase()])];
}

/**
 * POS read side and pricing (FR-SALE-01, FR-SALE-03, FR-SALE-05, S9, S10,
 * S14, S20). Never returns costs. Prices always come from the database.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly tax: TaxSettingsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The selling branch: explicit and in scope, or the single assigned branch
   * of a branch-scoped user. SYSTEM_ADMIN must always choose (S10). Must be active (S9).
   */
  async resolveBranch(
    user: AuthenticatedUser,
    branchId: string | undefined,
    db: Db = this.prisma,
  ): Promise<SellingBranch> {
    let id = branchId;
    if (!id) {
      if (!user.allBranches && user.branchIds.length === 1)
        id = user.branchIds[0];
      else {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          'Validation failed',
          [
            {
              field: 'branchId',
              messages: ['branchId is required: choose the selling branch'],
            },
          ],
        );
      }
    }
    this.branchAccess.assertCanAccess(user, id);
    const branch = await db.branch.findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true },
    });
    if (!branch)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Branch not found',
      );
    if (!branch.isActive) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERENCE_INACTIVE,
        'Sales are not allowed at an inactive branch',
        [{ field: 'branchId', messages: ['branch is inactive'] }],
      );
    }
    return { id: branch.id, code: branch.code };
  }

  // ---------------------------------------------------------- catalogue --

  async catalogue(query: PosCatalogueQueryDto, user: AuthenticatedUser) {
    const branch = await this.resolveBranch(user, query.branchId);
    const conds: Prisma.Sql[] = [Prisma.sql`p.is_active`];
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      conds.push(
        Prisma.sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like} OR b.name ILIKE ${like})`,
      );
    }
    if (query.inStockOnly)
      conds.push(Prisma.sql`COALESCE(sb.on_hand - sb.reserved, 0) > 0`);
    const where = Prisma.join(conds, ' AND ');
    const { skip, take } = toSkipTake(query);
    const from = Prisma.sql`
      FROM products p
      JOIN brands b ON b.id = p.brand_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.branch_id = ${branch.id}::uuid`;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        sku: string;
        name: string;
        tracking_mode: string;
        identifier_type: string | null;
        identifiers_per_unit: number | null;
        selling_price: Prisma.Decimal;
        brand: string;
        category: string;
        available: number;
      }[]
    >`SELECT p.id, p.sku, p.name, p.tracking_mode::text AS tracking_mode, p.identifier_type::text AS identifier_type,
             p.identifiers_per_unit, p.selling_price, b.name AS brand, c.name AS category,
             COALESCE(sb.on_hand - sb.reserved, 0)::int AS available
      ${from} WHERE ${where}
      ORDER BY p.name, p.id LIMIT ${take} OFFSET ${skip}`;
    const [{ n }] = await this.prisma.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n ${from} WHERE ${where}`;
    return new PaginatedResult(
      rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        brand: r.brand,
        category: r.category,
        trackingMode: r.tracking_mode,
        identifierType: r.identifier_type,
        identifiersPerUnit: r.identifiers_per_unit,
        sellingPrice: toMoneyString(r.selling_price),
        currency: this.config.currency,
        priceIncludesTax: false,
        available: r.available,
        inStock: r.available > 0,
        branch,
      })),
      n,
      query,
    );
  }

  // --------------------------------------------------------------- units --

  /** Available (IN_STOCK, this branch) units of a serialized product, or one scanned unit. */
  async units(query: PosUnitsQueryDto, user: AuthenticatedUser) {
    const branch = await this.resolveBranch(user, query.branchId);
    if (query.identifier) {
      const unit = await this.findAvailableUnitByIdentifier(
        this.prisma,
        branch.id,
        query.identifier,
      );
      return new PaginatedResult([unit], 1, { page: 1, limit: 1 });
    }
    if (!query.productId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'productId',
            messages: ['productId or identifier is required'],
          },
        ],
      );
    }
    const product = await this.sellableProduct(
      this.prisma,
      query.productId,
      'productId',
    );
    if (product.trackingMode !== 'SERIALIZED') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'productId',
            messages: [
              `${product.sku} is quantity-tracked; it has no individual units`,
            ],
          },
        ],
      );
    }
    const where: Prisma.ProductUnitWhereInput = {
      productId: product.id,
      branchId: branch.id,
      status: 'IN_STOCK',
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productUnit.findMany({
        where,
        select: { id: true, identifiers: IDENTIFIERS },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.productUnit.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map((u) => ({
        id: u.id,
        productId: product.id,
        sku: product.sku,
        identifiers: u.identifiers,
      })),
      total,
      query,
    );
  }

  // --------------------------------------------------------------- quote --

  /** Server-priced preview (S14). No side effects; checkout re-prices. */
  async quote(dto: QuoteDto, user: AuthenticatedUser) {
    const branch = await this.resolveBranch(user, dto.branchId);
    const rate = await this.tax.requireActive();
    const lines = await this.resolveCart(this.prisma, branch.id, dto.items);
    await this.assertQuantitiesAvailable(this.prisma, branch.id, lines);
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
    return {
      branch,
      currency: this.config.currency,
      priceIncludesTax: false,
      taxRatePercent: totals.taxRatePercent.toFixed(2),
      lines: lines.map((l, i) => ({
        lineNumber: l.lineNumber,
        productId: l.product.id,
        sku: l.product.sku,
        name: l.product.name,
        trackingMode: l.product.trackingMode,
        quantity: l.quantity,
        unitPrice: toMoneyString(l.product.sellingPrice),
        lineTotal: toMoneyString(totals.lines[i].lineTotal),
        unit: l.unit,
      })),
      subtotal: toMoneyString(totals.subtotal),
      taxAmount: toMoneyString(totals.taxAmount),
      total: toMoneyString(totals.total),
      notice:
        'Preview only: checkout re-validates stock and re-prices on the server.',
    };
  }

  // ---------------------------------------------------- cart resolution --

  /**
   * Validate a cart against the database: active products (S9), serialized
   * lines carry exactly one available unit at the branch (FR-SALE-05),
   * quantity lines carry none, no unit or quantity product twice.
   * Shared with checkout (6.4), which calls it inside its transaction.
   */
  async resolveCart(
    db: Db,
    branchId: string,
    items: readonly QuoteItemDto[],
  ): Promise<ResolvedLine[]> {
    const problems: FieldErrorDetail[] = [];
    const seenUnits = new Set<string>();
    const seenQtyProducts = new Set<string>();
    const lines: ResolvedLine[] = [];

    for (const [i, item] of items.entries()) {
      const f = `items.${i}`;
      const product = await this.sellableProduct(
        db,
        item.productId,
        `${f}.productId`,
      );
      if (product.trackingMode === 'SERIALIZED') {
        if (item.quantity !== undefined && item.quantity !== 1) {
          problems.push({
            field: `${f}.quantity`,
            messages: ['serialized items are sold one unit per line'],
          });
          continue;
        }
        if (!item.unitId && !item.identifier) {
          problems.push({
            field: `${f}.unitId`,
            messages: [`choose the ${product.sku} unit (unitId or identifier)`],
          });
          continue;
        }
        const unit = item.unitId
          ? await this.findAvailableUnitById(db, branchId, item.unitId)
          : await this.findAvailableUnitByIdentifier(
              db,
              branchId,
              item.identifier!,
            );
        if (unit.productId !== product.id) {
          problems.push({
            field: `${f}.unitId`,
            messages: ['the chosen unit belongs to a different product'],
          });
          continue;
        }
        if (seenUnits.has(unit.id)) {
          problems.push({
            field: `${f}.unitId`,
            messages: ['the same unit is in the cart twice'],
          });
          continue;
        }
        seenUnits.add(unit.id);
        lines.push({
          lineNumber: i + 1,
          product,
          quantity: 1,
          unit: { id: unit.id, identifiers: unit.identifiers },
        });
      } else {
        if (item.unitId || item.identifier) {
          problems.push({
            field: `${f}.unitId`,
            messages: [
              `${product.sku} is quantity-tracked; do not send a unit`,
            ],
          });
          continue;
        }
        if (seenQtyProducts.has(product.id)) {
          throw new AppException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.DUPLICATE_PRODUCT_LINE,
            'Combine quantities of the same product into one line',
            [
              {
                field: `${f}.productId`,
                messages: ['product appears on more than one line'],
              },
            ],
          );
        }
        seenQtyProducts.add(product.id);
        lines.push({
          lineNumber: i + 1,
          product,
          quantity: item.quantity ?? 1,
          unit: null,
        });
      }
    }
    if (problems.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        problems,
      );
    }
    return lines;
  }

  /** Read-only availability check for quantity lines (checkout uses conditional updates). */
  async assertQuantitiesAvailable(
    db: Db,
    branchId: string,
    lines: readonly ResolvedLine[],
  ) {
    const short: FieldErrorDetail[] = [];
    for (const l of lines) {
      if (l.unit) continue;
      const bal = await db.stockBalance.findUnique({
        where: { productId_branchId: { productId: l.product.id, branchId } },
        select: { onHand: true, reserved: true },
      });
      const available = bal ? bal.onHand - bal.reserved : 0;
      if (l.quantity > available) {
        short.push({
          field: `items.${l.lineNumber - 1}.quantity`,
          messages: [
            `only ${available} ${l.product.sku} available at this branch`,
          ],
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
  }

  private async sellableProduct(
    db: Db,
    productId: string,
    field: string,
  ): Promise<ResolvedLine['product']> {
    const p = await db.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        sku: true,
        name: true,
        trackingMode: true,
        sellingPrice: true,
        isActive: true,
      },
    });
    if (!p || !p.isActive) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.PRODUCT_NOT_SELLABLE,
        'Product cannot be sold',
        [
          {
            field,
            messages: [p ? `${p.sku} is inactive` : 'product not found'],
          },
        ],
      );
    }
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      trackingMode: p.trackingMode,
      sellingPrice: p.sellingPrice,
    };
  }

  /**
   * Units must be IN_STOCK at the selling branch. The message never says
   * where else a unit is (I15) — only that it is not available here.
   */
  private async findAvailableUnitById(
    db: Db,
    branchId: string,
    unitId: string,
  ) {
    const u = await db.productUnit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        productId: true,
        branchId: true,
        status: true,
        identifiers: IDENTIFIERS,
      },
    });
    if (!u || u.branchId !== branchId || u.status !== 'IN_STOCK')
      throw unitNotAvailable();
    return { id: u.id, productId: u.productId, identifiers: u.identifiers };
  }

  private async findAvailableUnitByIdentifier(
    db: Db,
    branchId: string,
    raw: string,
  ) {
    const ident = await db.unitIdentifier.findFirst({
      where: { value: { in: identifierCandidates(raw) } },
      select: { productUnitId: true },
    });
    if (!ident) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'No unit with this identifier',
      );
    }
    const u = await this.findAvailableUnitById(
      db,
      branchId,
      ident.productUnitId,
    );
    const product = await db.product.findUniqueOrThrow({
      where: { id: u.productId },
      select: { sku: true, isActive: true },
    });
    if (!product.isActive) throw unitNotAvailable();
    return { ...u, sku: product.sku };
  }
}

function unitNotAvailable(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.UNIT_NOT_AVAILABLE,
    'This unit is not available for sale at this branch',
  );
}
