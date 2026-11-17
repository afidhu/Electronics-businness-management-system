import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { Supplier } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from '../components/ui.tsx'
import { useApi, useDebounced } from '../lib/hooks.ts'
import { hasPermission } from '../lib/permissions.ts'

/** Suppliers (Module 4): procurement officers maintain them; others with procurement:read view. */
export function SuppliersPage() {
  const { user } = useSession()
  const canWrite = hasPermission(user, 'procurement:write')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const list = useApi<Supplier[]>('/suppliers', { q: query.trim() || undefined, page, limit: 25 })
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title="Suppliers"
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing('new')} data-testid="supplier-new">
              New supplier
            </button>
          )
        }
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search suppliers"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          aria-label="Search suppliers"
        />
      </div>
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No suppliers yet.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="suppliers-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>TIN</th>
                <th>Status</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.contactPerson ?? '—'}</td>
                  <td>{s.phone ?? '—'}</td>
                  <td>{s.email ?? '—'}</td>
                  <td className="mono">{s.tin ?? '—'}</td>
                  <td>
                    <StatusBadge active={s.isActive} />
                  </td>
                  {canWrite && (
                    <td>
                      <button className="btn btn-small" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.pagination} page={page} onPage={setPage} />
      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null)
            setNotice(`${name} saved.`)
            list.reload()
          }}
        />
      )}
    </>
  )
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: (n: string) => void }) {
  const [f, setF] = useState({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    tin: supplier?.tin ?? '',
    notes: supplier?.notes ?? '',
  })
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldMessages(k) : [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Empty optional fields: omitted on create, cleared (null) on edit.
    const body: Record<string, unknown> = { name: f.name.trim() }
    for (const k of ['contactPerson', 'phone', 'email', 'address', 'tin', 'notes'] as const) {
      const v = f[k].trim()
      if (v) body[k] = v
      else if (supplier) body[k] = null
    }
    if (supplier) body.isActive = isActive
    try {
      if (supplier) await api.request('PATCH', `/suppliers/${supplier.id}`, { body })
      else await api.post('/suppliers', body)
      onSaved(f.name.trim())
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : 'New supplier'} onClose={onClose} testId="supplier-form" wide>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Name" error={fe('name')}>
            <input value={f.name} onChange={set('name')} data-testid="sf-name" />
          </Field>
          <Field label="Contact person" error={fe('contactPerson')}>
            <input value={f.contactPerson} onChange={set('contactPerson')} />
          </Field>
          <Field label="Phone" error={fe('phone')}>
            <input value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" error={fe('email')}>
            <input type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Address" error={fe('address')}>
            <input value={f.address} onChange={set('address')} />
          </Field>
          <Field label="TIN (9 digits)" error={fe('tin')}>
            <input value={f.tin} inputMode="numeric" onChange={set('tin')} />
          </Field>
          <Field label="Notes" error={fe('notes')}>
            <input value={f.notes} onChange={set('notes')} />
          </Field>
        </div>
        {supplier && (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}
        <ErrorAlert error={error} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="sf-save">
            {busy ? 'Saving…' : 'Save supplier'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
