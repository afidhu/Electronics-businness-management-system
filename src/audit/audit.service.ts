import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

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
      // Users without access_all only see events tied to their branches.
      branchId: user.allBranches
        ? query.branchId
        : (query.branchId ?? { in: [...user.branchIds] }),
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
