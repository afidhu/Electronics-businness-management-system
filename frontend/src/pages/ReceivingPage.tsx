import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { GoodsReceipt, Purchase, PurchaseItem } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, PageHeader, Spinner } from '../components/ui.tsx'
import { IdempotencyKeys } from '../lib/idempotency.ts'
import { navigate } from '../lib/router.ts'

const keys = new IdempotencyKeys()

/** Orders an inventory officer can receive: APPROVED or PARTIALLY_RECEIVED, in scope. */
export function ReceivingListPage() {
  const { branch, branches } = useSession()
  const [orders, setOrders] = useState<Purchase[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    const branchId = branches.length > 1 ? branch?.id : undefined
    Promise.all(
      (['APPROVED', 'PARTIALLY_RECEIVED'] as const).map((status) =>
        api.get<Purchase[]>('/purchases', { status, branchId, limit: 50 }),
      ),
    )
      .then((rs) => {
        if (cancelled) return
        setOrders(rs.flatMap((r) => r.data).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
      })
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [branch, branches])

  return (
    <>
      <PageHeader title="Receiving" subtitle="Approved purchase orders waiting for delivery" />
      <ErrorAlert error={error} />
      {!orders && !error && <Spinner />}
      {orders && orders.length === 0 && <Empty>No approved orders are waiting to be received.</Empty>}
      {orders && orders.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="receiving-orders">
            <thead>
              <tr>
                <th>Order</th>
                <th>Supplier</th>
                <th>Branch</th>
                <th>Status</th>
                <th className="num">Outstanding units</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.reference}</td>
                  <td>{o.supplier.name}</td>
                  <td>{o.branch.code}</td>
                  <td>
                    <span className="badge">{o.status.replace('_', ' ')}</span>
                  </td>
                  <td className="num">
                    {o.items.reduce((n, i) => n + (i.quantityOrdered - i.quantityReceived), 0)}
                  </td>
                  <td>
                    <a className="btn btn-small btn-primary" href={`#/receiving/${o.id}`} data-testid={`receive-${o.reference}`}>
                      Receive
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

interface LineDraft {
  quantity: string
  /** One array of identifiers per unit (serialized only). */
  units: string[][]
}

function outstanding(i: PurchaseItem) {
  return i.quantityOrdered - i.quantityReceived
}

/** Receive one order: quantities per line and IMEI/serial numbers per unit. */
export function ReceiveOrderPage({ purchaseId }: { purchaseId: string }) {
  const [order, setOrder] = useState<Purchase | null>(null)
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [deliveryRef, setDeliveryRef] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GoodsReceipt | null>(null)

  useEffect(() => {
    api
      .get<Purchase>(`/purchases/${purchaseId}`)
      .then((r) => {
        setOrder(r.data)
        const d: Record<string, LineDraft> = {}
        for (const i of r.data.items) {
          const n = outstanding(i)
          d[i.id] = {
            quantity: String(n),
            units:
              i.trackingMode === 'SERIALIZED'
                ? Array.from({ length: n }, () => Array.from({ length: i.identifiersPerUnit ?? 1 }, () => ''))
                : [],
          }
        }
        setDrafts(d)
      })
      .catch(setError)
  }, [purchaseId])

  const openItems = useMemo(() => order?.items.filter((i) => outstanding(i) > 0) ?? [], [order])

  function setQuantity(item: PurchaseItem, value: string) {
    setFormError(null)
    setDrafts((prev) => {
      const n = Math.max(0, Math.min(outstanding(item), Number.parseInt(value || '0', 10) || 0))
      const cur = prev[item.id]
      const units =
        item.trackingMode === 'SERIALIZED'
          ? Array.from({ length: n }, (_, u) => cur.units[u] ?? Array.from({ length: item.identifiersPerUnit ?? 1 }, () => ''))
          : []
      return { ...prev, [item.id]: { quantity: value, units } }
    })
  }

  function setIdentifier(itemId: string, unit: number, idx: number, value: string) {
    setFormError(null)
    setDrafts((prev) => {
      const units = prev[itemId].units.map((u, i) => (i === unit ? u.map((v, j) => (j === idx ? value : v)) : u))
      return { ...prev, [itemId]: { ...prev[itemId], units } }
    })
  }

  function buildPayload() {
    const items: { purchaseItemId: string; quantity: number; units?: { identifiers: string[] }[] }[] = []
    for (const i of openItems) {
      const d = drafts[i.id]
      const q = Number.parseInt(d.quantity || '0', 10)
      if (!Number.isInteger(q) || q < 0 || q > outstanding(i)) {
        throw new Error(`${i.sku}: quantity must be between 0 and ${outstanding(i)}.`)
      }
      if (q === 0) continue
      if (i.trackingMode === 'SERIALIZED') {
        const units = d.units.slice(0, q).map((ids) => ({ identifiers: ids.map((v) => v.trim()) }))
        if (units.some((u) => u.identifiers.some((v) => !v))) {
          throw new Error(`${i.sku}: enter every ${i.identifierType === 'IMEI' ? 'IMEI' : 'serial number'} for the units received.`)
        }
        items.push({ purchaseItemId: i.id, quantity: q, units })
      } else {
        items.push({ purchaseItemId: i.id, quantity: q })
      }
    }
    if (items.length === 0) throw new Error('Enter at least one received quantity.')
    return {
      items,
      supplierDeliveryRef: deliveryRef.trim() || undefined,
      supplierInvoiceRef: invoiceRef.trim() || undefined,
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setError(null)
    let body
    try {
      body = buildPayload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
      return
    }
    const scope = `receive:${purchaseId}`
    const idempotencyKey = keys.keyFor(scope, body)
    setBusy(true)
    try {
      const r = await api.post<GoodsReceipt>(`/purchases/${purchaseId}/receive`, { ...body, idempotencyKey })
      keys.clear(scope)
      setResult(r.data)
    } catch (err) {
      // Keep the key on network errors so a retry cannot receive twice.
      if (!(err instanceof ApiError && err.isNetworkError)) keys.clear(scope)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (error && !order) return <ErrorAlert error={error} />
  if (!order) return <Spinner />
  if (result) {
    return (
      <>
        <PageHeader title="Goods received" subtitle={`${order.reference} · ${order.supplier.name}`} />
        <Alert kind="success" testId="receive-success">
          Goods receipt <strong className="mono">{result.reference}</strong> recorded. Order status:{' '}
          {result.purchase.status.replace('_', ' ')}.
        </Alert>
        <div className="quick-links">
          <a className="btn btn-primary" href="#/receiving">
            Back to receiving
          </a>
          <a className="btn" href="#/inventory">
            View stock
          </a>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={`Receive ${order.reference}`}
        subtitle={`${order.supplier.name} · ${order.branch.code} ${order.branch.name}`}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/receiving')}>
            Back
          </button>
        }
      />
      <form onSubmit={submit} className="stack" data-testid="receive-form">
        <div className="card grid-2">
          <label className="field">
            <span>Supplier delivery note (optional)</span>
            <input value={deliveryRef} maxLength={100} onChange={(e) => setDeliveryRef(e.target.value)} />
          </label>
          <label className="field">
            <span>Supplier invoice (optional)</span>
            <input value={invoiceRef} maxLength={100} onChange={(e) => setInvoiceRef(e.target.value)} />
          </label>
        </div>
        {openItems.length === 0 && <Empty>Everything on this order has been received.</Empty>}
        {openItems.map((i) => {
          const d = drafts[i.id]
          const q = Number.parseInt(d?.quantity || '0', 10) || 0
          const label = i.identifierType === 'IMEI' ? 'IMEI' : 'Serial number'
          return (
            <fieldset key={i.id} className="card receive-line" data-testid={`receive-line-${i.sku}`}>
              <legend>
                <span className="mono">{i.sku}</span> · {i.productName}
              </legend>
              <div className="receive-qty">
                <label className="field field-inline">
                  <span>Received now</span>
                  <input
                    type="number"
                    min={0}
                    max={outstanding(i)}
                    value={d?.quantity ?? ''}
                    onChange={(e) => setQuantity(i, e.target.value)}
                    data-testid={`receive-qty-${i.sku}`}
                  />
                </label>
                <span className="muted">
                  Ordered {i.quantityOrdered} · already received {i.quantityReceived} · outstanding {outstanding(i)}
                </span>
              </div>
              {i.trackingMode === 'SERIALIZED' && q > 0 && (
                <div className="unit-grid">
                  {d.units.slice(0, q).map((ids, u) => (
                    <div key={u} className="unit-row">
                      <span className="muted small">Unit {u + 1}</span>
                      {ids.map((v, j) => (
                        <input
                          key={j}
                          value={v}
                          placeholder={ids.length > 1 ? `${label} ${j + 1}` : label}
                          inputMode={i.identifierType === 'IMEI' ? 'numeric' : 'text'}
                          aria-label={`${i.sku} unit ${u + 1} ${label} ${j + 1}`}
                          onChange={(e) => setIdentifier(i.id, u, j, e.target.value)}
                          onKeyDown={(e) => {
                            // Scanners send Enter: move to the next field instead of submitting.
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.unit-row input'))
                              const idx = inputs.indexOf(e.currentTarget)
                              inputs[idx + 1]?.focus()
                            }
                          }}
                          data-testid={`ident-${i.sku}-${u}-${j}`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          )
        })}
        {formError && <Alert kind="error" testId="receive-form-error">{formError}</Alert>}
        <ErrorAlert error={error} testId="receive-error" />
        {openItems.length > 0 && (
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="receive-submit">
              {busy ? 'Recording…' : 'Record goods receipt'}
            </button>
          </div>
        )}
      </form>
    </>
  )
}
