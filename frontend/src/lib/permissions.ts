/**
 * Role-based navigation. The UI only HIDES what a user cannot use; the
 * backend enforces every permission and branch rule regardless.
 */
import type { SessionUser } from '../api/types.ts'

export interface NavItem {
  path: string
  label: string
  section: 'Overview' | 'Sales' | 'Inventory' | 'Procurement' | 'Administration' | 'Account'
  /** Visible when the user holds ANY of these (empty = every signed-in user). */
  anyOf: string[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', section: 'Overview', anyOf: [] },
  { path: '/pos', label: 'Point of sale', section: 'Sales', anyOf: ['sales:create'] },
  { path: '/sales', label: 'Sales history', section: 'Sales', anyOf: ['sales:read'] },
  { path: '/summary', label: 'Daily summary', section: 'Sales', anyOf: ['reports:sales'] },
  { path: '/customers', label: 'Customers', section: 'Sales', anyOf: ['customers:read'] },
  { path: '/inventory', label: 'Stock', section: 'Inventory', anyOf: ['inventory:read'] },
  { path: '/receiving', label: 'Receiving', section: 'Inventory', anyOf: ['inventory:receive'] },
  { path: '/catalogue', label: 'Products', section: 'Inventory', anyOf: ['catalogue:read'] },
  { path: '/purchases', label: 'Purchase orders', section: 'Procurement', anyOf: ['procurement:read'] },
  { path: '/suppliers', label: 'Suppliers', section: 'Procurement', anyOf: ['procurement:read'] },
  { path: '/users', label: 'Users', section: 'Administration', anyOf: ['users:read'] },
  { path: '/branches', label: 'Branches', section: 'Administration', anyOf: ['branches:write'] },
  { path: '/settings/vat', label: 'VAT settings', section: 'Administration', anyOf: ['settings:write'] },
  { path: '/audit', label: 'Audit log', section: 'Administration', anyOf: ['audit:read'] },
  { path: '/account', label: 'My account', section: 'Account', anyOf: [] },
]

export function hasPermission(user: SessionUser | null, permission: string): boolean {
  return !!user && user.permissions.includes(permission)
}

export function hasAny(user: SessionUser | null, permissions: readonly string[]): boolean {
  if (!user) return false
  return permissions.length === 0 || permissions.some((p) => user.permissions.includes(p))
}

export function navFor(user: SessionUser | null): NavItem[] {
  return NAV_ITEMS.filter((i) => hasAny(user, i.anyOf))
}

/** Route guard: which permissions a path needs (by its first segments). */
export function canOpen(user: SessionUser | null, path: string): boolean {
  if (!user) return false
  if (path.startsWith('/sales/')) return hasPermission(user, 'sales:read')
  if (path === '/purchases/new') return hasPermission(user, 'procurement:write')
  const item = NAV_ITEMS.find((i) => path === i.path || path.startsWith(`${i.path}/`))
  return item ? hasAny(user, item.anyOf) : true
}

export const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'System administrator',
  MANAGER: 'Manager',
  INVENTORY_OFFICER: 'Inventory officer',
  PROCUREMENT_OFFICER: 'Procurement officer',
  CASHIER: 'Cashier',
  TECHNICIAN: 'Technician',
  AUDITOR: 'Auditor',
}

/** What each role is for (shown when creating users). */
export const ROLE_HELP: Record<string, string> = {
  SYSTEM_ADMIN: 'Full access to every branch, users, branches and VAT.',
  MANAGER: 'Approves purchase orders, changes selling prices, reports; assigned branches.',
  INVENTORY_OFFICER: 'Products, receiving goods and stock for assigned branches.',
  PROCUREMENT_OFFICER: 'Suppliers and purchase orders for assigned branches.',
  CASHIER: 'Point of sale, customers and receipts at exactly one branch.',
  TECHNICIAN: 'Product and customer lookup at one branch (repairs module not yet built).',
  AUDITOR: 'Read-only access to records and the audit log of assigned branches.',
}
