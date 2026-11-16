import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { changedFields } from '../catalogue/change-set';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { normalisePhone } from './phone';

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CustomerSelect;

const FIELDS = ['name', 'phone', 'email', 'notes', 'isActive'] as const;

/**
 * Organisation-wide customers (S6, FR-CUST-01). Optional on sales (walk-in).
 * Audit metadata records WHICH fields changed, never personal values.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CustomerQueryDto) {
    const q = query.q?.trim();
    const phone = q ? normalisePhone(q) : null;
    const digits = q?.replace(/\D/g, '') ?? '';
    const where: Prisma.CustomerWhereInput = {
      isActive: query.isActive,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              ...(phone ? [{ phone }] : []),
              // Partial digits (e.g. last 6 digits typed at the till).
              ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        select: CUSTOMER_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return new PaginatedResult(items, total, query);
  }

  async get(id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      select: CUSTOMER_SELECT,
    });
    if (!c)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Customer not found',
      );
    return c;
  }

  async create(
    dto: CreateCustomerDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.mapDuplicate(() =>
      this.prisma.$transaction(async (tx) => {
        if (dto.phone) await this.assertPhoneFree(tx, dto.phone);
        const c = await tx.customer.create({
          data: { ...dto, createdById: actor.id },
          select: CUSTOMER_SELECT,
        });
        await this.audit.record(
          {
            action: 'customer.created',
            entityType: 'Customer',
            entityId: c.id,
            actorId: actor.id,
            // Minimal personal data: which fields were provided, not their values.
            metadata: {
              fieldsProvided: FIELDS.filter(
                (f) => f !== 'isActive' && c[f] != null,
              ),
            },
            context,
          },
          tx,
        );
        return c;
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.mapDuplicate(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await tx.customer.findUnique({
          where: { id },
          select: CUSTOMER_SELECT,
        });
        if (!before)
          throw new AppException(
            HttpStatus.NOT_FOUND,
            ErrorCode.NOT_FOUND,
            'Customer not found',
          );
        if (dto.phone && dto.phone !== before.phone)
          await this.assertPhoneFree(tx, dto.phone, id);
        const after = await tx.customer.update({
          where: { id },
          data: dto,
          select: CUSTOMER_SELECT,
        });
        const changed = Object.keys(changedFields(before, after, FIELDS));
        if (changed.length > 0) {
          await this.audit.record(
            {
              action:
                dto.isActive === false && before.isActive
                  ? 'customer.deactivated'
                  : dto.isActive === true && !before.isActive
                    ? 'customer.reactivated'
                    : 'customer.updated',
              entityType: 'Customer',
              entityId: id,
              actorId: actor.id,
              metadata: { changedFields: changed },
              context,
            },
            tx,
          );
        }
        return after;
      }),
    );
  }

  private async assertPhoneFree(
    tx: Prisma.TransactionClient,
    phone: string,
    excludeId?: string,
  ) {
    const clash = await tx.customer.findFirst({
      where: { phone, id: excludeId ? { not: excludeId } : undefined },
      select: { id: true },
    });
    if (clash) throw duplicatePhone();
  }

  private async mapDuplicate<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw duplicatePhone();
      throw e;
    }
  }
}

function duplicatePhone(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.DUPLICATE_VALUE,
    'A customer with this phone number already exists',
    [
      {
        field: 'phone',
        messages: [
          'phone already exists (numbers are compared after normalisation)',
        ],
      },
    ],
  );
}
