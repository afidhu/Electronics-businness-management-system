/**
 * POS cart: WHAT the customer is buying, never prices. Prices and totals are
 * always taken from the server quote (POST /pos/quote) and checkout response.
 */
import type { Identifier, TrackingMode } from '../api/types.ts'

export const MAX_LINES = 50
export const MAX_QUANTITY = 1000

export interface CartProduct {
  id: string
  sku: string
  name: string
  trackingMode: TrackingMode
}

export interface CartLine {
  key: string // productId for quantity lines, unit id for serialized lines
  product: CartProduct
  quantity: number
  unit: { id: string; identifiers: Identifier[] } | null
}

export type CartResult = { ok: true; lines: CartLine[] } | { ok: false; error: string }

export function addQuantity(lines: CartLine[], product: CartProduct, by = 1): CartResult {
  if (product.trackingMode !== 'QUANTITY') {
    return { ok: false, error: 'Choose a specific device for this product.' }
  }
  const existing = lines.find((l) => l.key === product.id)
  if (existing) return setQuantity(lines, product.id, existing.quantity + by)
  if (lines.length >= MAX_LINES) return { ok: false, error: `A sale can have at most ${MAX_LINES} lines.` }
  return { ok: true, lines: [...lines, { key: product.id, product, quantity: by, unit: null }] }
}

export function addUnit(
  lines: CartLine[],
  product: CartProduct,
  unit: { id: string; identifiers: Identifier[] },
): CartResult {
  if (lines.some((l) => l.key === unit.id)) {
    return { ok: false, error: 'This device is already in the cart.' }
  }
  if (lines.length >= MAX_LINES) return { ok: false, error: `A sale can have at most ${MAX_LINES} lines.` }
  return { ok: true, lines: [...lines, { key: unit.id, product, quantity: 1, unit }] }
}

export function setQuantity(lines: CartLine[], key: string, quantity: number): CartResult {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return { ok: false, error: `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.` }
  }
  const line = lines.find((l) => l.key === key)
  if (!line) return { ok: false, error: 'Line not found.' }
  if (line.unit) return { ok: false, error: 'A device line always has quantity 1.' }
  return { ok: true, lines: lines.map((l) => (l.key === key ? { ...l, quantity } : l)) }
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key)
}

/** The request items for quote and checkout: ids and quantities only. */
export function toRequestItems(lines: CartLine[]) {
  return lines.map((l) =>
    l.unit
      ? { productId: l.product.id, unitId: l.unit.id }
      : { productId: l.product.id, quantity: l.quantity },
  )
}
