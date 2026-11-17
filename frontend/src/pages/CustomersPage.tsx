import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { Customer } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from '../components/ui.tsx'
import { useApi, useDebounced } from '../lib/hooks.ts'
import { hasPermission } from '../lib/permissions.ts'

/** Customers (S6): organisation-wide; phone normalised to +255… by the server and unique. */
export function CustomersPage() {
  const { user } = useSession()
  const canWrite = hasPermission(user, 'customers:write')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const list = useApi<Customer[]>('/customers', { q: query.trim() || undefined, page, limit: 25 })
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Search by name or any part of the phone number"
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing('new')} data-testid="customer-new">
              New customer
            </button>
          )
        }
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Name or phone (e.g. 0712 345 678)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          aria-label="Search customers"
          data-testid="customer-search"
        />
      </div>
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No customers match.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="customers-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Status</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{c.phone ?? '—'}</td>
                  <td>{c.email ?? '—'}</td>
                  <td>
                    <StatusBadge active={c.isActive} />
                  </td>
                  {canWrite && (
                    <td>
                      <button className="btn btn-small" onClick={() => setEditing(c)}>
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
        <CustomerForm
          customer={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null)
            setNotice(`${c.name} saved.`)
            list.reload()
          }}
        />
      )}
    </>
  )
}

/** Shared with the POS ("add customer" during checkout). */
export function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer?: Customer
  onClose: () => void
  onSaved: (c: Customer) => void
}) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [isActive, setIsActive] = useState(customer?.isActive ?? true)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => (error instanceof ApiError ? error.fieldMessages(f) : [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim() || (customer ? null : undefined),
        email: email.trim() || (customer ? null : undefined),
        notes: notes.trim() || (customer ? null : undefined),
        ...(customer ? { isActive } : {}),
      }
      const r = customer
        ? await api.request<Customer>('PATCH', `/customers/${customer.id}`, { body })
        : await api.post<Customer>('/customers', body)
      onSaved(r.data)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={customer ? `Edit ${customer.name}` : 'New customer'} onClose={onClose} testId="customer-form">
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Name" error={fe('name')}>
            <input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} data-testid="cf-name" />
          </Field>
          <Field label="Phone (optional)" hint="Local or international format" error={fe('phone')}>
            <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} data-testid="cf-phone" />
          </Field>
          <Field label="Email (optional)" error={fe('email')}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Notes (optional)" error={fe('notes')}>
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {customer && (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}
        <ErrorAlert error={error} testId="cf-error" />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="cf-save">
            {busy ? 'Saving…' : 'Save customer'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
