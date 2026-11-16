/**
 * Pure POS pricing (ADR-031, S2, S20). No I/O: shared by the price preview
 * (stage 6.3) and checkout (stage 6.4) so both compute identical totals.
 * Inputs are server-side prices; client prices/totals are never accepted.
 */
import { Prisma } from '../generated/prisma/client';

/** Largest value a Decimal(14,2) column holds. */
export const MAX_MONEY = new Prisma.Decimal('999999999999.99');
export const MAX_SALE_LINES = 50; // S15
export const MAX_LINE_QUANTITY = 1000; // S15

/** Round half-up to 2 decimals (S2). */
export function roundMoney(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface PricedLineInput {
  quantity: number;
  unitPrice: Prisma.Decimal | string;
}

export interface PricedTotals {
  lines: { lineTotal: Prisma.Decimal }[];
  subtotal: Prisma.Decimal;
  taxRatePercent: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * subtotal = Σ quantity × unitPrice; tax = round_half_up(subtotal × rate / 100, 2)
 * on the SUBTOTAL (S2); total = subtotal + tax. Prices are tax-exclusive (D7).
 * Returns null if any amount would overflow Decimal(14,2).
 */
export function priceCart(
  lines: readonly PricedLineInput[],
  ratePercent: Prisma.Decimal | string,
): PricedTotals | null {
  const rate = new Prisma.Decimal(ratePercent);
  if (rate.lt(0) || rate.gt(100))
    throw new Error('tax rate must be within 0–100');
  let subtotal = new Prisma.Decimal(0);
  const priced = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    const lineTotal = new Prisma.Decimal(l.unitPrice).times(l.quantity);
    subtotal = subtotal.plus(lineTotal);
    return { lineTotal };
  });
  const taxAmount = roundMoney(subtotal.times(rate).dividedBy(100));
  const total = subtotal.plus(taxAmount);
  if (
    [subtotal, total, ...priced.map((p) => p.lineTotal)].some((v) =>
      v.gt(MAX_MONEY),
    )
  ) {
    return null;
  }
  return { lines: priced, subtotal, taxRatePercent: rate, taxAmount, total };
}
