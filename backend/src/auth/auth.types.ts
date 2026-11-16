import type { RoleKey } from '../access/permissions';
import type { RequestWithId } from '../common/request-context/request-id.middleware';

/**
 * Identity attached to every authenticated request. Loaded from the database
 * on each request (not from token claims), so deactivation, role changes and
 * branch changes take effect immediately (ADR-017).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  roleKey: RoleKey;
  permissions: ReadonlySet<string>;
  /** Assigned branch IDs (empty for users with branches:access_all). */
  branchIds: readonly string[];
  /** True when the user holds `branches:access_all`. */
  allBranches: boolean;
}

export type AuthenticatedRequest = RequestWithId & { user?: AuthenticatedUser };

/** Claims of an access token. Kept minimal: identity is re-loaded per request. */
export interface AccessTokenClaims {
  sub: string;
  typ: 'access';
  iat: number;
  exp: number;
}
