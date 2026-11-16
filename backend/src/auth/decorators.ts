import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { PermissionKey } from '../access/permissions';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'auth:requiredPermissions';
export const AUTHENTICATED_ONLY_KEY = 'auth:authenticatedOnly';
export const REQUIRED_ANY_PERMISSION_KEY = 'auth:requiredAnyPermission';

/**
 * Every route must declare exactly one access rule; routes without one are
 * denied (fail closed, ADR-016):
 * - `@Public()`            no authentication (login, health)
 * - `@AuthenticatedOnly()` any signed-in active user (own profile, logout-all)
 * - `@RequirePermissions(...)` signed-in user holding ALL listed permissions
 * - `@RequireAnyPermission(...)` signed-in user holding AT LEAST ONE; the
 *   service must then enforce field-level rules (e.g. product PATCH, ADR-025)
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const AuthenticatedOnly = () =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, true);

export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_ANY_PERMISSION_KEY, permissions);

/** Injects the authenticated user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user)
      throw new Error('CurrentUser used on a route without authentication');
    return user;
  },
);
