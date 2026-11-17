import { useCallback, useEffect, useState } from 'react'
import type { Pagination } from '../api/types.ts'
import { api } from '../app/api.ts'

/** Debounced value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

type Query = Record<string, string | number | boolean | undefined | null>

export interface ApiData<T> {
  data: T | null
  pagination: Pagination | null
  error: unknown
  loading: boolean
  reload: () => void
}

/**
 * GET `path` with `query`; refetches when either changes or on reload().
 * Stale responses are discarded (AbortController). `path = null` skips.
 */
export function useApi<T>(path: string | null, query: Query = {}): ApiData<T> {
  const [state, setState] = useState<{ key: string; data: T | null; pagination: Pagination | null; error: unknown }>({
    key: '',
    data: null,
    pagination: null,
    error: null,
  })
  const [tick, setTick] = useState(0)
  const key = path === null ? '' : `${path}?${JSON.stringify(query)}#${tick}`

  useEffect(() => {
    if (path === null) return
    const ctrl = new AbortController()
    const q = JSON.parse(key.slice(key.indexOf('?') + 1, key.lastIndexOf('#'))) as Query
    api
      .get<T>(path, q, ctrl.signal)
      .then((r) => setState({ key, data: r.data, pagination: r.meta.pagination ?? null, error: null }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, key, error: e }))
      })
    return () => ctrl.abort()
  }, [path, key])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return {
    data: state.data,
    pagination: state.pagination,
    error: state.key === key ? state.error : null,
    loading: path !== null && state.key !== key,
    reload,
  }
}

/** A random temporary password that satisfies the policy (≥ 12 chars, mixed). */
export function generatePassword(length = 16): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#%+=?@']
  const all = sets.join('')
  const rnd = (n: number) => {
    const a = new Uint32Array(1)
    globalThis.crypto.getRandomValues(a)
    return a[0] % n
  }
  const chars = sets.map((s) => s[rnd(s.length)])
  while (chars.length < length) chars.push(all[rnd(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
