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

  // Module 3 — product catalogue
  /** Selected category or brand is inactive. */
  REFERENCE_INACTIVE = 'REFERENCE_INACTIVE',
  /** Category cannot be deactivated while active products use it. */
  CATEGORY_IN_USE = 'CATEGORY_IN_USE',
  /** Brand cannot be deactivated while active products use it. */
  BRAND_IN_USE = 'BRAND_IN_USE',
  /** Attempt to change sku, trackingMode or the identifier policy (D9). */
  IMMUTABLE_FIELD = 'IMMUTABLE_FIELD',

  // Module 4 — procurement
  /** Action not allowed in the order's current status (incl. lost races). */
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  /** Creator or submitter tried to approve/reject their own order (any role). */
  SELF_APPROVAL_FORBIDDEN = 'SELF_APPROVAL_FORBIDDEN',
  /** Supplier deactivation blocked while open purchase orders exist. */
  SUPPLIER_IN_USE = 'SUPPLIER_IN_USE',
  /** Edit attempted on a purchase order that is not DRAFT. */
  PURCHASE_NOT_EDITABLE = 'PURCHASE_NOT_EDITABLE',
  /** Same product on more than one line of an order. */
  DUPLICATE_PRODUCT_LINE = 'DUPLICATE_PRODUCT_LINE',

  // Module 5 — inventory
  /** BR-14: creator, submitter or approver tried to receive the order. */
  SELF_RECEIVING_FORBIDDEN = 'SELF_RECEIVING_FORBIDDEN',
  /** Quantity exceeds what is still outstanding on the PO line (I3). */
  OVER_RECEIVING = 'OVER_RECEIVING',
  /** IMEI/serial format invalid. */
  INVALID_IDENTIFIER = 'INVALID_IDENTIFIER',
  /** Units/identifiers don't match quantity × identifiersPerUnit. */
  IDENTIFIER_COUNT_MISMATCH = 'IDENTIFIER_COUNT_MISMATCH',
  /** Identifier already registered, or repeated within the request. */
  DUPLICATE_IDENTIFIER = 'DUPLICATE_IDENTIFIER',
  /** Same idempotency key reused for a different request. */
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',

  // Module 6 — POS
  /** No VAT rate configured yet: sales are blocked (BR-20). */
  TAX_NOT_CONFIGURED = 'TAX_NOT_CONFIGURED',
  /** Not enough available stock at the selling branch (BR-01). */
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  /** Serialized unit not IN_STOCK at the selling branch (sold, elsewhere, unavailable). */
  UNIT_NOT_AVAILABLE = 'UNIT_NOT_AVAILABLE',
  /** Product inactive or unknown: cannot be sold (S9, US-03). */
  PRODUCT_NOT_SELLABLE = 'PRODUCT_NOT_SELLABLE',
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
