import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import { useSession } from '../app/session-context.ts'
import { navigate } from '../lib/router.ts'

function loginMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Incorrect email or password.'
    if (e.status === 429) return 'Too many attempts. Wait a moment and try again.'
    if (e.status === 423 || e.code === 'ACCOUNT_LOCKED') return e.message
    if (e.isNetworkError) return e.message
    return e.message
  }
  return 'Sign-in failed. Try again.'
}

export function LoginPage({ next }: { next?: string }) {
  const { login } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      setPassword('')
      navigate(next && next !== '/login' ? next : '/dashboard')
    } catch (err) {
      setError(loginMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit} noValidate data-testid="login-form">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">EC</span>
          <div>
            <h1>ElectroCore</h1>
            <p className="muted">Business management · Sign in</p>
          </div>
        </div>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
          />
        </label>
        {error && (
          <div className="alert alert-error" role="alert" data-testid="login-error">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="login-submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
