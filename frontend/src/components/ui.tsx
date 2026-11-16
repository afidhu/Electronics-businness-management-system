import type { ReactNode } from 'react'
import { ApiError } from '../api/client.ts'
import { errorText } from '../lib/format.ts'
import { formatMoney } from '../lib/money.ts'

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner-dot" aria-hidden="true" />
      {label}
    </div>
  )
}

export function Alert({
  kind = 'error',
  children,
  testId,
}: {
  kind?: 'error' | 'success' | 'info' | 'warning'
  children: ReactNode
  testId?: string
}) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </div>
  )
}

export function ErrorAlert({ error, testId }: { error: unknown; testId?: string }) {
  if (!error) return null
  const requestId = error instanceof ApiError ? error.requestId : undefined
  return (
    <Alert kind="error" testId={testId}>
      {errorText(error)}
      {requestId && <span className="muted small"> (ref {requestId.slice(0, 8)})</span>}
    </Alert>
  )
}

export function Money({ value, currency = 'TZS', strong = false }: { value: string | null | undefined; currency?: string; strong?: boolean }) {
  const text = formatMoney(value, currency)
  return <span className={`money${strong ? ' strong' : ''}`}>{text}</span>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

