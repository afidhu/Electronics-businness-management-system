import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SessionUser } from '../api/types.ts'
import { addQuantity, addUnit, removeLine, setQuantity, toRequestItems, type CartLine } from './cart.ts'
import { IdempotencyKeys, canonicalJson, type KeyValueStore } from './idempotency.ts'
import { formatMoney, fromCents, groupDigits, isMoney, paymentProgress, toCents } from './money.ts'
import { canOpen, navFor } from './permissions.ts'
import { matchPath, parseHash } from './router.ts'

// ------------------------------------------------------------------ money
describe('money display helpers (no floating point)', () => {
  it('parses and formats exact decimal strings', () => {
    assert.equal(toCents('1750000'), 175000000n)
    assert.equal(toCents('0.1'), 10n)
    assert.equal(fromCents(210040000n), '2100400.00')
    assert.equal(fromCents(-60000n), '-600.00')
    assert.equal(groupDigits('2100400.00'), '2,100,400.00')
    assert.equal(formatMoney('2100400.00'), 'TZS 2,100,400.00')
    assert.equal(formatMoney(null), '—')
    assert.equal(isMoney('1.234'), false)
    assert.equal(isMoney('-1'), false)
    assert.throws(() => toCents('abc'))
  })

  it('payment progress for the demo split: mobile money + cash with change', () => {
    const p = paymentProgress('2100400.00', [
      { method: 'MOBILE_MONEY', amount: '1500000' },
      { method: 'CASH', amount: '600400', amountTendered: '601000' },
    ])
    assert.deepEqual(p, { paid: '2100400.00', remaining: '0.00', change: '600.00', exact: true })
  })

  it('shows what is still due or over-paid; ignores invalid amounts', () => {
    assert.equal(paymentProgress('100.00', [{ method: 'CARD', amount: '40' }]).remaining, '60.00')
    assert.equal(paymentProgress('100.00', [{ method: 'CARD', amount: '150' }]).remaining, '-50.00')
    assert.equal(paymentProgress('100.00', [{ method: 'CARD', amount: 'x' }]).remaining, '100.00')
    // 0.1 + 0.2 is exact here (it is not in floating point).
    assert.equal(paymentProgress('0.30', [{ method: 'CASH', amount: '0.1' }, { method: 'CASH', amount: '0.2' }]).exact, true)
  })
})

// ------------------------------------------------------------------- cart
const cable = { id: 'p-cable', sku: 'CABLE', name: 'Cable', trackingMode: 'QUANTITY' as const }
const laptop = { id: 'p-laptop', sku: 'LAPTOP', name: 'Laptop', trackingMode: 'SERIALIZED' as const }
const unit = (id: string) => ({ id, identifiers: [{ type: 'SERIAL' as const, value: id.toUpperCase(), isPrimary: true }] })
const ok = (r: ReturnType<typeof addQuantity>): CartLine[] => {
  assert.ok(r.ok, r.ok ? '' : r.error)
  return r.lines
}

describe('cart (identities and quantities only — never prices)', () => {
  it('adds quantity lines, merging repeats; adds each device once', () => {
    let lines = ok(addQuantity([], cable))
    lines = ok(addQuantity(lines, cable))
    lines = ok(addUnit(lines, laptop, unit('u1')))
    assert.equal(lines.length, 2)
    assert.equal(lines[0].quantity, 2)
    const again = addUnit(lines, laptop, unit('u1'))
    assert.equal(again.ok, false)
    assert.equal(addQuantity(lines, laptop).ok, false, 'a serialized product needs a chosen device')
  })

  it('validates quantities (1–1000, whole numbers) and keeps devices at 1', () => {
    const lines = ok(addUnit(ok(addQuantity([], cable)), laptop, unit('u1')))
    assert.equal(setQuantity(lines, 'p-cable', 0).ok, false)
    assert.equal(setQuantity(lines, 'p-cable', 1001).ok, false)
    assert.equal(setQuantity(lines, 'p-cable', 1.5).ok, false)
    assert.equal(setQuantity(lines, 'u1', 2).ok, false)
    assert.equal(ok(setQuantity(lines, 'p-cable', 5))[0].quantity, 5)
    assert.equal(removeLine(lines, 'u1').length, 1)
  })

  it('request items carry no price, total or tax field', () => {
    const lines = ok(addUnit(ok(addQuantity([], cable)), laptop, unit('u1')))
    const items = toRequestItems(lines)
    assert.deepEqual(items, [
      { productId: 'p-cable', quantity: 1 },
      { productId: 'p-laptop', unitId: 'u1' },
    ])
    assert.ok(!/price|total|tax|cost/i.test(JSON.stringify(items)))
  })
})

// ------------------------------------------------------------- idempotency
function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

describe('idempotency keys for checkout retries', () => {
  let seq = 0
  const gen = () => `key-${++seq}`
  const payload = { items: [{ productId: 'p', quantity: 1 }], payments: [{ method: 'CASH', amount: '17700' }] }

  it('a retry of the same payload reuses the key (no duplicate sale)', () => {
    const k = new IdempotencyKeys(memory(), gen)
    assert.equal(k.keyFor('checkout', payload), k.keyFor('checkout', structuredClone(payload)))
  })

  it('field order does not matter; a changed payload gets a new key', () => {
    const k = new IdempotencyKeys(memory(), gen)
    const a = k.keyFor('checkout', payload)
    const reordered = { payments: payload.payments, items: payload.items }
    assert.equal(k.keyFor('checkout', reordered), a)
    assert.notEqual(k.keyFor('checkout', { ...payload, payments: [{ method: 'CARD', amount: '17700' }] }), a)
  })

  it('survives a page reload (same tab storage); cleared after success', () => {
    const store = memory()
    const first = new IdempotencyKeys(store, gen).keyFor('checkout', payload)
    const afterReload = new IdempotencyKeys(store, gen)
    assert.equal(afterReload.keyFor('checkout', payload), first)
    afterReload.clear('checkout')
    assert.notEqual(afterReload.keyFor('checkout', payload), first)
    assert.ok(![...store.data.values()].some((v) => /token|password/i.test(v)))
  })

  it('scopes are independent (checkout vs receiving a purchase order)', () => {
    const k = new IdempotencyKeys(memory(), gen)
    assert.notEqual(k.keyFor('checkout', payload), k.keyFor('receive:po-1', payload))
  })

  it('canonical JSON drops undefined and sorts keys', () => {
    assert.equal(canonicalJson({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] }), '{"b":1,"c":[{"y":2,"z":1}]}')
  })
})

// ------------------------------------------------- navigation per role
// Navigation-relevant permissions per role, as returned by GET /roles (seeded RBAC).
const ROLE_PERMS: Record<string, string[]> = {
  SYSTEM_ADMIN: ['catalogue:cost_read', 'inventory:read', 'inventory:receive', 'reports:sales', 'sales:create', 'sales:read', 'settings:write'],
  MANAGER: ['catalogue:cost_read', 'inventory:read', 'reports:sales', 'sales:read'],
  CASHIER: ['inventory:read', 'sales:create', 'sales:read'],
  INVENTORY_OFFICER: ['catalogue:cost_read', 'inventory:read', 'inventory:receive'],
  PROCUREMENT_OFFICER: ['catalogue:cost_read', 'inventory:read', 'inventory:receive'],
  AUDITOR: ['catalogue:cost_read', 'inventory:read', 'reports:sales', 'sales:read'],
  TECHNICIAN: [],
}
const userWith = (role: string): SessionUser => ({
  id: role,
  email: `${role}@x`,
  fullName: role,
  role: role as SessionUser['role'],
  permissions: ROLE_PERMS[role],
  branchIds: ['b1'],
  allBranches: role === 'SYSTEM_ADMIN',
})

describe('role-based navigation', () => {
  const labels = (role: string) => navFor(userWith(role)).map((i) => i.label)

  for (const [role, expected] of Object.entries({
    SYSTEM_ADMIN: ['Dashboard', 'Point of sale', 'Sales history', 'Daily summary', 'Stock', 'Receiving', 'VAT settings'],
    MANAGER: ['Dashboard', 'Sales history', 'Daily summary', 'Stock'],
    CASHIER: ['Dashboard', 'Point of sale', 'Sales history', 'Stock'],
    INVENTORY_OFFICER: ['Dashboard', 'Stock', 'Receiving'],
    PROCUREMENT_OFFICER: ['Dashboard', 'Stock', 'Receiving'],
    AUDITOR: ['Dashboard', 'Sales history', 'Daily summary', 'Stock'],
    TECHNICIAN: ['Dashboard'],
  })) {
    it(`${role} sees: ${expected.join(', ')}`, () => {
      assert.deepEqual(labels(role), expected)
    })
  }

  it('route guard mirrors navigation (deep links are refused too)', () => {
    const cashier = userWith('CASHIER')
    assert.equal(canOpen(cashier, '/pos'), true)
    assert.equal(canOpen(cashier, '/sales/abc/receipt'), true)
    assert.equal(canOpen(cashier, '/summary'), false)
    assert.equal(canOpen(cashier, '/settings/vat'), false)
    assert.equal(canOpen(cashier, '/receiving/po-1'), false)
    assert.equal(canOpen(userWith('MANAGER'), '/pos'), false)
    assert.equal(canOpen(userWith('TECHNICIAN'), '/sales/abc/receipt'), false)
    assert.equal(canOpen(null, '/dashboard'), false)
  })
})

// ---------------------------------------------------------------- router
describe('hash router', () => {
  it('parses paths and queries; matches params', () => {
    const r = parseHash('#/sales/abc-1/receipt?new=1')
    assert.equal(r.path, '/sales/abc-1/receipt')
    assert.equal(r.query.get('new'), '1')
    assert.equal(parseHash('').path, '/')
    assert.deepEqual(matchPath('/sales/:id/receipt', r.path), { id: 'abc-1' })
    assert.equal(matchPath('/sales/:id/receipt', '/sales/abc'), null)
  })
})
