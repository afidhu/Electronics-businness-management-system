import { useEffect, useState } from 'react'
import type { Pagination, StockBalance } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Empty, ErrorAlert, PageHeader, Spinner } from '../components/ui.tsx'
import { useDebounced } from '../lib/hooks.ts'

/**
 * Branch stock (FR-INV-07). Quantities only: cost columns are never shown
 * here, whatever the role (cashiers also lack catalogue:cost_read).
 */
export function InventoryPage({ initialLowStock = false }: { initialLowStock?: boolean }) {
  const { branches } = useSession()
  const [q, setQ] = useState('')
  const [branchId, setBranchId] = useState('')
  const [lowStock, setLowStock] = useState(initialLowStock)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<StockBalance[] | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [error, setError] = useState<unknown>(null)
  const query = useDebounced(q)

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .get<StockBalance[]>(
        '/inventory/balances',
        { q: query.trim() || undefined, branchId: branchId || undefined, lowStock: lowStock || undefined, page, limit: 25 },
        ctrl.signal,
      )
      .then((r) => {
        setRows(r.data)
        setPagination(r.meta.pagination ?? null)
        setError(null)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e)
      })
    return () => ctrl.abort()
  }, [query, branchId, lowStock, page])

  return (
    <>
      <PageHeader title="Stock" subtitle="On-hand and available quantities by branch" />
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search product name or SKU"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          data-testid="stock-search"
          aria-label="Search products"
        />
        {branches.length > 1 && (
          <select value={branchId} onChange={(e) => {
            setBranchId(e.target.value)
            setPage(1)
          }} aria-label="Branch">
            <option value="">All my branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={lowStock} onChange={(e) => {
            setLowStock(e.target.checked)
            setPage(1)
          }} />
          Low stock only
        </label>
      </div>
      <ErrorAlert error={error} />
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <Empty>No stock records match.</Empty>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="stock-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Branch</th>
                <th className="num">On hand</th>
                <th className="num">Available</th>
                <th className="num">Reorder at</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.product.id}-${r.branch.id}`}>
                  <td className="mono">{r.product.sku}</td>
                  <td>
                    {r.product.name}
                    {r.product.trackingMode === 'SERIALIZED' && <span className="tag">IMEI/serial</span>}
                  </td>
                  <td>{r.branch.code}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num">{r.available}</td>
                  <td className="num">{r.reorderLevel}</td>
                  <td>{r.lowStock ? <span className="badge badge-warn">Low</span> : <span className="badge badge-ok">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && pagination.totalPages > 1 && (
        <div className="pager">
          <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button className="btn btn-small" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  )
}
