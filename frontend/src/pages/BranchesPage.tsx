import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { Branch } from '../api/types.ts'
import { api } from '../app/api.ts'
import { Alert, Empty, ErrorAlert, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from '../components/ui.tsx'
import { useApi } from '../lib/hooks.ts'

/** Branches (SYSTEM_ADMIN, branches:write). The code is permanent: it appears in receipt and order numbers. */
export function BranchesPage() {
  const [page, setPage] = useState(1)
  const list = useApi<Branch[]>('/branches', { page, limit: 25 })
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Shops and stores. Receipt numbers use the branch code."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')} data-testid="branch-new">
            New branch
          </button>
        }
      />
      {notice && <Alert kind="success" testId="branch-notice">{notice}</Alert>}
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No branches yet.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="branches-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th>Phone</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.code}</td>
                  <td>{b.name}</td>
                  <td>{b.address ?? '—'}</td>
                  <td>{b.phone ?? '—'}</td>
                  <td>
                    <StatusBadge active={b.isActive} />
                  </td>
                  <td>
                    <button className="btn btn-small" onClick={() => setEditing(b)} data-testid={`branch-edit-${b.code}`}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.pagination} page={page} onPage={setPage} />
      {editing && (
        <BranchForm
          branch={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null)
            setNotice(text)
            list.reload()
          }}
        />
      )}
    </>
  )
}

function BranchForm({ branch, onClose, onDone }: { branch?: Branch; onClose: () => void; onDone: (t: string) => void }) {
  const [code, setCode] = useState(branch?.code ?? '')
  const [name, setName] = useState(branch?.name ?? '')
  const [address, setAddress] = useState(branch?.address ?? '')
  const [phone, setPhone] = useState(branch?.phone ?? '')
  const [isActive, setIsActive] = useState(branch?.isActive ?? true)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const fe = (f: string) => (error instanceof ApiError ? error.fieldMessages(f) : [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const common = { name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined }
      if (branch) {
        await api.request('PATCH', `/branches/${branch.id}`, { body: { ...common, isActive } })
        onDone(`Branch ${branch.code} updated.`)
      } else {
        await api.post('/branches', { code: code.trim().toUpperCase(), ...common })
        onDone(`Branch ${code.trim().toUpperCase()} created.`)
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={branch ? `Edit branch ${branch.code}` : 'New branch'} onClose={onClose} testId="branch-form">
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Code" hint="2–20 of A–Z, 0–9 and '-'; cannot be changed later" error={fe('code')}>
            <input value={code} disabled={!!branch} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="bf-code" />
          </Field>
          <Field label="Name" error={fe('name')}>
            <input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} data-testid="bf-name" />
          </Field>
          <Field label="Address (printed on receipts)" error={fe('address')}>
            <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} data-testid="bf-address" />
          </Field>
          <Field label="Phone" error={fe('phone')}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="bf-phone" />
          </Field>
        </div>
        {branch && (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (inactive branches cannot sell or receive)
          </label>
        )}
        <ErrorAlert error={error} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="bf-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
