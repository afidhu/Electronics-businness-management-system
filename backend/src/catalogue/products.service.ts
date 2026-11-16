import { HttpStatus, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { permissionDenied } from '../auth/guards/permissions.guard';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { toMoneyString } from '../common/validation/money';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMMUTABLE_PRODUCT_FIELDS,
  normaliseSku,
  normaliseSpecifications,
  PRICE_FIELDS,
} from './catalogue-rules';
import { changedFields } from './change-set';
import {
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from './dto/product.dto';

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  description: true,
  trackingMode: true,
  identifierType: true,
  identifiersPerUnit: true,
  costPrice: true,
  sellingPrice: true,
  reorderLevel: true,
  specifications: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, isActive: true } },
  brand: { select: { id: true, name: true, isActive: true } },
} as const satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type Tx = Prisma.TransactionClient;

/** Non-price fields that need catalogue:write in a PATCH. */
const ORDINARY_FIELDS = [
  'name',
  'description',
  'categoryId',
  'brandId',
  'reorderLevel',
  'specifications',
  'isActive',
] as const;

/** Fields recorded in `product.updated` audit events. */
const AUDITED_ORDINARY_FIELDS = [
  'name',
  'description',
  'categoryId',
  'brandId',
  'reorderLevel',
  'specifications',
  'isActive',
] as const;

export interface ProductResponse {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: { id: string; name: string };
  brand: { id: string; name: string };
  trackingMode: string;
  identifierType: string | null;
  identifiersPerUnit: number | null;
  /** Present only for callers holding catalogue:cost_read (D4). */
  costPrice?: string;
  sellingPrice: string;
  currency: string;
  priceIncludesTax: false;
  reorderLevel: number;
  specifications: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The ONLY way products leave the service: cost price is removed here for
   * callers without catalogue:cost_read, so no endpoint can leak it (D4).
   */
  toResponse(row: ProductRow, user: AuthenticatedUser): ProductResponse {
    const canSeeCost = user.permissions.has(PERMISSIONS.CATALOGUE_COST_READ);
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      category: { id: row.category.id, name: row.category.name },
      brand: { id: row.brand.id, name: row.brand.name },
      trackingMode: row.trackingMode,
      identifierType: row.identifierType,
      identifiersPerUnit: row.identifiersPerUnit,
      ...(canSeeCost ? { costPrice: toMoneyString(row.costPrice) } : {}),
      sellingPrice: toMoneyString(row.sellingPrice),
      currency: this.config.currency,
      priceIncludesTax: false,
      reorderLevel: row.reorderLevel,
      specifications: row.specifications,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(query: ProductQueryDto, user: AuthenticatedUser) {
    const q = query.q?.trim();
    const where: Prisma.ProductWhereInput = {
      sku: query.sku,
      categoryId: query.categoryId,
      brandId: query.brandId,
      trackingMode: query.trackingMode,
      isActive: query.isActive,
      ...(q
        ? {
            OR: [
              { sku: { contains: q.toUpperCase() } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const order = query.order ?? 'asc';
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        // Cost price is never a sort key (it could be inferred by cashiers).
        orderBy: [{ [query.sort ?? 'name']: order }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.product.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map((r) => this.toResponse(r, user)),
      total,
      query,
    );
  }

  async get(id: string, user: AuthenticatedUser): Promise<ProductResponse> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    if (!row) throw notFound();
    return this.toResponse(row, user);
  }

  async create(
    dto: CreateProductDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<ProductResponse> {
    const policy = trackingPolicy(dto);
    const specifications = normaliseSpecifications(dto.specifications ?? {});

    const row = await this.mapDuplicateSku(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockActiveReferences(tx, dto.categoryId, dto.brandId);
        const created = await tx.product.create({
          data: {
            sku: normaliseSku(dto.sku),
            name: dto.name,
            description: dto.description || null,
            categoryId: dto.categoryId,
            brandId: dto.brandId,
            trackingMode: dto.trackingMode,
            identifierType: policy.identifierType,
            identifiersPerUnit: policy.identifiersPerUnit,
            costPrice: dto.costPrice,
            sellingPrice: dto.sellingPrice,
            reorderLevel: dto.reorderLevel ?? 0,
            specifications,
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: PRODUCT_SELECT,
        });
        await this.audit.record(
          {
            action: 'product.created',
            entityType: 'Product',
            entityId: created.id,
            actorId: actor.id,
            metadata: {
              sku: created.sku,
              name: created.name,
              trackingMode: created.trackingMode,
              costPrice: toMoneyString(created.costPrice),
              sellingPrice: toMoneyString(created.sellingPrice),
            },
            context,
          },
          tx,
        );
        await this.auditBelowCost(tx, created, actor, context);
        return created;
      }),
    );
    return this.toResponse(row, actor);
  }

  /**
   * Field-level authorization (D5): price fields need catalogue:price, other
   * fields catalogue:write. Any unauthorised part rejects the whole request
   * before anything is read or written.
   */
  async update(
    id: string,
    dto: UpdateProductDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<ProductResponse> {
    const touchesPrice = PRICE_FIELDS.some((f) => dto[f] !== undefined);
    const touchesOrdinary = ORDINARY_FIELDS.some((f) => dto[f] !== undefined);
    if (touchesPrice && !actor.permissions.has(PERMISSIONS.CATALOGUE_PRICE)) {
      throw permissionDenied();
    }
    if (
      touchesOrdinary &&
      !actor.permissions.has(PERMISSIONS.CATALOGUE_WRITE)
    ) {
      throw permissionDenied();
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "products" WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw notFound();
      const before = await tx.product.findUniqueOrThrow({
        where: { id },
        select: { ...PRODUCT_SELECT, categoryId: true, brandId: true },
      });
      assertImmutableUnchanged(dto, before);

      const categoryId = dto.categoryId ?? before.categoryId;
      const brandId = dto.brandId ?? before.brandId;
      const willBeActive = dto.isActive ?? before.isActive;
      // An active product must always point to an active category and brand (D12).
      if (
        willBeActive &&
        (dto.categoryId !== undefined ||
          dto.brandId !== undefined ||
          (dto.isActive === true && !before.isActive))
      ) {
        await this.lockActiveReferences(tx, categoryId, brandId);
      }

      const after = await tx.product.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description === '' ? null : dto.description,
          categoryId: dto.categoryId,
          brandId: dto.brandId,
          reorderLevel: dto.reorderLevel,
          specifications:
            dto.specifications !== undefined
              ? normaliseSpecifications(dto.specifications)
              : undefined,
          isActive: dto.isActive,
          costPrice: dto.costPrice,
          sellingPrice: dto.sellingPrice,
          updatedById: actor.id,
        },
        select: { ...PRODUCT_SELECT, categoryId: true, brandId: true },
      });

      const ordinaryChanges = changedFields(
        before,
        after,
        AUDITED_ORDINARY_FIELDS,
      );
      if (Object.keys(ordinaryChanges).length > 0) {
        const action =
          ordinaryChanges.isActive?.to === false
            ? 'product.deactivated'
            : ordinaryChanges.isActive?.to === true
              ? 'product.reactivated'
              : 'product.updated';
        await this.audit.record(
          {
            action,
            entityType: 'Product',
            entityId: id,
            actorId: actor.id,
            metadata: { sku: after.sku, changes: ordinaryChanges },
            context,
          },
          tx,
        );
      }

      const priceChanges = changedFields(before, after, PRICE_FIELDS);
      if (Object.keys(priceChanges).length > 0) {
        // Old/new value per field; user and timestamp are the audit record's
        // actor and createdAt (D5).
        await this.audit.record(
          {
            action: 'product.price_changed',
            entityType: 'Product',
            entityId: id,
            actorId: actor.id,
            metadata: {
              sku: after.sku,
              changedFields: Object.keys(priceChanges),
              changes: priceChanges,
            },
            context,
          },
          tx,
        );
        await this.auditBelowCost(tx, after, actor, context);
      }
      return after;
    });
    return this.toResponse(row, actor);
  }

  /**
   * Locks the category and brand rows (FOR SHARE) and requires them to exist
   * and be active. Deactivation takes FOR UPDATE on the same rows, so the two
   * operations serialise (ADR-025).
   */
  private async lockActiveReferences(
    tx: Tx,
    categoryId: string,
    brandId: string,
  ) {
    const [category] = await tx.$queryRaw<{ is_active: boolean }[]>`
      SELECT is_active FROM "categories" WHERE id = ${categoryId}::uuid FOR SHARE`;
    if (!category) throw referenceNotFound('Category');
    const [brand] = await tx.$queryRaw<{ is_active: boolean }[]>`
      SELECT is_active FROM "brands" WHERE id = ${brandId}::uuid FOR SHARE`;
    if (!brand) throw referenceNotFound('Brand');
    const inactive = [
      ...(category.is_active ? [] : ['categoryId']),
      ...(brand.is_active ? [] : ['brandId']),
    ];
    if (inactive.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERENCE_INACTIVE,
        'An active product cannot use an inactive category or brand',
        inactive.map((field) => ({
          field,
          messages: [`${field} refers to an inactive record`],
        })),
      );
    }
  }

  /** Selling below cost is allowed but audited as its own event (D6). */
  private async auditBelowCost(
    tx: Tx,
    row: {
      id: string;
      sku: string;
      costPrice: Prisma.Decimal;
      sellingPrice: Prisma.Decimal;
    },
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    if (new Prisma.Decimal(row.sellingPrice).lt(row.costPrice)) {
      await this.audit.record(
        {
          action: 'product.selling_below_cost',
          entityType: 'Product',
          entityId: row.id,
          actorId: actor.id,
          metadata: {
            sku: row.sku,
            costPrice: toMoneyString(row.costPrice),
            sellingPrice: toMoneyString(row.sellingPrice),
          },
          context,
        },
        tx,
      );
    }
  }

  private async mapDuplicateSku<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DUPLICATE_VALUE,
          'A product with this SKU already exists',
          [
            {
              field: 'sku',
              messages: ['sku already exists (SKUs are case-insensitive)'],
            },
          ],
        );
      }
      throw e;
    }
  }
}

/** SERIALIZED ⇔ identifier policy present (DB CHECK mirrors this). */
export function trackingPolicy(dto: {
  trackingMode: string;
  identifierType?: 'IMEI' | 'SERIAL';
  identifiersPerUnit?: number;
}): {
  identifierType: 'IMEI' | 'SERIAL' | null;
  identifiersPerUnit: number | null;
} {
  if (dto.trackingMode === 'SERIALIZED') {
    if (!dto.identifierType) {
      throw validation(
        'identifierType',
        'identifierType is required for SERIALIZED products (IMEI or SERIAL)',
      );
    }
    return {
      identifierType: dto.identifierType,
      identifiersPerUnit: dto.identifiersPerUnit ?? 1,
    };
  }
  const extra = (['identifierType', 'identifiersPerUnit'] as const).filter(
    (f) => dto[f] !== undefined,
  );
  if (extra.length > 0) {
    throw validation(
      extra[0],
      `${extra[0]} is only allowed for SERIALIZED products`,
    );
  }
  return { identifierType: null, identifiersPerUnit: null };
}

/** 400 IMMUTABLE_FIELD if a PATCH tries to change sku or the tracking policy (D9). */
export function assertImmutableUnchanged(
  body: object,
  current: {
    sku: string;
    trackingMode: string;
    identifierType: string | null;
    identifiersPerUnit: number | null;
  },
): void {
  const dto = body as Record<string, unknown>;
  const changed = IMMUTABLE_PRODUCT_FIELDS.filter((f) => {
    const v = dto[f];
    if (v === undefined) return false;
    const next = f === 'sku' && typeof v === 'string' ? normaliseSku(v) : v;
    return next !== current[f];
  });
  if (changed.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.IMMUTABLE_FIELD,
      `${changed.join(', ')} cannot be changed after creation; create a new product instead`,
      changed.map((field) => ({ field, messages: [`${field} is immutable`] })),
    );
  }
}

function validation(field: string, message: string): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Validation failed',
    [{ field, messages: [message] }],
  );
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Product not found',
  );
}

function referenceNotFound(label: 'Category' | 'Brand'): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${label} not found`,
  );
}
