import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { Branch, RoleKey, RoleRecord, UserRecord } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from '../components/ui.tsx'
import { generatePassword, useApi, useDebounced } from '../lib/hooks.ts'
import { hasPermission, ROLE_HELP, ROLE_LABELS } from '../lib/permissions.ts'

const ROLE_ORDER: RoleKey[] = ['SYSTEM_ADMIN', 'MANAGER', 'CASHIER', 'INVENTORY_OFFICER', 'PROCUREMENT_OFFICER', 'TECHNICIAN', 'AUDITOR']

type Editing = { mode: 'create' } | { mode: 'edit'; user: UserRecord } | { mode: 'password'; user: UserRecord }

/** Users (FR-AUTH): admins create and manage accounts; managers/auditors read (branch-scoped by the server). */
export function UsersPage() {
  const { user: me } = useSession()
  const canWrite = hasPermission(me, 'users:write')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const list = useApi<UserRecord[]>('/users', { q: query.trim() || undefined, roleKey: role || undefined, page, limit: 25 })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [notice, setNotice] = useState<{ text: string; secret?: string } | null>(null)

  const done = (text: string, secret?: string) => {
    setEditing(null)
    setNotice({ text, secret })
    list.reload()
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={canWrite ? 'Create staff accounts, assign roles and branches' : 'Staff of your branches (read-only)'}
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => {
                setNotice(null)
                setEditing({ mode: 'create' })
              }} data-testid="user-new">
              New user
            </button>
          )
        }
      />
      {notice && (
        <Alert kind="success" testId="user-notice">
          {notice.text}
          {notice.secret && (
            <div className="secret" data-testid="user-secret">
              <span>Temporary password (shown once — give it to the user privately):</span>
              <code>{notice.secret}</code>
            </div>
          )}
        </Alert>
      )}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          aria-label="Search users"
          data-testid="user-search"
        />
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value)
            setPage(1)
          }}
          aria-label="Role"
        >
          <option value="">All roles</option>
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No users match.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Branches</th>
                <th>Status</th>
                <th>Last sign-in</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td className="mono">{u.email}</td>
                  <td>{ROLE_LABELS[u.role.key] ?? u.role.name}</td>
                  <td>{u.role.key === 'SYSTEM_ADMIN' ? 'All' : u.branches.map((b) => b.code).join(', ') || '—'}</td>
                  <td>
                    <StatusBadge active={u.isActive} />
                    {u.isLocked && <span className="badge badge-warn">Locked</span>}
                  </td>
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                  {canWrite && (
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-small" onClick={() => {
                            setNotice(null)
                            setEditing({ mode: 'edit', user: u })
                          }} data-testid={`user-edit-${u.email}`}>
                          Edit
                        </button>
                        <button className="btn btn-small" onClick={() => {
                            setNotice(null)
                            setEditing({ mode: 'password', user: u })
                          }} data-testid={`user-pw-${u.email}`}>
                          Reset password
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.pagination} page={page} onPage={setPage} />
      {editing?.mode === 'create' && <UserForm onClose={() => setEditing(null)} onDone={done} />}
      {editing?.mode === 'edit' && <UserForm user={editing.user} onClose={() => setEditing(null)} onDone={done} />}
      {editing?.mode === 'password' && <ResetPassword user={editing.user} onClose={() => setEditing(null)} onDone={done} />}
    </>
  )
}

function UserForm({ user, onClose, onDone }: { user?: UserRecord; onClose: () => void; onDone: (text: string, secret?: string) => void }) {
  const { user: me } = useSession()
  const roles = useApi<RoleRecord[]>('/roles')
  const branches = useApi<Branch[]>('/branches', { limit: 100 })
  const [email, setEmail] = useState(user?.email ?? '')
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [roleKey, setRoleKey] = useState<RoleKey>(user?.role.key ?? 'CASHIER')
  const [branchIds, setBranchIds] = useState<string[]>(user?.branches.map((b) => b.id) ?? [])
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [password] = useState(() => generatePassword())
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const role = roles.data?.find((r) => r.key === roleKey)
  const maxBranches = role?.maxBranches ?? null
  const isAdminRole = roleKey === 'SYSTEM_ADMIN'
  const self = user?.id === me?.id
  const fieldErr = (f: string) => (error instanceof ApiError ? error.fieldMessages(f) : [])

  function toggleBranch(id: string) {
    setBranchIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id)
      return maxBranches === 1 ? [id] : [...ids, id]
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isAdminRole && branchIds.length === 0) {
      setError(new Error('Assign at least one branch.'))
      return
    }
    setBusy(true)
    try {
      const ids = isAdminRole ? [] : branchIds
      if (user) {
        await api.request('PATCH', `/users/${user.id}`, {
          body: { fullName: fullName.trim(), roleKey, branchIds: ids, ...(self ? {} : { isActive }) },
        })
        onDone(`${fullName} updated.`)
      } else {
        await api.post('/users', { email: email.trim().toLowerCase(), fullName: fullName.trim(), password, roleKey, branchIds: ids })
        onDone(`${fullName} (${email.trim().toLowerCase()}) created as ${ROLE_LABELS[roleKey]}.`, password)
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={user ? `Edit ${user.fullName}` : 'New user'} onClose={onClose} testId="user-form" wide>
      {(roles.loading || branches.loading) && <Spinner />}
      <form onSubmit={submit} className="stack" noValidate>
        <div className="form-grid">
          <Field label="Full name" error={fieldErr('fullName')}>
            <input value={fullName} maxLength={150} onChange={(e) => setFullName(e.target.value)} data-testid="uf-name" required />
          </Field>
          <Field label="Email (sign-in name)" error={fieldErr('email')}>
            <input type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} data-testid="uf-email" required />
          </Field>
          <Field label="Role" error={fieldErr('roleKey')} hint={ROLE_HELP[roleKey]}>
            <select value={roleKey} disabled={self} onChange={(e) => setRoleKey(e.target.value as RoleKey)} data-testid="uf-role">
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          {user && !self && (
            <label className="check">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} data-testid="uf-active" />
              Account active (unticking signs the user out everywhere)
            </label>
          )}
        </div>
        {isAdminRole ? (
          <p className="muted small">System administrators work across all branches.</p>
        ) : (
          <fieldset className="card">
            <legend>Branches {maxBranches === 1 ? '(exactly one for this role)' : ''}</legend>
            <div className="checks" data-testid="uf-branches">
              {branches.data
                ?.filter((b) => b.isActive || branchIds.includes(b.id))
                .map((b) => (
                  <label key={b.id} className="check">
                    <input
                      type={maxBranches === 1 ? 'radio' : 'checkbox'}
                      name="branch"
                      checked={branchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      data-testid={`uf-branch-${b.code}`}
                    />
                    {b.code} · {b.name}
                  </label>
                ))}
            </div>
            {fieldErr('branchIds').length > 0 && <small className="field-error">{fieldErr('branchIds').join('; ')}</small>}
          </fieldset>
        )}
        {!user && (
          <div className="secret">
            <span>Temporary password:</span>
            <code data-testid="uf-password">{password}</code>
          </div>
        )}
        <ErrorAlert error={error} testId="uf-error" />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="uf-save">
            {busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPassword({ user, onClose, onDone }: { user: UserRecord; onClose: () => void; onDone: (text: string, secret?: string) => void }) {
  const [password] = useState(() => generatePassword())
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  async function reset() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/users/${user.id}/password`, { newPassword: password })
      onDone(`Password reset for ${user.fullName}; their sessions were signed out.`, password)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Reset password · ${user.fullName}`} onClose={onClose} testId="reset-form">
      <p>A new temporary password will replace the current one and sign {user.fullName} out on every device.</p>
      <div className="secret">
        <code>{password}</code>
      </div>
      <ErrorAlert error={error} />
      <div className="form-actions">
        <button className="btn btn-primary" onClick={() => void reset()} disabled={busy} data-testid="reset-confirm">
          {busy ? 'Resetting…' : 'Reset password'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
