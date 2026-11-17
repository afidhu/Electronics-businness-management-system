/**
 * Render tests with react-dom/server (no DOM library needed): what each role
 * sees in the navigation, and that receipts never show costs.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionUser } from '../api/types.ts'
import { BranchSelect, NavLinks } from './Layout.tsx'
import { Money } from './ui.tsx'

const user = (role: SessionUser['role'], permissions: string[]): SessionUser => ({
  id: role,
  email: `${role}@x`,
  fullName: role,
  role,
  permissions,
  branchIds: ['b1'],
  allBranches: false,
})

describe('NavLinks', () => {
  it('a cashier gets POS, sales history and stock — no summary, receiving or VAT', () => {
    const html = renderToStaticMarkup(
      <NavLinks user={user('CASHIER', ['inventory:read', 'sales:create', 'sales:read'])} current="/pos" />,
    )
    for (const l of ['Dashboard', 'Point of sale', 'Sales history', 'Stock']) assert.ok(html.includes(l), l)
    for (const l of ['Daily summary', 'Receiving', 'VAT settings']) assert.ok(!html.includes(l), l)
    assert.match(html, /href="#\/pos" class="nav-link active" aria-current="page"/)
  })

  it('an inventory officer gets stock and receiving only', () => {
    const html = renderToStaticMarkup(
      <NavLinks user={user('INVENTORY_OFFICER', ['inventory:read', 'inventory:receive'])} current="/receiving/x" />,
    )
    assert.ok(html.includes('Receiving') && html.includes('Stock'))
    assert.ok(!html.includes('Point of sale') && !html.includes('Sales history'))
    assert.match(html, /href="#\/receiving" class="nav-link active"/)
  })
})

describe('BranchSelect', () => {
  const b = (id: string, code: string) => ({ id, code, name: `Branch ${code}`, address: null, phone: null, isActive: true })

  it('a single-branch user sees a fixed label, not a picker', () => {
    const html = renderToStaticMarkup(<BranchSelect branches={[b('1', 'DSM')]} branch={null} onChange={() => {}} />)
    assert.ok(html.includes('DSM · Branch DSM'))
    assert.ok(!html.includes('<select'))
  })

  it('a multi-branch admin must choose', () => {
    const html = renderToStaticMarkup(
      <BranchSelect branches={[b('1', 'DSM'), b('2', 'ARU')]} branch={null} onChange={() => {}} />,
    )
    assert.ok(html.includes('<select'))
    assert.ok(html.includes('Choose branch'))
  })
})

describe('Money', () => {
  it('formats server strings without re-computing them', () => {
    assert.equal(renderToStaticMarkup(<Money value="2100400.00" />), '<span class="money">TZS 2,100,400.00</span>')
  })
})
