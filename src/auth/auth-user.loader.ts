import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type RoleKey } from '../access/permissions';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth.types';

/** Select used wherever an AuthenticatedUser is built. */
export const AUTH_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  passwordChangedAt: true,
  role: {
    select: {
      key: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
  },
  branches: { select: { branchId: true } },
} as const;

type AuthUserRow = {
  id: string;
  email: string;
  fullName: string;
  role: { key: string; permissions: { permission: { key: string } }[] };
  branches: { branchId: string }[];
};

export function toAuthenticatedUser(row: AuthUserRow): AuthenticatedUser {
  const permissions = new Set(
    row.role.permissions.map((p) => p.permission.key),
  );
  const allBranches = permissions.has(PERMISSIONS.BRANCHES_ACCESS_ALL);
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    roleKey: row.role.key as RoleKey,
    permissions,
    branchIds: allBranches ? [] : row.branches.map((b) => b.branchId),
    allBranches,
  };
}

/** Public profile returned by login, refresh and /auth/me (no secrets). */
export function toProfile(user: AuthenticatedUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.roleKey,
    permissions: [...user.permissions].sort(),
    branchIds: [...user.branchIds],
    allBranches: user.allBranches,
  };
}

@Injectable()
export class AuthUserLoader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads an ACTIVE user's identity, permissions and branches.
   * Returns null for unknown/inactive users, or when the token was issued
   * before the last password change (`issuedAtSeconds`).
   */
  async load(
    userId: string,
    issuedAtSeconds?: number,
  ): Promise<AuthenticatedUser | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: AUTH_USER_SELECT,
    });
    if (!row || !row.isActive) return null;
    if (
      issuedAtSeconds !== undefined &&
      issuedAtSeconds < Math.floor(row.passwordChangedAt.getTime() / 1000)
    ) {
      return null;
    }
    return toAuthenticatedUser(row);
  }
}
