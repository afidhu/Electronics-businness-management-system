import { useEffect, useState, type FormEvent } from 'react'
import type { Pagination, SaleListItem, SalesSummary } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Empty, ErrorAlert, Money, PageHeader, Spinner } from '../components/ui.tsx'
import { METHOD_LABELS, todayInDar } from '../lib/format.ts'

/** Sales history (branch-scoped by the server: S8). */
export function SalesPage() {
  const { branches } = useSession()
  const today = todayInDar()
  const [filters, setFilters] = useState({ from: today, to: today, receiptNumber: '', branchId: '' })
  const [draft, setDraft] = useState(filters)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<SaleListItem[] | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    const receipt = filters.receiptNumber.trim()
    api
      .get<SaleListItem[]>(
        '/sales',
        {
          // A receipt number search ignores the date range.
          from: receipt ? undefined : filters.from || undefined,
          to: receipt ? undefined : filters.to || undefined,
          receiptNumber: receipt || undefined,
          branchId: filters.branchId || undefined,
          page,
          limit: 25,
        },
        ctrl.signal,
      )
      .then((r) => {
        setRows(r.data)
        setPagination(r.meta.pagination ?? null)
        setError(null)
      })
      .catch((e) => !ctrl.signal.aborted && setError(e))
    return () => ctrl.abort()
  }, [filters, page])

  function apply(e: FormEvent) {
    e.preventDefault()
    setPage(1)
    setFilters(draft)
  }

  return (
    <>
      <PageHeader title="Sales history" subtitle="Completed sales in your branches" />
      <form className="toolbar" onSubmit={apply}>
        <label className="field field-inline">
          <span>From</span>
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="field field-inline">
          <span>To</span>
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <input
          placeholder="Receipt number"
          value={draft.receiptNumber}
          onChange={(e) => setDraft({ ...draft, receiptNumber: e.target.value })}
          aria-label="Receipt number"
          data-testid="sales-receipt-filter"
        />
        {branches.length > 1 && (
          <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} aria-label="Branch">
            <option value="">All my branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        )}
        <button className="btn" type="submit" data-testid="sales-apply">
          Apply
        </button>
      </form>
      <ErrorAlert error={error} />
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <Empty>No sales for these filters.</Empty>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="sales-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date / time</th>
                <th>Branch</th>
                <th>Cashier</th>
                <th>Payment</th>
                <th className="num">Lines</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.receiptNumber}</td>
                  <td>{s.businessDateTime}</td>
                  <td>{s.branch.code}</td>
                  <td>{s.cashier.fullName}</td>
                  <td>{s.paymentMethods.map((m) => METHOD_LABELS[m]).join(' + ')}</td>
                  <td className="num">{s.lineCount}</td>
                  <td className="num">
                    <Money value={s.total} />
                  </td>
                  <td>
                    <a className="btn btn-small" href={`#/sales/${s.id}/receipt`}>
                      Receipt
                    </a>
                  </td>
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
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} sales
          </span>
          <button className="btn btn-small" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  )
}

/** Manager's daily summary (S17). Cost and profit appear only if the server sends them. */
export function SummaryPage() {
  const { branches } = useSession()
  const [date, setDate] = useState(todayInDar())
  const [branchId, setBranchId] = useState('')
  const [data, setData] = useState<SalesSummary | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .get<SalesSummary>('/sales/summary', { date, branchId: branchId || undefined }, ctrl.signal)
      .then((r) => {
        setData(r.data)
        setError(null)
      })
      .catch((e) => !ctrl.signal.aborted && setError(e))
    return () => ctrl.abort()
  }, [date, branchId])

  return (
    <>
      <PageHeader title="Daily summary" subtitle={data ? `${data.branches.map((b) => b.code).join(', ')} · ${data.timeZone}` : undefined} />
      <div className="toolbar">
        <label className="field field-inline">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="summary-date" />
        </label>
        {branches.length > 1 && (
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
            <option value="">All my branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorAlert error={error} />
      {!data && !error && <Spinner />}
      {data && (
        <>
          <div className="stat-grid" data-testid="summary-stats">
            <div className="stat">
              <span className="stat-label">Sales</span>
              <span className="stat-value" data-testid="summary-count">{data.saleCount}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Total (incl. VAT)</span>
              <span className="stat-value" data-testid="summary-total"><Money value={data.total} currency={data.currency} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">Net of VAT</span>
              <span className="stat-value"><Money value={data.subtotal} currency={data.currency} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">VAT</span>
              <span className="stat-value"><Money value={data.taxAmount} currency={data.currency} /></span>
            </div>
            <div className="stat">
              <span className="stat-label">Units sold</span>
              <span className="stat-value">{data.unitsSold}</span>
            </div>
            {data.grossProfit !== undefined && (
              <div className="stat">
                <span className="stat-label">Gross profit (net of VAT)</span>
                <span className="stat-value" data-testid="summary-profit"><Money value={data.grossProfit} currency={data.currency} /></span>
              </div>
            )}
          </div>
          <div className="grid-2">
            <div className="card">
              <h2>By payment method</h2>
              <table className="table compact">
                <tbody>
                  {data.byPaymentMethod.map((m) => (
                    <tr key={m.method}>
                      <td>{METHOD_LABELS[m.method]}</td>
                      <td className="num">{m.count}</td>
                      <td className="num"><Money value={m.amount} currency={data.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2>By cashier</h2>
              {data.byCashier.length === 0 ? (
                <Empty>No sales on this day.</Empty>
              ) : (
                <table className="table compact">
                  <tbody>
                    {data.byCashier.map((c) => (
                      <tr key={c.cashier.id}>
                        <td>{c.cashier.fullName ?? '—'}</td>
                        <td className="num">{c.saleCount}</td>
                        <td className="num"><Money value={c.total} currency={data.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
