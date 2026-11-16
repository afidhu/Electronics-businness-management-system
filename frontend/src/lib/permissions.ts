/**
 * Role-based navigation. The UI only HIDES what a user cannot use; the
 * backend enforces every permission and branch rule regardless.
 */
import type { SessionUser } from '../api/types.ts'

export interface NavItem {
  path: string
  label: string
  /** Visible when the user holds ANY of these (empty = every signed-in user). */
  anyOf: string[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', anyOf: [] },
  { path: '/pos', label: 'Point of sale', anyOf: ['sales:create'] },
  { path: '/sales', label: 'Sales history', anyOf: ['sales:read'] },
  { path: '/summary', label: 'Daily summary', anyOf: ['reports:sales'] },
  { path: '/inventory', label: 'Stock', anyOf: ['inventory:read'] },
  { path: '/receiving', label: 'Receiving', anyOf: ['inventory:receive'] },
  { path: '/settings/vat', label: 'VAT settings', anyOf: ['settings:write'] },
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
