import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Branch, SessionUser } from '../api/types.ts'
import { api } from './api.ts'
import { SessionContext, type Status } from './session-context.ts'

const BRANCH_KEY = 'ebms.branch' // UI preference only (a branch id), never credentials

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchIdState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(BRANCH_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    const off = api.onSession((s) => {
      setUser(s?.user ?? null)
      setStatus(s ? 'authenticated' : 'anonymous')
    })
    // Restore a session from the HttpOnly refresh cookie (if any).
    void api.refresh().then((ok) => {
      if (!ok && !api.hasAccessToken) setStatus('anonymous')
    })
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api
      .get<Branch[]>('/branches', { limit: 100 })
      .then((res) => {
        if (cancelled) return
        const visible = res.data.filter(
          (b) => b.isActive && (user.allBranches || user.branchIds.includes(b.id)),
        )
        setBranches(visible)
      })
      .catch(() => {
        if (!cancelled) setBranches([])
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id)
    try {
      sessionStorage.setItem(BRANCH_KEY, id)
    } catch {
      // preference only
    }
  }, [])

  // Filter at render time too, so another user's branches never show after a re-login.
  const visibleBranches = useMemo(
    () => (user ? branches.filter((b) => user.allBranches || user.branchIds.includes(b.id)) : []),
    [user, branches],
  )
  const branch = useMemo(() => {
    if (visibleBranches.length === 1) return visibleBranches[0]
    return visibleBranches.find((b) => b.id === branchId) ?? null
  }, [visibleBranches, branchId])

  const login = useCallback(async (email: string, password: string) => {
    await api.login(email, password)
  }, [])
  const logout = useCallback(async () => {
    await api.logout()
    try {
      sessionStorage.clear()
    } catch {
      // ignore
    }
    window.location.hash = '#/login'
  }, [])

  const value = useMemo(
    () => ({ status, user, login, logout, branches: visibleBranches, branch, setBranchId }),
    [status, user, login, logout, visibleBranches, branch, setBranchId],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
