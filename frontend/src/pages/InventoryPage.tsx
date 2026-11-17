import { useEffect, useState } from 'react'
import type { Pagination, StockBalance } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import type { Movement, UnitRecord, Valuation } from '../api/types.ts'
import { Empty, ErrorAlert, Money, PageHeader, Pager, Spinner, Tabs } from '../components/ui.tsx'
import { useApi, useDebounced } from '../lib/hooks.ts'
import { hasPermission } from '../lib/permissions.ts'

/**
 * Branch stock (FR-INV-07). Quantities only: cost columns are never shown
 * here, whatever the role (cashiers also lack catalogue:cost_read).
 */
function BalancesTab({ initialLowStock = false }: { initialLowStock?: boolean }) {
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

type StockTab = 'balances' | 'movements' | 'devices' | 'valuation'

/** Stock (Module 5): balances, ledger movements, individual devices and (cost roles) valuation. */
export function InventoryPage({ initialLowStock = false }: { initialLowStock?: boolean }) {
  const { user } = useSession()
  const canValue = hasPermission(user, 'reports:inventory') && hasPermission(user, 'catalogue:cost_read')
  const [tab, setTab] = useState<StockTab>('balances')
  return (
    <>
      <PageHeader title="Stock" subtitle="Quantities by branch, the stock ledger and individual devices" />
      <Tabs
        tabs={[
          { key: 'balances' as const, label: 'Balances' },
          { key: 'movements' as const, label: 'Movements' },
          { key: 'devices' as const, label: 'Devices (IMEI/serial)' },
          ...(canValue ? [{ key: 'valuation' as const, label: 'Valuation' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'balances' && <BalancesTab initialLowStock={initialLowStock} />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'devices' && <DevicesTab />}
      {tab === 'valuation' && canValue && <ValuationTab />}
    </>
  )
}

function BranchFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { branches } = useSession()
  if (branches.length <= 1) return null
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Branch">
      <option value="">All my branches</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.code}
        </option>
      ))}
    </select>
  )
}

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: 'Goods received',
  SALE: 'Sale',
  OPENING_BALANCE: 'Opening balance',
  ADJUSTMENT_INCREASE: 'Adjustment +',
  ADJUSTMENT_DECREASE: 'Adjustment −',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
}

/** The append-only stock ledger. Costs appear only if the server sends them (cost roles). */
function MovementsTab() {
  const [branchId, setBranchId] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const list = useApi<Movement[]>('/inventory/movements', { branchId: branchId || undefined, type: type || undefined, page, limit: 25 })
  const showCost = list.data?.some((m) => m.unitCost !== undefined) ?? false
  return (
    <>
      <div className="toolbar">
        <BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1) }} />
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} aria-label="Movement type">
          <option value="">All movements</option>
          <option value="PURCHASE_RECEIPT">Goods received</option>
          <option value="SALE">Sales</option>
        </select>
      </div>
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No stock movements yet.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="movements-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>SKU</th>
                <th>Branch</th>
                <th className="num">Qty</th>
                {showCost && <th className="num">Unit cost</th>}
                {showCost && <th className="num">Value</th>}
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.createdAt).toLocaleString()}</td>
                  <td>{MOVEMENT_LABELS[m.movementType] ?? m.movementType}</td>
                  <td className="mono">{m.sku}</td>
                  <td>{m.branchCode}</td>
                  <td className={`num ${m.quantityDelta < 0 ? 'warn' : 'ok'}`}>{m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}</td>
                  {showCost && <td className="num"><Money value={m.unitCost} /></td>}
                  {showCost && <td className="num"><Money value={m.valueDelta} /></td>}
                  <td>{m.actor?.fullName ?? '—'}</td>
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

/** Individual serialized devices with their IMEI/serial and status. */
function DevicesTab() {
  const [branchId, setBranchId] = useState('')
  const [status, setStatus] = useState('IN_STOCK')
  const [page, setPage] = useState(1)
  const [lookup, setLookup] = useState('')
  const term = useDebounced(lookup.trim(), 400)
  const list = useApi<UnitRecord[]>('/inventory/units', { branchId: branchId || undefined, status: status || undefined, page, limit: 25 })
  const found = useApi<UnitRecord>(term.length >= 4 ? '/inventory/units/lookup' : null, { identifier: term })
  const rows = term.length >= 4 ? (found.data ? [found.data] : []) : list.data
  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Find by IMEI or serial"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          aria-label="Find device by IMEI or serial"
          data-testid="device-lookup"
        />
        <BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1) }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Status">
          <option value="IN_STOCK">In stock</option>
          <option value="SOLD">Sold</option>
          <option value="">All statuses</option>
        </select>
      </div>
      {term.length >= 4 && <ErrorAlert error={found.error} />}
      {term.length < 4 && <ErrorAlert error={list.error} />}
      {((term.length >= 4 && found.loading) || (term.length < 4 && list.loading && !list.data)) && <Spinner />}
      {rows && rows.length === 0 && !found.loading && <Empty>No devices match.</Empty>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="devices-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>IMEI / serial</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.product.name} <span className="muted small mono">{u.product.sku}</span>
                  </td>
                  <td className="mono">{u.identifiers.map((i) => i.value).join(' / ')}</td>
                  <td>{u.branch.code}</td>
                  <td>
                    <span className={u.status === 'IN_STOCK' ? 'badge badge-ok' : 'badge'}>{u.status.replace('_', ' ')}</span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {term.length < 4 && <Pager pagination={list.pagination} page={page} onPage={setPage} />}
    </>
  )
}

/** Moving weighted-average valuation (managers/auditors/admin: reports:inventory + cost read). */
function ValuationTab() {
  const [branchId, setBranchId] = useState('')
  const v = useApi<Valuation>('/inventory/valuation', { branchId: branchId || undefined })
  return (
    <>
      <div className="toolbar">
        <BranchFilter value={branchId} onChange={setBranchId} />
      </div>
      <ErrorAlert error={v.error} />
      {v.loading && !v.data && <Spinner />}
      {v.data && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label">Stock value (at average cost)</span>
              <span className="stat-value" data-testid="valuation-total"><Money value={v.data.totals.totalValue} currency={v.data.currency} /></span>
            </div>
          </div>
          {v.data.lines.length === 0 ? (
            <Empty>No stock on hand.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table" data-testid="valuation-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>SKU</th>
                    <th className="num">On hand</th>
                    <th className="num">Average cost</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {v.data.lines.map((l) => (
                    <tr key={`${l.branch.id}-${l.product.id}`}>
                      <td>{l.branch.code}</td>
                      <td className="mono">{l.product.sku}</td>
                      <td className="num">{l.onHand}</td>
                      <td className="num">{l.averageCost}</td>
                      <td className="num"><Money value={l.value} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
