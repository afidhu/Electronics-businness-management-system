/**
 * Pure inventory rules (ADR-029, ADR-030). No I/O; unit-tested in isolation.
 */
import { createHash } from 'node:crypto';
import {
  identifierProblem,
  normaliseIdentifier,
  type IdentifierKind,
} from '../catalogue/catalogue-rules';
import { Prisma } from '../generated/prisma/client';

// ---------------------------------------------------------- valuation -----

/** Average cost precision (Decimal 18,4). */
export const AVERAGE_COST_SCALE = 4;

/**
 * Moving weighted-average cost, organisation-wide (ADR-029, I1):
 * new = (onHandBefore × avgBefore + qty × unitCost) / (onHandBefore + qty),
 * rounded half-up to 4 decimals. With no stock before, the receipt cost wins.
 */
export function weightedAverageCost(
  onHandBefore: number,
  averageBefore: Prisma.Decimal | string | null,
  quantityIn: number,
  unitCost: Prisma.Decimal | string,
): Prisma.Decimal {
  if (!Number.isInteger(quantityIn) || quantityIn <= 0) {
    throw new Error('quantityIn must be a positive integer');
  }
  if (!Number.isInteger(onHandBefore) || onHandBefore < 0) {
    throw new Error('onHandBefore must be a non-negative integer');
  }
  const cost = new Prisma.Decimal(unitCost);
  if (onHandBefore === 0 || averageBefore === null) {
    return cost.toDecimalPlaces(
      AVERAGE_COST_SCALE,
      Prisma.Decimal.ROUND_HALF_UP,
    );
  }
  const avg = new Prisma.Decimal(averageBefore);
  return avg
    .times(onHandBefore)
    .plus(cost.times(quantityIn))
    .dividedBy(onHandBefore + quantityIn)
    .toDecimalPlaces(AVERAGE_COST_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

// --------------------------------------------------- separation of duties -----

/**
 * BR-14 (+ I4, I22): the PO's creator, submitter (current or any earlier
 * cycle) and approver can never receive it — whatever their role.
 */
export function isBlockedReceiver(
  actorId: string,
  order: {
    createdById: string;
    submittedById: string | null;
    approvedById: string | null;
  },
  earlierSubmitterIds: readonly string[] = [],
): boolean {
  return (
    actorId === order.createdById ||
    actorId === order.submittedById ||
    actorId === order.approvedById ||
    earlierSubmitterIds.includes(actorId)
  );
}

// ---------------------------------------------------------- idempotency -----

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the canonical request (scope + body without the key). */
export function requestHash(scope: string, body: unknown): string {
  return createHash('sha256')
    .update(`${scope}|${canonicalJson(body)}`)
    .digest('hex');
}

// ------------------------------------------------------- serialized units -----

export interface UnitProblem {
  field: string;
  message: string;
}

/**
 * Normalise and validate the identifiers of one serialized receipt line:
 * exactly `quantity` units with `perUnit` identifiers each, valid format,
 * no repeats within the line (cross-line and DB duplicates are checked by
 * the caller / the database).
 */
export function prepareSerialUnits(
  kind: IdentifierKind,
  perUnit: number,
  quantity: number,
  units: readonly { identifiers: readonly string[] }[] | undefined,
  fieldPrefix: string,
): {
  units: string[][];
  countProblems: UnitProblem[];
  formatProblems: UnitProblem[];
} {
  const countProblems: UnitProblem[] = [];
  const formatProblems: UnitProblem[] = [];
  const list = units ?? [];
  if (list.length !== quantity) {
    countProblems.push({
      field: `${fieldPrefix}.units`,
      message: `expected ${quantity} unit(s), got ${list.length}`,
    });
  }
  const prepared = list.map((u, ui) => {
    if (u.identifiers.length !== perUnit) {
      countProblems.push({
        field: `${fieldPrefix}.units.${ui}.identifiers`,
        message: `each unit needs exactly ${perUnit} ${kind} identifier(s)`,
      });
    }
    return u.identifiers.map((raw, ii) => {
      const value = normaliseIdentifier(kind, raw);
      const problem = identifierProblem(kind, value);
      if (problem) {
        formatProblems.push({
          field: `${fieldPrefix}.units.${ui}.identifiers.${ii}`,
          message: problem,
        });
      }
      return value;
    });
  });
  return { units: prepared, countProblems, formatProblems };
}

/** Values appearing more than once (after normalisation). */
export function repeatedValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

// ---------------------------------------------------------- references -----

export const GRN_REFERENCE_PATTERN = /^GRN-[A-Z0-9-]{2,20}-\d{4}-\d{6}$/;

export function formatGrnReference(
  branchCode: string,
  year: string,
  n: number,
): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) {
    throw new Error(`GRN sequence out of range: ${n}`);
  }
  return `GRN-${branchCode}-${year}-${String(n).padStart(6, '0')}`;
}

export const MAX_UNITS_PER_RECEIPT = 500;
