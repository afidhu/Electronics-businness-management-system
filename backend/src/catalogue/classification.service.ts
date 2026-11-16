import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nameKey } from './catalogue-rules';
import { changedFields } from './change-set';
import type {
  ClassificationQueryDto,
  UpdateCategoryDto,
} from './dto/classification.dto';

/** Category and Brand share their rules; only names and messages differ. */
export type ClassificationKind = 'category' | 'brand';

const KIND = {
  category: {
    entityType: 'Category',
    table: 'categories',
    label: 'Category',
    inUse: ErrorCode.CATEGORY_IN_USE,
    productFk: 'categoryId',
  },
  brand: {
    entityType: 'Brand',
    table: 'brands',
    label: 'Brand',
    inUse: ErrorCode.BRAND_IN_USE,
    productFk: 'brandId',
  },
} as const;

export interface ClassificationRow {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type Tx = Prisma.TransactionClient;

/**
 * Categories and brands (FR-CAT-01, ADR-025): case-insensitive unique names,
 * deactivate-not-delete, deactivation blocked while active products use them
 * (D12), every change audited in the same transaction.
 */
@Injectable()
export class ClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private delegate(
    kind: ClassificationKind,
    db: Tx | PrismaService = this.prisma,
  ) {
    // Both delegates expose the same CRUD surface for these fields.
    return (kind === 'category'
      ? db.category
      : db.brand) as unknown as Prisma.CategoryDelegate;
  }

  private select(kind: ClassificationKind) {
    return {
      id: true,
      name: true,
      ...(kind === 'category' ? { description: true } : {}),
      isActive: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  async list(kind: ClassificationKind, query: ClassificationQueryDto) {
    const where = {
      isActive: query.isActive,
      ...(query.q
        ? { name: { contains: query.q.trim(), mode: 'insensitive' as const } }
        : {}),
    };
    const d = this.delegate(kind);
    const [items, total] = await this.prisma.$transaction([
      d.findMany({
        where,
        select: this.select(kind),
        orderBy: { name: 'asc' },
        ...toSkipTake(query),
      }),
      d.count({ where }),
    ]);
    return new PaginatedResult(items as ClassificationRow[], total, query);
  }

  async get(kind: ClassificationKind, id: string): Promise<ClassificationRow> {
    const row = await this.delegate(kind).findUnique({
      where: { id },
      select: this.select(kind),
    });
    if (!row) throw notFound(kind);
    return row as ClassificationRow;
  }

  async create(
    kind: ClassificationKind,
    dto: { name: string; description?: string },
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<ClassificationRow> {
    return this.mapDuplicate(kind, () =>
      this.prisma.$transaction(async (tx) => {
        const row = (await this.delegate(kind, tx).create({
          data: {
            name: dto.name,
            nameKey: nameKey(dto.name),
            ...(kind === 'category' && dto.description
              ? { description: dto.description }
              : {}),
          },
          select: this.select(kind),
        })) as ClassificationRow;
        await this.audit.record(
          {
            action: `${kind}.created`,
            entityType: KIND[kind].entityType,
            entityId: row.id,
            actorId: actor.id,
            metadata: { name: row.name },
            context,
          },
          tx,
        );
        return row;
      }),
    );
  }

  async update(
    kind: ClassificationKind,
    id: string,
    dto: UpdateCategoryDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<ClassificationRow> {
    return this.mapDuplicate(kind, () =>
      this.prisma.$transaction(async (tx) => {
        // Lock the row: concurrent product creation takes FOR SHARE on it, so
        // deactivation and "attach a product" can never interleave (ADR-025).
        const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM "${KIND[kind].table}" WHERE id = $1::uuid FOR UPDATE`,
          id,
        );
        if (locked.length === 0) throw notFound(kind);
        const before = (await this.delegate(kind, tx).findUniqueOrThrow({
          where: { id },
          select: this.select(kind),
        })) as ClassificationRow;

        const deactivating = dto.isActive === false && before.isActive;
        if (deactivating) await this.assertNotInUse(kind, id, tx);

        const data: Record<string, unknown> = {};
        if (dto.name !== undefined) {
          data.name = dto.name;
          data.nameKey = nameKey(dto.name);
        }
        if (kind === 'category' && dto.description !== undefined)
          data.description = dto.description;
        if (dto.isActive !== undefined) data.isActive = dto.isActive;

        const after = (await this.delegate(kind, tx).update({
          where: { id },
          data,
          select: this.select(kind),
        })) as ClassificationRow;

        const changes = changedFields(before, after, [
          'name',
          'description',
          'isActive',
        ]);
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: deactivating
                ? `${kind}.deactivated`
                : dto.isActive === true && !before.isActive
                  ? `${kind}.reactivated`
                  : `${kind}.updated`,
              entityType: KIND[kind].entityType,
              entityId: id,
              actorId: actor.id,
              metadata: { changes },
              context,
            },
            tx,
          );
        }
        return after;
      }),
    );
  }

  private async assertNotInUse(kind: ClassificationKind, id: string, tx: Tx) {
    const activeProducts = await tx.product.count({
      where: { [KIND[kind].productFk]: id, isActive: true },
    });
    if (activeProducts > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        KIND[kind].inUse,
        `${KIND[kind].label} is used by ${activeProducts} active product(s); deactivate or reassign them first`,
      );
    }
  }

  /** Unique name violation → 409 DUPLICATE_VALUE on the "name" field. */
  private async mapDuplicate<T>(
    kind: ClassificationKind,
    fn: () => Promise<T>,
  ): Promise<T> {
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
          `A ${kind} with this name already exists`,
          [
            {
              field: 'name',
              messages: ['name already exists (names are case-insensitive)'],
            },
          ],
        );
      }
      throw e;
    }
  }
}

function notFound(kind: ClassificationKind): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${KIND[kind].label} not found`,
  );
}
