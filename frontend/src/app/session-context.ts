import { createContext, useContext } from 'react'
import type { Branch, SessionUser } from '../api/types.ts'

export type Status = 'loading' | 'anonymous' | 'authenticated'

export interface SessionValue {
  status: Status
  user: SessionUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Active branches the user may work at (all active branches for admins). */
  branches: Branch[]
  /** The selected working branch (fixed for single-branch users). */
  branch: Branch | null
  setBranchId: (id: string) => void
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession must be used inside SessionProvider')
  return v
}
