/**
 * Money DISPLAY helpers. Amounts are decimal strings from the server and are
 * never turned into floating-point numbers. The frontend never computes an
 * authoritative price or total: the only arithmetic here is the cashier's
 * "still to pay" / "change" hint while typing payments, done in integer
 * cents; the server re-validates every payment.
 */

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/

/** True for a valid non-negative amount with at most 2 decimals. */
export function isMoney(value: string): boolean {
  return MONEY_RE.test(value.trim())
}

/** "1750000.5" → 175000050n cents. Throws on invalid input. */
export function toCents(value: string): bigint {
  const v = value.trim()
  if (!isMoney(v)) throw new Error(`invalid amount: ${value}`)
  const [whole, frac = ''] = v.split('.')
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2))
}

/** 175000050n → "1750000.50" (negative values keep a leading minus). */
export function fromCents(cents: bigint): string {
  const neg = cents < 0n
  const abs = neg ? -cents : cents
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, '0')
  return `${neg ? '-' : ''}${whole}.${frac}`
}

/** "2100400.00" → "2,100,400.00" (grouping only; no rounding). */
export function groupDigits(value: string): string {
  const [whole, frac] = value.split('.')
  const neg = whole.startsWith('-')
  const digits = neg ? whole.slice(1) : whole
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`
}

/** "2100400.00" → "TZS 2,100,400.00". */
export function formatMoney(value: string | null | undefined, currency = 'TZS'): string {
  if (value === null || value === undefined || value === '') return '—'
  return `${currency} ${groupDigits(value)}`
}

/**
 * Payment hint while the cashier types: how much is still due and the
 * change for cash. Invalid amounts are ignored (the form flags them).
 */
export function paymentProgress(
  total: string,
  payments: { method: string; amount: string; amountTendered?: string }[],
): { paid: string; remaining: string; change: string; exact: boolean } {
  let paid = 0n
  let change = 0n
  for (const p of payments) {
    if (!isMoney(p.amount)) continue
    const amount = toCents(p.amount)
    paid += amount
    if (p.method === 'CASH' && p.amountTendered && isMoney(p.amountTendered)) {
      const tendered = toCents(p.amountTendered)
      if (tendered > amount) change += tendered - amount
    }
  }
  const remaining = toCents(total) - paid
  return {
    paid: fromCents(paid),
    remaining: fromCents(remaining),
    change: fromCents(change),
    exact: remaining === 0n,
  }
}
