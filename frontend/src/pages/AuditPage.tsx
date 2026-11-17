import { useState } from 'react'
import type { AuditEntry } from '../api/types.ts'
import { Empty, ErrorAlert, PageHeader, Pager, Spinner } from '../components/ui.tsx'
import { useApi, useDebounced } from '../lib/hooks.ts'

const ENTITY_TYPES = ['User', 'Branch', 'Product', 'Category', 'Brand', 'Supplier', 'Purchase', 'GoodsReceipt', 'Sale', 'Customer', 'TaxSetting']

/** Audit log (audit:read). The server scopes entries to the reader's branches; login events are admin-only. */
export function AuditPage() {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const actionQ = useDebounced(action)
  const list = useApi<AuditEntry[]>('/audit-logs', {
    action: actionQ.trim() || undefined,
    entityType: entityType || undefined,
    from: from ? new Date(`${from}T00:00:00+03:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999+03:00`).toISOString() : undefined,
    page,
    limit: 50,
  })
  const reset = () => setPage(1)

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, when — append-only" />
      <div className="toolbar">
        <input
          placeholder="Action (e.g. sale.completed)"
          value={action}
          onChange={(e) => {
            setAction(e.target.value)
            reset()
          }}
          aria-label="Action"
          data-testid="audit-action"
        />
        <select
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value)
            reset()
          }}
          aria-label="Record type"
        >
          <option value="">All record types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="field field-inline">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset() }} />
        </label>
        <label className="field field-inline">
          <span>To</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset() }} />
        </label>
      </div>
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No audit entries match.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Record</th>
                <th>By</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="mono">{a.action}</td>
                  <td>
                    {a.entityType}
                    {a.entityId && <span className="muted small mono"> {a.entityId.slice(0, 8)}</span>}
                  </td>
                  <td>{a.actor?.fullName ?? 'System'}</td>
                  <td>
                    {a.metadata ? (
                      open === a.id ? (
                        <pre className="json">{JSON.stringify(a.metadata, null, 2)}</pre>
                      ) : (
                        <button className="btn btn-small btn-ghost" onClick={() => setOpen(a.id)}>
                          Show
                        </button>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.pagination} page={page} onPage={setPage} />
    </>
  )
}
