import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { BranchAccessService } from './branch-access.service';

export const BRANCH_SCOPE_KEY = 'access:branchScope';

export type BranchIdSource = 'params' | 'query' | 'body';

export interface BranchScopeRule {
  source: BranchIdSource;
  field: string;
}

/**
 * Declares where a request carries a branch ID that must be inside the
 * caller's branch scope, e.g. `@BranchScoped('body', 'branchId')`.
 * Enforced by BranchScopeGuard (runs after authentication/permissions).
 * Arrays of IDs are supported (every element is checked).
 */
export const BranchScoped = (source: BranchIdSource, field = 'branchId') =>
  SetMetadata(BRANCH_SCOPE_KEY, { source, field } satisfies BranchScopeRule);

@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly branchAccess: BranchAccessService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<BranchScopeRule | undefined>(
      BRANCH_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rule) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) return true; // public route: nothing to scope
    const container = (req[rule.source] ?? {}) as Record<string, unknown>;
    const value = container[rule.field];
    if (value === undefined || value === null || value === '') return true;

    const ids = Array.isArray(value) ? value : [value];
    // Non-string IDs are left to DTO validation; only strings are compared.
    this.branchAccess.assertCanAccessAll(
      req.user,
      ids.filter((v): v is string => typeof v === 'string'),
    );
    return true;
  }
}
