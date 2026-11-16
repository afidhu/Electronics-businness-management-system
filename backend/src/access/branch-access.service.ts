import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Branch isolation (FR-ADM-01, ADR-019). Every service that reads or writes
 * branch-owned data must use this — a branch ID from the client is never
 * trusted without this check.
 */
@Injectable()
export class BranchAccessService {
  canAccess(user: AuthenticatedUser, branchId: string): boolean {
    return user.allBranches || user.branchIds.includes(branchId);
  }

  /** Throws 403 BRANCH_ACCESS_DENIED when the branch is outside the user's scope. */
  assertCanAccess(user: AuthenticatedUser, branchId: string): void {
    if (!this.canAccess(user, branchId)) throw branchAccessDenied();
  }

  /** Checks several branch IDs at once (e.g. a transfer's source and destination). */
  assertCanAccessAll(
    user: AuthenticatedUser,
    branchIds: Iterable<string>,
  ): void {
    for (const id of branchIds) this.assertCanAccess(user, id);
  }

  /**
   * Prisma filter for a `branchId` column restricted to the user's scope:
   * `undefined` (no restriction) for all-branch users, otherwise `{ in: [...] }`.
   */
  scopeFilter(user: AuthenticatedUser): { in: string[] } | undefined {
    return user.allBranches ? undefined : { in: [...user.branchIds] };
  }
}

export function branchAccessDenied(): AppException {
  return new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.BRANCH_ACCESS_DENIED,
    'You do not have access to this branch',
  );
}
