import { useState, type ReactNode } from 'react'
import type { Branch, SessionUser } from '../api/types.ts'
import { navFor, ROLE_LABELS } from '../lib/permissions.ts'

export function NavLinks({ user, current, onNavigate }: { user: SessionUser | null; current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="nav">
      {navFor(user).map((item) => {
        const active = current === item.path || current.startsWith(`${item.path}/`)
        return (
          <a
            key={item.path}
            href={`#${item.path}`}
            className={active ? 'nav-link active' : 'nav-link'}
            aria-current={active ? 'page' : undefined}
            data-testid={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
            onClick={onNavigate}
          >
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}

export function BranchSelect({
  branches,
  branch,
  onChange,
}: {
  branches: Branch[]
  branch: Branch | null
  onChange: (id: string) => void
}) {
  if (branches.length === 0) return <span className="muted small">No branch assigned</span>
  if (branches.length === 1) {
    return (
      <span className="branch-fixed" data-testid="branch-fixed">
        {branches[0].code} · {branches[0].name}
      </span>
    )
  }
  return (
    <label className="branch-select">
      <span className="sr-only">Working branch</span>
      <select
        data-testid="branch-select"
        value={branch?.id ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Choose branch…
        </option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} · {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Layout({
  user,
  path,
  branches,
  branch,
  onBranch,
  onLogout,
  children,
}: {
  user: SessionUser
  path: string
  branches: Branch[]
  branch: Branch | null
  onBranch: (id: string) => void
  onLogout: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`shell${open ? ' menu-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="menu-toggle"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>
        <a href="#/dashboard" className="brand">
          <span className="brand-mark" aria-hidden="true">EC</span>
          <span className="brand-name">ElectroCore</span>
        </a>
        <div className="topbar-right">
          <BranchSelect branches={branches} branch={branch} onChange={onBranch} />
          <div className="user-chip" data-testid="user-chip">
            <span className="user-name">{user.fullName}</span>
            <span className="user-role">{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onLogout} data-testid="logout">
            Sign out
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <NavLinks user={user} current={path} onNavigate={() => setOpen(false)} />
      </aside>
      <main className="content" id="main">
        {children}
      </main>
    </div>
  )
}
