import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { Product, PurchaseDetail, PurchaseStatus, Supplier } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, Field, Modal, Money, PageHeader, Pager, Spinner } from '../components/ui.tsx'
import { useApi, useDebounced } from '../lib/hooks.ts'
import { isMoney } from '../lib/money.ts'
import { hasPermission } from '../lib/permissions.ts'
import { navigate } from '../lib/router.ts'

const STATUSES: PurchaseStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED']
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')
const statusClass = (s: string) =>
  s === 'APPROVED' || s === 'RECEIVED' ? 'badge badge-ok' : s === 'REJECTED' || s === 'CANCELLED' ? 'badge badge-warn' : 'badge'

/** Purchase orders (Module 4): procurement creates/submits; managers approve (never their own: BR-13). */
export function PurchasesPage() {
  const { user, branch, branches } = useSession()
  const canWrite = hasPermission(user, 'procurement:write')
  const canApprove = hasPermission(user, 'procurement:approve')
  const [status, setStatus] = useState('')
  const [mine, setMine] = useState(canApprove)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const list = useApi<PurchaseDetail[]>('/purchases', {
    status: mine ? undefined : status || undefined,
    awaitingMyApproval: mine || undefined,
    branchId: branches.length > 1 ? branch?.id : undefined,
    q: query.trim() || undefined,
    page,
    limit: 25,
  })

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Draft → submitted → approved → received"
        actions={
          canWrite && (
            <a className="btn btn-primary" href="#/purchases/new" data-testid="po-new">
              New purchase order
            </a>
          )
        }
      />
      <div className="toolbar">
        {canApprove && (
          <label className="check">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => {
                setMine(e.target.checked)
                setPage(1)
              }}
              data-testid="po-awaiting"
            />
            Awaiting my approval
          </label>
        )}
        <select
          value={status}
          disabled={mine}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search reference or supplier"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          aria-label="Search purchase orders"
        />
      </div>
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>{mine ? 'Nothing is waiting for your approval.' : 'No purchase orders match.'}</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="po-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Supplier</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Created by</th>
                <th className="num">Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.reference}</td>
                  <td>{p.supplier.name}</td>
                  <td>{p.branch.code}</td>
                  <td>
                    <span className={statusClass(p.status)}>{statusLabel(p.status)}</span>
                  </td>
                  <td>{p.createdBy?.fullName ?? '—'}</td>
                  <td className="num">
                    <Money value={p.subtotal} />
                  </td>
                  <td>
                    <a className="btn btn-small" href={`#/purchases/${p.id}`} data-testid={`po-open-${p.reference}`}>
                      Open
                    </a>
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

interface LineDraft {
  key: number
  productId: string
  label: string
  quantity: string
  unitCost: string
}
let lineSeq = 1

/** Create a new order, or edit a DRAFT: the draft is loaded first, then the form mounts with its values. */
export function PurchaseFormPage({ purchaseId }: { purchaseId?: string }) {
  const existing = useApi<PurchaseDetail>(purchaseId ? `/purchases/${purchaseId}` : null)
  if (purchaseId && !existing.data) return existing.error ? <ErrorAlert error={existing.error} /> : <Spinner />
  return <PurchaseForm purchaseId={purchaseId} initial={existing.data ?? undefined} />
}

function PurchaseForm({ purchaseId, initial: p }: { purchaseId?: string; initial?: PurchaseDetail }) {
  const { branches, branch } = useSession()
  const suppliers = useApi<Supplier[]>('/suppliers', { isActive: true, limit: 100 })
  const [branchId, setBranchId] = useState(p?.branch.id ?? branch?.id ?? '')
  const [supplierId, setSupplierId] = useState(p?.supplier.id ?? '')
  const [supplierReference, setSupplierReference] = useState(p?.supplierReference ?? '')
  const [expected, setExpected] = useState(p?.expectedDeliveryDate ?? '')
  const [notes, setNotes] = useState(p?.notes ?? '')
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (p?.items ?? []).map((i) => ({
      key: lineSeq++,
      productId: i.productId,
      label: `${i.sku} · ${i.productName}`,
      quantity: String(i.quantityOrdered),
      unitCost: i.unitCost ?? '',
    })),
  )
  const [search, setSearch] = useState('')
  const productQuery = useDebounced(search)
  const products = useApi<Product[]>(productQuery.trim() ? '/products' : null, { q: productQuery.trim(), isActive: true, limit: 10 })
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  function addProduct(prod: Product) {
    if (lines.some((l) => l.productId === prod.id)) {
      setFormError(`${prod.sku} is already on the order.`)
      return
    }
    setFormError(null)
    setLines([...lines, { key: lineSeq++, productId: prod.id, label: `${prod.sku} · ${prod.name}`, quantity: '1', unitCost: prod.costPrice ?? '' }])
    setSearch('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!branchId || !supplierId) return setFormError('Choose the branch and the supplier.')
    if (lines.length === 0) return setFormError('Add at least one product.')
    for (const l of lines) {
      const q = Number(l.quantity)
      if (!Number.isInteger(q) || q < 1) return setFormError(`${l.label}: quantity must be a whole number of at least 1.`)
      if (!isMoney(l.unitCost) || Number(l.unitCost) <= 0) return setFormError(`${l.label}: enter a unit cost.`)
    }
    setFormError(null)
    setBusy(true)
    const items = lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: l.unitCost.trim() }))
    try {
      if (purchaseId) {
        await api.request('PATCH', `/purchases/${purchaseId}`, {
          body: {
            supplierId,
            supplierReference: supplierReference.trim() || null,
            expectedDeliveryDate: expected || null,
            notes: notes.trim() || null,
            items,
          },
        })
        navigate(`/purchases/${purchaseId}`)
      } else {
        const r = await api.post<PurchaseDetail>('/purchases', {
          branchId,
          supplierId,
          supplierReference: supplierReference.trim() || undefined,
          expectedDeliveryDate: expected || undefined,
          notes: notes.trim() || undefined,
          items,
        })
        navigate(`/purchases/${r.data.id}`)
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={purchaseId ? `Edit ${p?.reference ?? 'draft'}` : 'New purchase order'} subtitle="Unit costs exclude VAT" />
      <form className="stack" onSubmit={submit} noValidate data-testid="po-form">
        <div className="card form-grid">
          <Field label="Branch">
            <select value={branchId} disabled={!!purchaseId} onChange={(e) => setBranchId(e.target.value)} data-testid="po-branch">
              <option value="">Choose…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} data-testid="po-supplier">
              <option value="">Choose…</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier quote/reference (optional)">
            <input value={supplierReference} maxLength={100} onChange={(e) => setSupplierReference(e.target.value)} />
          </Field>
          <Field label="Expected delivery (optional)">
            <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="card stack">
          <h2>Lines ({lines.length})</h2>
          <input
            type="search"
            placeholder="Find a product to add (name or SKU)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Find product"
            data-testid="po-product-search"
          />
          {products.data && search.trim() && (
            <ul className="product-list">
              {products.data.map((prod) => (
                <li key={prod.id}>
                  <button type="button" className="product-item" onClick={() => addProduct(prod)} data-testid={`po-add-${prod.sku}`}>
                    <span className="product-main">
                      <span className="product-name">{prod.name}</span>
                      <span className="muted small mono">{prod.sku}</span>
                    </span>
                    <span className="product-side small">cost {prod.costPrice ?? '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lines.length === 0 && <Empty>No lines yet.</Empty>}
          {lines.map((l, i) => (
            <div key={l.key} className="po-line" data-testid={`po-line-${i}`}>
              <span className="po-line-label">{l.label}</span>
              <input
                type="number"
                min={1}
                value={l.quantity}
                aria-label={`Quantity ${l.label}`}
                onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))}
                data-testid={`po-qty-${i}`}
              />
              <input
                inputMode="decimal"
                value={l.unitCost}
                aria-label={`Unit cost ${l.label}`}
                onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, unitCost: e.target.value } : x)))}
                data-testid={`po-cost-${i}`}
              />
              <button type="button" className="btn btn-ghost btn-small" aria-label={`Remove ${l.label}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                ✕
              </button>
            </div>
          ))}
          <p className="muted small">The subtotal is calculated by the server when the order is saved.</p>
        </div>
        {formError && <Alert kind="error" testId="po-form-error">{formError}</Alert>}
        <ErrorAlert error={error} testId="po-error" />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="po-save">
            {busy ? 'Saving…' : purchaseId ? 'Save draft' : 'Create draft'}
          </button>
          <a className="btn btn-ghost" href={purchaseId ? `#/purchases/${purchaseId}` : '#/purchases'}>
            Cancel
          </a>
        </div>
      </form>
    </>
  )
}

type Action = 'submit' | 'approve' | 'reject' | 'reopen' | 'cancel'

export function PurchaseDetailPage({ purchaseId }: { purchaseId: string }) {
  const { user } = useSession()
  const po = useApi<PurchaseDetail>(`/purchases/${purchaseId}`)
  const [dialog, setDialog] = useState<Action | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const p = po.data
  if (po.error && !p) return <ErrorAlert error={po.error} />
  if (!p) return <Spinner />

  const canWrite = hasPermission(user, 'procurement:write')
  const canApprove = hasPermission(user, 'procurement:approve')
  const canReceive = hasPermission(user, 'inventory:receive')
  const actions: { key: Action; label: string; show: boolean; primary?: boolean }[] = [
    { key: 'submit', label: 'Submit for approval', show: canWrite && p.status === 'DRAFT', primary: true },
    { key: 'approve', label: 'Approve', show: canApprove && p.status === 'SUBMITTED', primary: true },
    { key: 'reject', label: 'Reject', show: canApprove && p.status === 'SUBMITTED' },
    { key: 'reopen', label: 'Reopen as draft', show: canWrite && p.status === 'REJECTED' },
    {
      key: 'cancel',
      label: 'Cancel order',
      show: (canWrite && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(p.status)) || (canApprove && p.status === 'APPROVED'),
    },
  ]

  async function run(action: Action, text: string) {
    setBusy(true)
    setError(null)
    try {
      const body =
        action === 'approve' ? (text.trim() ? { note: text.trim() } : {}) : action === 'reject' || action === 'cancel' ? { reason: text.trim() } : undefined
      await api.post(`/purchases/${purchaseId}/${action}`, body)
      setDialog(null)
      setNotice(
        {
          submit: 'Submitted for approval.',
          approve: 'Approved — ready to receive.',
          reject: 'Rejected.',
          reopen: 'Reopened as a draft.',
          cancel: 'Cancelled.',
        }[action],
      )
      po.reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={p.reference}
        subtitle={`${p.supplier.name} · ${p.branch.code} ${p.branch.name}`}
        actions={<a className="btn btn-ghost" href="#/purchases">Back</a>}
      />
      {notice && <Alert kind="success" testId="po-notice">{notice}</Alert>}
      {dialog === null && <ErrorAlert error={error} testId="po-action-error" />}
      <div className="grid-2">
        <div className="card">
          <dl className="kv" data-testid="po-summary">
            <dt>Status</dt>
            <dd>
              <span className={statusClass(p.status)} data-testid="po-status">
                {statusLabel(p.status)}
              </span>
            </dd>
            <dt>Created</dt>
            <dd>
              {p.createdBy?.fullName ?? '—'} · {new Date(p.createdAt).toLocaleString()}
            </dd>
            {p.submittedBy && (
              <>
                <dt>Submitted</dt>
                <dd>{p.submittedBy.fullName}</dd>
              </>
            )}
            {p.approvedBy && (
              <>
                <dt>Approved</dt>
                <dd>
                  {p.approvedBy.fullName}
                  {p.approvalNote ? ` — ${p.approvalNote}` : ''}
                </dd>
              </>
            )}
            {p.rejectedBy && (
              <>
                <dt>Rejected</dt>
                <dd>
                  {p.rejectedBy.fullName}
                  {p.rejectionReason ? ` — ${p.rejectionReason}` : ''}
                </dd>
              </>
            )}
            {p.cancelledBy && (
              <>
                <dt>Cancelled</dt>
                <dd>
                  {p.cancelledBy.fullName}
                  {p.cancellationReason ? ` — ${p.cancellationReason}` : ''}
                </dd>
              </>
            )}
            {p.supplierReference && (
              <>
                <dt>Supplier ref.</dt>
                <dd>{p.supplierReference}</dd>
              </>
            )}
            {p.expectedDeliveryDate && (
              <>
                <dt>Expected</dt>
                <dd>{p.expectedDeliveryDate}</dd>
              </>
            )}
            {p.notes && (
              <>
                <dt>Notes</dt>
                <dd>{p.notes}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="card stack">
          <h2>Actions</h2>
          <div className="row-actions">
            {actions
              .filter((a) => a.show)
              .map((a) => (
                <button
                  key={a.key}
                  className={a.primary ? 'btn btn-primary' : 'btn'}
                  disabled={busy}
                  onClick={() => (a.key === 'submit' || a.key === 'reopen' ? void run(a.key, '') : setDialog(a.key))}
                  data-testid={`po-${a.key}`}
                >
                  {a.label}
                </button>
              ))}
            {canWrite && p.status === 'DRAFT' && (
              <a className="btn" href={`#/purchases/${p.id}/edit`} data-testid="po-edit">
                Edit draft
              </a>
            )}
            {canReceive && (p.status === 'APPROVED' || p.status === 'PARTIALLY_RECEIVED') && (
              <a className="btn btn-primary" href={`#/receiving/${p.id}`} data-testid="po-receive">
                Receive goods
              </a>
            )}
          </div>
          {actions.every((a) => !a.show) && !(canReceive && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status)) && (
            <p className="muted small">No actions available to you for this order.</p>
          )}
          {canApprove && p.status === 'SUBMITTED' && (
            <p className="muted small">You cannot approve an order you created or submitted (separation of duties).</p>
          )}
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: '1rem' }}>
        <table className="table" data-testid="po-lines">
          <thead>
            <tr>
              <th>#</th>
              <th>SKU</th>
              <th>Product</th>
              <th className="num">Ordered</th>
              <th className="num">Received</th>
              <th className="num">Unit cost</th>
              <th className="num">Line total</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <td>{i.lineNumber}</td>
                <td className="mono">{i.sku}</td>
                <td>{i.productName}</td>
                <td className="num">{i.quantityOrdered}</td>
                <td className="num">{i.quantityReceived}</td>
                <td className="num">
                  <Money value={i.unitCost} />
                </td>
                <td className="num">
                  <Money value={i.lineTotal} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="num">
                <strong>Subtotal (excl. VAT)</strong>
              </td>
              <td className="num">
                <Money value={p.subtotal} strong />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {dialog && (
        <ReasonDialog
          action={dialog}
          busy={busy}
          error={error}
          onClose={() => {
            setDialog(null)
            setError(null)
          }}
          onConfirm={(t) => void run(dialog, t)}
        />
      )}
    </>
  )
}

function ReasonDialog({
  action,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  action: Action
  busy: boolean
  error: unknown
  onClose: () => void
  onConfirm: (text: string) => void
}) {
  const [text, setText] = useState('')
  const needsReason = action === 'reject' || action === 'cancel'
  const title = { approve: 'Approve order', reject: 'Reject order', cancel: 'Cancel order', submit: '', reopen: '' }[action]
  const fieldErr = error instanceof ApiError ? error.fieldMessages(needsReason ? 'reason' : 'note') : []
  return (
    <Modal title={title} onClose={onClose} testId="po-dialog">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(text)
        }}
      >
        <Field label={needsReason ? 'Reason (at least 5 characters)' : 'Note (optional)'} error={fieldErr}>
          <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} data-testid="po-dialog-text" autoFocus />
        </Field>
        {fieldErr.length === 0 && <ErrorAlert error={error} testId="po-dialog-error" />}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || (needsReason && text.trim().length < 5)} data-testid="po-dialog-confirm">
            {busy ? 'Working…' : title}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Back
          </button>
        </div>
      </form>
    </Modal>
  )
}
