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

export const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'MOBILE_MONEY',
  'BANK_TRANSFER',
] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number];
export const MAX_PAYMENTS = 5;

export interface PaymentInput {
  method: PaymentMethodKey;
  amount: string;
  amountTendered?: string;
  reference?: string;
}

export interface SettledPayment {
  method: PaymentMethodKey;
  amount: Prisma.Decimal;
  amountTendered: Prisma.Decimal | null;
  reference: string | null;
}

export type Settlement =
  | { ok: true; payments: SettledPayment[]; changeGiven: Prisma.Decimal }
  | { ok: false; field: string; message: string; mismatch: boolean };

/**
 * Payment rules (S4): every amount > 0; Σ amounts = total exactly (no credit,
 * no overpayment); cash may carry amountTendered ≥ amount and change =
 * Σ (tendered − amount); only cash takes a tendered amount; MOBILE_MONEY and
 * BANK_TRANSFER need a reference. Mirrors the DB CHECK and deferred trigger.
 */
export function settlePayments(
  total: Prisma.Decimal,
  payments: readonly PaymentInput[],
): Settlement {
  const out: SettledPayment[] = [];
  let sum = new Prisma.Decimal(0);
  let change = new Prisma.Decimal(0);
  for (const [i, p] of payments.entries()) {
    const f = `payments.${i}`;
    const amount = new Prisma.Decimal(p.amount);
    if (amount.lte(0)) {
      return {
        ok: false,
        field: `${f}.amount`,
        message: 'amount must be greater than 0',
        mismatch: false,
      };
    }
    let tendered: Prisma.Decimal | null = null;
    if (p.amountTendered !== undefined) {
      if (p.method !== 'CASH') {
        return {
          ok: false,
          field: `${f}.amountTendered`,
          message: 'only cash payments take an amount tendered',
          mismatch: false,
        };
      }
      tendered = new Prisma.Decimal(p.amountTendered);
      if (tendered.lt(amount)) {
        return {
          ok: false,
          field: `${f}.amountTendered`,
          message: 'amount tendered cannot be less than the amount',
          mismatch: false,
        };
      }
      change = change.plus(tendered.minus(amount));
    }
    const reference = p.reference?.trim() || null;
    if (
      (p.method === 'MOBILE_MONEY' || p.method === 'BANK_TRANSFER') &&
      !reference
    ) {
      return {
        ok: false,
        field: `${f}.reference`,
        message: `a reference is required for ${p.method}`,
        mismatch: false,
      };
    }
    sum = sum.plus(amount);
    out.push({ method: p.method, amount, amountTendered: tendered, reference });
  }
  if (!sum.equals(total)) {
    return {
      ok: false,
      field: 'payments',
      message: `payments total ${sum.toFixed(2)} must equal the sale total ${total.toFixed(2)}`,
      mismatch: true,
    };
  }
  if (change.gt(MAX_MONEY)) {
    return {
      ok: false,
      field: 'payments',
      message: 'amount tendered is too large',
      mismatch: false,
    };
  }
  return { ok: true, payments: out, changeGiven: change };
}

/** Receipt number (S5): RCT-{BRANCH}-{YYYY}-{NNNNNN}. */
export function formatReceiptNumber(
  branchCode: string,
  year: string,
  n: number,
): string {
  if (!Number.isInteger(n) || n < 1 || n > 999999) {
    throw new Error('receipt sequence out of range');
  }
  return `RCT-${branchCode}-${year}-${String(n).padStart(6, '0')}`;
}

/** Sale-line cost for the ledger: WAC (4 dp) rounded half-up to the 2-dp movement column. */
export function ledgerUnitCost(averageCost: Prisma.Decimal): Prisma.Decimal {
  return averageCost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
