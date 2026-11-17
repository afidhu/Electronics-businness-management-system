import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

/**
 * Entity types whose audit events belong to the whole organisation (no
 * branch) and are visible to every audit reader (ADR-026). Identity and
 * authentication events (entityType "User") are deliberately NOT included.
 */
export const ORGANISATION_WIDE_ENTITY_TYPES = [
  'Category',
  'Brand',
  'Product',
  'Supplier', // Module 4, P13
  'TaxSetting', // Module 6: organisation VAT rate
  'Customer', // Module 6: organisation-wide customers (metadata minimised)
] as const;

/** Keys never stored in audit metadata, at any depth (NFR-SEC-04). */
const SENSITIVE_KEY = /pass(word)?|token|secret|hash|cookie|authorization/i;

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  branchId?: string | null;
  metadata?: Record<string, unknown>;
  context?: RequestContext;
}

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

export function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE_KEY.test(k))
        .map(([k, v]) => [k, sanitizeMetadata(v)]),
    );
  }
  return value;
}

/**
 * Append-only audit trail (FR-ADM-02, FR-AUTH-06, ADR-020). Pass the
 * transaction client to record an event atomically with the change it describes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        actorId: event.actorId ?? null,
        branchId: event.branchId ?? null,
        metadata: event.metadata
          ? (sanitizeMetadata(event.metadata) as Prisma.InputJsonValue)
          : undefined,
        ipAddress: event.context?.ipAddress ?? null,
        requestId: event.context?.requestId ?? null,
      },
    });
    this.logger.debug(`audit ${event.action} ${event.entityType}`);
  }

  /**
   * Which audit events a user may see (ADR-020, ADR-026):
   * - `branches:access_all` (SYSTEM_ADMIN): everything.
   * - others: events of their branches, plus organisation-wide catalogue
   *   events. Global identity/login events stay hidden from them.
   */
  private visibilityFilter(
    user: AuthenticatedUser,
    branchId?: string,
  ): Prisma.AuditLogWhereInput {
    if (user.allBranches) return { branchId };
    if (branchId) return { branchId };
    return {
      OR: [
        { branchId: { in: [...user.branchIds] } },
        {
          branchId: null,
          entityType: { in: [...ORGANISATION_WIDE_ENTITY_TYPES] },
        },
      ],
    };
  }

  /** Branch-scoped, paginated audit history (audit:read). */
  async list(
    query: AuditLogQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<unknown>> {
    if (query.from && query.to && query.from > query.to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [{ field: 'from', messages: ['from must be before to'] }],
      );
    }
    if (
      query.branchId &&
      !user.allBranches &&
      !user.branchIds.includes(query.branchId)
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.BRANCH_ACCESS_DENIED,
        'You do not have access to this branch',
      );
    }

    const where: Prisma.AuditLogWhereInput = {
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      createdAt: { gte: query.from, lt: query.to },
      ...this.visibilityFilter(user, query.branchId),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          branchId: true,
          metadata: true,
          requestId: true,
          createdAt: true,
          actor: { select: { id: true, email: true, fullName: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new PaginatedResult(items, total, query);
  }
}
