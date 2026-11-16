import { useEffect, useState } from 'react'
import type { Purchase, SaleListItem, SalesSummary, StockBalance } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { ErrorAlert, Money, PageHeader, Spinner } from '../components/ui.tsx'
import { todayInDar } from '../lib/format.ts'
import { hasPermission, ROLE_LABELS } from '../lib/permissions.ts'

interface Stats {
  summary?: SalesSummary
  todaySales?: number
  lowStock?: number
  toReceive?: number
}

export function DashboardPage() {
  const { user, branch, branches } = useSession()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const today = todayInDar()
    const branchId = branches.length > 1 ? branch?.id : undefined
    const jobs: Promise<void>[] = []
    const next: Stats = {}
    if (hasPermission(user, 'reports:sales')) {
      jobs.push(
        api.get<SalesSummary>('/sales/summary', { date: today, branchId }).then((r) => {
          next.summary = r.data
        }),
      )
    } else if (hasPermission(user, 'sales:read')) {
      jobs.push(
        api.get<SaleListItem[]>('/sales', { from: today, to: today, limit: 1, branchId }).then((r) => {
          next.todaySales = r.meta.pagination?.total ?? 0
        }),
      )
    }
    if (hasPermission(user, 'inventory:read')) {
      jobs.push(
        api.get<StockBalance[]>('/inventory/balances', { lowStock: true, limit: 1, branchId }).then((r) => {
          next.lowStock = r.meta.pagination?.total ?? 0
        }),
      )
    }
    if (hasPermission(user, 'inventory:receive')) {
      jobs.push(
        api.get<Purchase[]>('/purchases', { status: 'APPROVED', limit: 1, branchId }).then((r) => {
          next.toReceive = r.meta.pagination?.total ?? 0
        }),
      )
    }
    Promise.all(jobs)
      .then(() => !cancelled && setStats(next))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [user, branch, branches])

  if (!user) return null
  const s = stats?.summary
  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName.split(' ')[0]}`}
        subtitle={`${ROLE_LABELS[user.role] ?? user.role}${branch ? ` · ${branch.code} ${branch.name}` : ''} · ${todayInDar()}`}
      />
      <ErrorAlert error={error} />
      {!stats && !error && <Spinner />}
      {stats && (
        <div className="stat-grid" data-testid="dashboard-stats">
          {s && (
            <>
              <div className="stat">
                <span className="stat-label">Sales today</span>
                <span className="stat-value" data-testid="stat-sales-count">{s.saleCount}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Revenue today (incl. VAT)</span>
                <span className="stat-value"><Money value={s.total} /></span>
              </div>
              <div className="stat">
                <span className="stat-label">VAT collected</span>
                <span className="stat-value"><Money value={s.taxAmount} /></span>
              </div>
              <div className="stat">
                <span className="stat-label">Units sold</span>
                <span className="stat-value">{s.unitsSold}</span>
              </div>
            </>
          )}
          {stats.todaySales !== undefined && (
            <div className="stat">
              <span className="stat-label">Sales today (your branch)</span>
              <span className="stat-value" data-testid="stat-sales-count">{stats.todaySales}</span>
            </div>
          )}
          {stats.lowStock !== undefined && (
            <a className="stat stat-link" href="#/inventory?lowStock=1">
              <span className="stat-label">Low-stock products</span>
              <span className="stat-value">{stats.lowStock}</span>
            </a>
          )}
          {stats.toReceive !== undefined && (
            <a className="stat stat-link" href="#/receiving">
              <span className="stat-label">Orders ready to receive</span>
              <span className="stat-value">{stats.toReceive}</span>
            </a>
          )}
        </div>
      )}
      <div className="quick-links">
        {hasPermission(user, 'sales:create') && <a className="btn btn-primary" href="#/pos">New sale</a>}
        {hasPermission(user, 'inventory:receive') && <a className="btn" href="#/receiving">Receive goods</a>}
        {hasPermission(user, 'sales:read') && <a className="btn" href="#/sales">Sales history</a>}
        {hasPermission(user, 'inventory:read') && <a className="btn" href="#/inventory">Stock</a>}
      </div>
    </>
  )
}
