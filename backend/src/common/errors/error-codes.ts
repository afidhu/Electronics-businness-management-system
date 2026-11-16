import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes returned in the `code` field of every
 * error response (API contract §Response conventions, ADR-013).
 * Business modules add their own codes here (e.g. INSUFFICIENT_STOCK).
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  DUPLICATE_VALUE = 'DUPLICATE_VALUE',
  REFERENCE_CONFLICT = 'REFERENCE_CONFLICT',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // Module 2 — authentication & authorization
  /** Login failed. Deliberately identical for unknown email, wrong password, inactive or locked account. */
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  /** Missing, malformed, expired or revoked access/refresh token. */
  INVALID_TOKEN = 'INVALID_TOKEN',
  /** Authenticated but the required permission is missing. */
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  /** Authenticated but the branch is outside the user's scope. */
  BRANCH_ACCESS_DENIED = 'BRANCH_ACCESS_DENIED',
  /** Cookie-authenticated request without the anti-CSRF header/origin. */
  CSRF_CHECK_FAILED = 'CSRF_CHECK_FAILED',
  WEAK_PASSWORD = 'WEAK_PASSWORD',
  BRANCH_ASSIGNMENT_INVALID = 'BRANCH_ASSIGNMENT_INVALID',
  /** Change would leave no active system administrator, or lock the caller out. */
  ADMIN_LOCKOUT_PREVENTED = 'ADMIN_LOCKOUT_PREVENTED',
}

/** Fallback code for a bare HTTP status (used when no explicit code is given). */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
  }
}
