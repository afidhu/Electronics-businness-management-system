import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, ErrorAlert, Field, PageHeader } from '../components/ui.tsx'
import { ROLE_LABELS } from '../lib/permissions.ts'

/** Every user: profile and own password change (all sessions are revoked by the server). */
export function AccountPage() {
  const { user, branches, logout } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 12) return setFormError('The new password must be at least 12 characters.')
    if (next !== confirm) return setFormError('The new passwords do not match.')
    if (next === current) return setFormError('Choose a password different from the current one.')
    setFormError(null)
    setBusy(true)
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
      // The server revoked every session; sign out here too.
      setTimeout(() => void logout(), 2500)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? new Error('The current password is incorrect.') : err)
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null
  return (
    <>
      <PageHeader title="My account" />
      <div className="grid-2">
        <div className="card">
          <h2>Profile</h2>
          <dl className="kv" data-testid="account-profile">
            <dt>Name</dt>
            <dd>{user.fullName}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>{ROLE_LABELS[user.role] ?? user.role}</dd>
            <dt>Branches</dt>
            <dd>{user.allBranches ? 'All branches' : branches.map((b) => `${b.code} ${b.name}`).join(', ') || '—'}</dd>
          </dl>
        </div>
        <form className="card stack" onSubmit={submit} data-testid="password-form" noValidate>
          <h2>Change password</h2>
          <Field label="Current password">
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="pw-current" />
          </Field>
          <Field label="New password" hint="At least 12 characters. You will be signed out on every device.">
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="pw-new" />
          </Field>
          <Field label="Repeat new password">
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="pw-confirm" />
          </Field>
          {formError && <Alert kind="error" testId="pw-form-error">{formError}</Alert>}
          <ErrorAlert error={error} testId="pw-error" />
          {done && (
            <Alert kind="success" testId="pw-done">
              Password changed. Signing you out — sign in again with the new password.
            </Alert>
          )}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy || done} data-testid="pw-submit">
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
