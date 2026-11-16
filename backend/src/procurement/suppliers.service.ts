import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { nameKey } from '../catalogue/catalogue-rules';
import { changedFields } from '../catalogue/change-set';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { OPEN_PURCHASE_STATUSES } from './procurement-rules';

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
  tin: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplierSelect;

const AUDITED = [
  'name',
  'contactPerson',
  'phone',
  'email',
  'address',
  'tin',
  'notes',
  'isActive',
] as const;

type Tx = Prisma.TransactionClient;

/** Organisation-wide suppliers (FR-PUR-01, P11–P13). */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SupplierQueryDto) {
    const q = query.q?.trim();
    const where: Prisma.SupplierWhereInput = {
      isActive: query.isActive,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { contactPerson: { contains: q, mode: 'insensitive' } },
              { tin: { contains: q.replace(/[\s-]/g, '') } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        select: SUPPLIER_SELECT,
        orderBy: { name: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return new PaginatedResult(items, total, query);
  }

  async get(id: string) {
    const row = await this.prisma.supplier.findUnique({
      where: { id },
      select: SUPPLIER_SELECT,
    });
    if (!row) throw notFound();
    return row;
  }

  async create(
    dto: CreateSupplierDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.mapDuplicates(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertUnique(tx, dto.name, dto.tin);
        const row = await tx.supplier.create({
          data: { ...dto, nameKey: nameKey(dto.name) },
          select: SUPPLIER_SELECT,
        });
        await this.audit.record(
          {
            action: 'supplier.created',
            entityType: 'Supplier',
            entityId: row.id,
            actorId: actor.id,
            metadata: { name: row.name, tin: row.tin },
            context,
          },
          tx,
        );
        return row;
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.mapDuplicates(() =>
      this.prisma.$transaction(async (tx) => {
        // FOR UPDATE: purchase creation takes FOR SHARE on the supplier, so a
        // deactivation and a new order can never interleave (P12).
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "suppliers" WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.length === 0) throw notFound();
        const before = await tx.supplier.findUniqueOrThrow({
          where: { id },
          select: SUPPLIER_SELECT,
        });

        await this.assertUnique(tx, dto.name, dto.tin ?? undefined, id);
        const deactivating = dto.isActive === false && before.isActive;
        if (deactivating) {
          const open = await tx.purchase.count({
            where: {
              supplierId: id,
              status: { in: [...OPEN_PURCHASE_STATUSES] },
            },
          });
          if (open > 0) {
            throw new AppException(
              HttpStatus.CONFLICT,
              ErrorCode.SUPPLIER_IN_USE,
              `Supplier has ${open} open purchase order(s); complete or cancel them first`,
            );
          }
        }

        const after = await tx.supplier.update({
          where: { id },
          data: {
            ...dto,
            ...(dto.name !== undefined ? { nameKey: nameKey(dto.name) } : {}),
          },
          select: SUPPLIER_SELECT,
        });
        const changes = changedFields(before, after, AUDITED);
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: deactivating
                ? 'supplier.deactivated'
                : changes.isActive?.to === true
                  ? 'supplier.reactivated'
                  : 'supplier.updated',
              entityType: 'Supplier',
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

  /** Clear field-specific 409s before the DB constraint (which remains the guarantee). */
  private async assertUnique(
    tx: Tx,
    name?: string,
    tin?: string,
    excludeId?: string,
  ) {
    if (name !== undefined) {
      const clash = await tx.supplier.findFirst({
        where: {
          nameKey: nameKey(name),
          id: excludeId ? { not: excludeId } : undefined,
        },
        select: { id: true },
      });
      if (clash)
        throw duplicate('name', 'A supplier with this name already exists');
    }
    if (tin) {
      const clash = await tx.supplier.findFirst({
        where: { tin, id: excludeId ? { not: excludeId } : undefined },
        select: { id: true },
      });
      if (clash)
        throw duplicate('tin', 'A supplier with this TIN already exists');
    }
  }

  private async mapDuplicates<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Lost a race against a concurrent insert: the DB constraint decided.
        throw duplicate(
          'name',
          'A supplier with this name or TIN already exists',
        );
      }
      throw e;
    }
  }
}

function duplicate(field: string, message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.DUPLICATE_VALUE,
    message,
    [{ field, messages: [`${field} already exists`] }],
  );
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Supplier not found',
  );
}
