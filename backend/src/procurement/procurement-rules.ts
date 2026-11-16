/**
 * Pure procurement rules (ADR-027). No I/O; unit-tested in isolation and
 * mirrored by database constraints where it matters.
 */
import { Prisma } from '../generated/prisma/client';

export type PurchaseStatusValue =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

/** Orders that still tie up a supplier (P12). */
export const OPEN_PURCHASE_STATUSES: readonly PurchaseStatusValue[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PARTIALLY_RECEIVED',
];

export type PurchaseAction =
  'edit' | 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel';

/**
 * Module 4 transitions only (P2, P5). Receiving transitions
 * (APPROVED → PARTIALLY_RECEIVED → RECEIVED) belong to Module 5.
 */
const ALLOWED: Record<PurchaseAction, readonly PurchaseStatusValue[]> = {
  edit: ['DRAFT'],
  submit: ['DRAFT'],
  approve: ['SUBMITTED'],
  reject: ['SUBMITTED'],
  reopen: ['REJECTED'],
  cancel: ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'],
};

export const TARGET: Record<
  Exclude<PurchaseAction, 'edit'>,
  PurchaseStatusValue
> = {
  submit: 'SUBMITTED',
  approve: 'APPROVED',
  reject: 'REJECTED',
  reopen: 'DRAFT',
  cancel: 'CANCELLED',
};

export function isActionAllowed(
  action: PurchaseAction,
  status: PurchaseStatusValue,
): boolean {
  return ALLOWED[action].includes(status);
}

/**
 * Separation of duties (P3, BR-11): the creator and every user who submitted
 * the order (current or earlier cycles) may never approve or reject it —
 * regardless of role, SYSTEM_ADMIN included.
 */
export function isSelfApproval(
  actorId: string,
  order: { createdById: string; submittedById: string | null },
  earlierSubmitterIds: readonly string[] = [],
): boolean {
  return (
    actorId === order.createdById ||
    actorId === order.submittedById ||
    earlierSubmitterIds.includes(actorId)
  );
}

// ------------------------------------------------------------- lines -----

/** Largest value a Decimal(14,2) column holds. */
export const MAX_MONEY = new Prisma.Decimal('999999999999.99');
export const MAX_LINES = 100;
export const MAX_QUANTITY = 1_000_000;

export interface LineInput {
  productId: string;
  quantity: number;
  unitCost: string;
}

export interface ComputedLine extends LineInput {
  lineNumber: number;
  lineTotal: Prisma.Decimal;
}

/** Product IDs that appear on more than one line (P9). */
export function duplicateProductIds(items: readonly LineInput[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const i of items)
    (seen.has(i.productId) ? dupes : seen).add(i.productId);
  return [...dupes];
}

/**
 * Server-side totals in exact decimal arithmetic. Client totals are never
 * accepted. Returns null when any amount would overflow Decimal(14,2).
 */
export function computeLines(
  items: readonly LineInput[],
): { lines: ComputedLine[]; subtotal: Prisma.Decimal } | null {
  let subtotal = new Prisma.Decimal(0);
  const lines: ComputedLine[] = [];
  items.forEach((item, idx) => {
    const lineTotal = new Prisma.Decimal(item.unitCost).times(item.quantity);
    subtotal = subtotal.plus(lineTotal);
    lines.push({ ...item, lineNumber: idx + 1, lineTotal });
  });
  if (subtotal.gt(MAX_MONEY) || lines.some((l) => l.lineTotal.gt(MAX_MONEY)))
    return null;
  return { lines, subtotal };
}

// --------------------------------------------------------- references -----

export const PO_REFERENCE_PATTERN = /^PO-[A-Z0-9-]{2,20}-\d{4}-\d{6}$/;
export const PO_SEQUENCE_MAX = 999_999;

/** PO-{BRANCHCODE}-{YYYY}-{NNNNNN} (P6). */
export function formatPoReference(
  branchCode: string,
  year: string,
  n: number,
): string {
  if (!Number.isInteger(n) || n < 1 || n > PO_SEQUENCE_MAX) {
    throw new Error(`PO sequence out of range: ${n}`);
  }
  return `PO-${branchCode}-${year}-${String(n).padStart(6, '0')}`;
}

/** Sequence scope: independent per branch and year. */
export function poSequenceScope(branchCode: string, year: string): string {
  return `PO:${branchCode}:${year}`;
}

// --------------------------------------------------------------- TIN -----

/** Tanzanian TIN: 9 digits, often written 123-456-789. */
export function normaliseTin(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function isValidTin(normalised: string): boolean {
  return /^\d{9}$/.test(normalised);
}
