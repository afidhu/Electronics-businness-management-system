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

export function Pager({
  pagination,
  page,
  onPage,
}: {
  pagination: { page: number; totalPages: number; total: number } | null
  page: number
  onPage: (p: number) => void
}) {
  if (!pagination || pagination.totalPages <= 1) return null
  return (
    <div className="pager">
      <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} records
      </span>
      <button className="btn btn-small" disabled={page >= pagination.totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  testId,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  testId?: string
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal card${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-small" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[]
  value: T
  onChange: (k: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={value === t.key ? 'tab active' : 'tab'}
          onClick={() => onChange(t.key)}
          data-testid={`tab-${t.key}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Labelled input with server field errors (details[].field === name). */
export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string
  children: ReactNode
  error?: string[]
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
      {error && error.length > 0 && <small className="field-error">{error.join('; ')}</small>}
    </label>
  )
}

export function StatusBadge({ active }: { active: boolean }) {
  return active ? <span className="badge badge-ok">Active</span> : <span className="badge badge-warn">Inactive</span>
}
