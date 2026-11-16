import { HttpStatus, Injectable } from '@nestjs/common';
import { BranchAccessService } from '../access/branch-access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BranchQueryDto,
  CreateBranchDto,
  UpdateBranchDto,
} from './dto/branch.dto';

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Lists only branches inside the caller's scope (FR-ADM-01). */
  async list(query: BranchQueryDto, user: AuthenticatedUser) {
    const where: Prisma.BranchWhereInput = {
      id: this.branchAccess.scopeFilter(user),
      isActive: query.isActive,
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        select: BRANCH_SELECT,
        orderBy: { code: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.branch.count({ where }),
    ]);
    return new PaginatedResult(items, total, query);
  }

  /** 404 if it does not exist; 403 BRANCH_ACCESS_DENIED if outside scope. */
  async get(id: string, user: AuthenticatedUser) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      select: BRANCH_SELECT,
    });
    if (!branch) throw notFound();
    this.branchAccess.assertCanAccess(user, id);
    return branch;
  }

  async create(
    dto: CreateBranchDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: dto,
        select: BRANCH_SELECT,
      });
      await this.audit.record(
        {
          action: 'branch.created',
          entityType: 'Branch',
          entityId: branch.id,
          branchId: branch.id,
          actorId: actor.id,
          metadata: { code: branch.code, name: branch.name },
          context,
        },
        tx,
      );
      return branch;
    });
  }

  async update(
    id: string,
    dto: UpdateBranchDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    await this.get(id, actor);
    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.update({
        where: { id },
        data: dto,
        select: BRANCH_SELECT,
      });
      await this.audit.record(
        {
          action:
            dto.isActive === false ? 'branch.deactivated' : 'branch.updated',
          entityType: 'Branch',
          entityId: id,
          branchId: id,
          actorId: actor.id,
          metadata: { changes: dto },
          context,
        },
        tx,
      );
      return branch;
    });
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Branch not found',
  );
}
