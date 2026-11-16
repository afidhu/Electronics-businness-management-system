import { HttpStatus, Injectable } from '@nestjs/common';
import { BranchAccessService } from '../access/branch-access.service';
import { PERMISSIONS, type RoleKey } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';

/** Never select passwordHash or token data for API responses. */
const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { key: true, name: true } },
  branches: {
    select: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: { branch: { code: 'asc' } },
  },
} as const satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toUserResponse(row: UserRow) {
  const { branches, lockedUntil, ...rest } = row;
  return {
    ...rest,
    isLocked: lockedUntil !== null && lockedUntil > new Date(),
    branches: branches.map((b) => b.branch),
  };
}

type Tx = Prisma.TransactionClient;

interface RoleInfo {
  id: string;
  key: string;
  maxBranches: number | null;
  allBranches: boolean;
  canManageUsers: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly branchAccess: BranchAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Branch-scoped: non-global users only see users sharing one of their branches. */
  async list(query: UserQueryDto, actor: AuthenticatedUser) {
    if (query.branchId)
      this.branchAccess.assertCanAccess(actor, query.branchId);
    const branchFilter = query.branchId
      ? { some: { branchId: query.branchId } }
      : actor.allBranches
        ? undefined
        : { some: { branchId: { in: [...actor.branchIds] } } };

    const where: Prisma.UserWhereInput = {
      isActive: query.isActive,
      role: query.roleKey ? { key: query.roleKey } : undefined,
      branches: branchFilter,
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { fullName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { email: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return new PaginatedResult(rows.map(toUserResponse), total, query);
  }

  /** 404 for users that do not exist OR are outside the caller's branch scope. */
  async get(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.user.findFirst({
      where: {
        id,
        branches: actor.allBranches
          ? undefined
          : { some: { branchId: { in: [...actor.branchIds] } } },
      },
      select: USER_SELECT,
    });
    if (!row) throw notFound();
    return toUserResponse(row);
  }

  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    this.passwords.assertAcceptable(dto.password, { email: dto.email });
    const passwordHash = await this.passwords.hash(dto.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await this.findRole(tx, dto.roleKey);
      await this.validateAssignments(tx, role, dto.branchIds, actor);
      const user = await tx.user.create({
        data: {
          email: dto.email,
          fullName: dto.fullName,
          passwordHash,
          roleId: role.id,
          branches: {
            create: dto.branchIds.map((branchId) => ({
              branchId,
              assignedById: actor.id,
            })),
          },
        },
        select: USER_SELECT,
      });
      await this.audit.record(
        {
          action: 'user.created',
          entityType: 'User',
          entityId: user.id,
          actorId: actor.id,
          branchId: dto.branchIds.length === 1 ? dto.branchIds[0] : null,
          metadata: {
            email: user.email,
            roleKey: role.key,
            branchIds: dto.branchIds,
          },
          context,
        },
        tx,
      );
      return user;
    });
    return toUserResponse(created);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: {
          isActive: true,
          role: { select: { key: true } },
          branches: { select: { branchId: true } },
        },
      });
      if (!current) throw notFound();

      const isSelf = id === actor.id;
      const roleChanging =
        dto.roleKey !== undefined && dto.roleKey !== current.role.key;
      const deactivating = dto.isActive === false && current.isActive;
      if (isSelf && (roleChanging || deactivating)) {
        throw lockout('You cannot change your own role or deactivate yourself');
      }

      const finalRole = await this.findRole(
        tx,
        (dto.roleKey ?? current.role.key) as RoleKey,
      );
      const currentRole = await this.findRole(tx, current.role.key as RoleKey);
      if (
        currentRole.canManageUsers &&
        current.isActive &&
        (deactivating || !finalRole.canManageUsers)
      ) {
        await this.assertAnotherActiveAdmin(tx, id);
      }

      const branchesChanging = dto.branchIds !== undefined || roleChanging;
      const finalBranchIds = finalRole.allBranches
        ? []
        : (dto.branchIds ?? current.branches.map((b) => b.branchId));
      if (branchesChanging) {
        await this.validateAssignments(tx, finalRole, finalBranchIds, actor);
        await tx.userBranch.deleteMany({ where: { userId: id } });
        await tx.userBranch.createMany({
          data: finalBranchIds.map((branchId) => ({
            userId: id,
            branchId,
            assignedById: actor.id,
          })),
        });
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          fullName: dto.fullName,
          isActive: dto.isActive,
          roleId: roleChanging ? finalRole.id : undefined,
        },
        select: USER_SELECT,
      });

      if (deactivating) {
        await this.refreshTokens.revokeAllForUser(id, 'USER_DEACTIVATED', tx);
      }
      await this.audit.record(
        {
          action: deactivating
            ? 'user.deactivated'
            : dto.isActive === true && !current.isActive
              ? 'user.reactivated'
              : 'user.updated',
          entityType: 'User',
          entityId: id,
          actorId: actor.id,
          metadata: {
            changes: dto,
            ...(roleChanging ? { previousRole: current.role.key } : {}),
            ...(branchesChanging
              ? { previousBranchIds: current.branches.map((b) => b.branchId) }
              : {}),
          },
          context,
        },
        tx,
      );
      return user;
    });
    return toUserResponse(updated);
  }

  /** Admin sets a new password: unlocks the account and revokes all sessions. */
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<void> {
    if (id === actor.id) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Use POST /auth/change-password to change your own password',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });
    if (!target) throw notFound();
    this.passwords.assertAcceptable(dto.newPassword, { email: target.email });
    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await this.refreshTokens.revokeAllForUser(id, 'PASSWORD_CHANGED', tx);
      await this.audit.record(
        {
          action: 'user.password_reset',
          entityType: 'User',
          entityId: id,
          actorId: actor.id,
          context,
        },
        tx,
      );
    });
  }

  private async findRole(tx: Tx, key: RoleKey): Promise<RoleInfo> {
    const role = await tx.role.findUnique({
      where: { key },
      select: {
        id: true,
        key: true,
        maxBranches: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!role) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'roleKey',
            messages: ['roleKey does not exist (run db:seed)'],
          },
        ],
      );
    }
    const keys = new Set(role.permissions.map((p) => p.permission.key));
    return {
      id: role.id,
      key: role.key,
      maxBranches: role.maxBranches,
      allBranches: keys.has(PERMISSIONS.BRANCHES_ACCESS_ALL),
      canManageUsers: keys.has(PERMISSIONS.USERS_WRITE),
    };
  }

  /** Branch assignment rules per role (ADR-019). */
  private async validateAssignments(
    tx: Tx,
    role: RoleInfo,
    branchIds: string[],
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (role.allBranches) {
      if (branchIds.length > 0) {
        throw invalidAssignment(
          `${role.key} has access to all branches; do not assign branches`,
        );
      }
      return;
    }
    if (branchIds.length === 0) {
      throw invalidAssignment(`${role.key} requires at least one branch`);
    }
    if (role.maxBranches !== null && branchIds.length > role.maxBranches) {
      throw invalidAssignment(
        `${role.key} can be assigned to at most ${role.maxBranches} branch(es)`,
      );
    }
    this.branchAccess.assertCanAccessAll(actor, branchIds);
    const active = await tx.branch.count({
      where: { id: { in: branchIds }, isActive: true },
    });
    if (active !== branchIds.length) {
      throw invalidAssignment('Every assigned branch must exist and be active');
    }
  }

  /** Prevent removing the last active user who can manage users. */
  private async assertAnotherActiveAdmin(
    tx: Tx,
    excludingUserId: string,
  ): Promise<void> {
    const others = await tx.user.count({
      where: {
        id: { not: excludingUserId },
        isActive: true,
        role: {
          permissions: {
            some: { permission: { key: PERMISSIONS.USERS_WRITE } },
          },
        },
      },
    });
    if (others === 0) {
      throw lockout('At least one active administrator must remain');
    }
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'User not found',
  );
}

function invalidAssignment(message: string): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.BRANCH_ASSIGNMENT_INVALID,
    message,
  );
}

function lockout(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.ADMIN_LOCKOUT_PREVENTED,
    message,
  );
}
