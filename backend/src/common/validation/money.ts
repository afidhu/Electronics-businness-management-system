import { Prisma } from '../../generated/prisma/client';

/** Scale of all money columns (`Decimal(14,2)`) and money strings in the API. */
export const MONEY_SCALE = 2;

/**
 * Format a database Decimal for API output: a string with exactly two
 * decimal places, e.g. Decimal(1750000) -> "1750000.00" (ADR-011).
 * Arithmetic must stay in Prisma.Decimal; never convert money to `number`.
 */
export function toMoneyString(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(MONEY_SCALE);
}
