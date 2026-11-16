/**
 * API client for the EBMS backend (`/api/v1`, ADR-017).
 *
 * - The access token lives ONLY in memory (this object). Nothing is written
 *   to localStorage/sessionStorage, so a script injected into the page later
 *   cannot read a stored token.
 * - The refresh token is an HttpOnly, SameSite=Strict cookie scoped to
 *   `/api/v1/auth`; the browser sends it, JavaScript never sees it.
 * - Refresh is single-flight: however many requests get a 401 at the same
 *   time, exactly one POST /auth/refresh is made and all of them wait for it
 *   (the backend rotates refresh tokens, so parallel refreshes would revoke
 *   each other).
 */
import type { Envelope, ErrorBody, SessionUser } from './types.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: { field: string; messages: string[] }[]
  readonly requestId?: string

  constructor(status: number, body: Partial<ErrorBody>) {
    super(body.message ?? `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code ?? (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR')
    this.details = body.details ?? []
    this.requestId = body.requestId
  }

  /** True when the request may or may not have reached the server. */
  get isNetworkError(): boolean {
    return this.status === 0
  }

  /** Messages for one field (`items.0.quantity`) or a prefix (`payments`). */
  fieldMessages(prefix: string): string[] {
    return this.details
      .filter((d) => d.field === prefix || d.field.startsWith(`${prefix}.`))
      .flatMap((d) => d.messages)
  }
}

export interface Session {
  user: SessionUser
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  body?: unknown
  query?: Query
  /** Internal: whether a 401 may trigger refresh + one retry. */
  retryOn401?: boolean
  signal?: AbortSignal
}

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' }

export class ApiClient {
  private accessToken: string | null = null
  private refreshInFlight: Promise<boolean> | null = null
  private readonly listeners = new Set<(s: Session | null) => void>()
  private readonly baseUrl: string
  private readonly fetchFn: FetchLike

  constructor(baseUrl = '/api/v1', fetchFn?: FetchLike) {
    this.baseUrl = baseUrl
    this.fetchFn = fetchFn ?? ((input, init) => globalThis.fetch(input, init))
  }

  /** Subscribe to sign-in / refresh / sign-out. Returns an unsubscribe function. */
  onSession(listener: (s: Session | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get hasAccessToken(): boolean {
    return this.accessToken !== null
  }

  private setSession(token: string | null, user: SessionUser | null) {
    this.accessToken = token
    const session = token && user ? { user } : null
    for (const l of this.listeners) l(session)
  }

  async login(email: string, password: string): Promise<Session> {
    const data = await this.raw<{ accessToken: string; user: SessionUser }>(
      'POST',
      '/auth/login',
      { body: { email, password } },
      false,
    )
    this.setSession(data.accessToken, data.user)
    return { user: data.user }
  }

  /**
   * Exchange the refresh cookie for a new access token. Concurrent callers
   * share one request. Resolves false (and signs out locally) if the
   * session is gone; never throws.
   */
  refresh(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.raw<{ accessToken: string; user: SessionUser }>(
        'POST',
        '/auth/refresh',
        {},
        false,
      )
        .then((data) => {
          this.setSession(data.accessToken, data.user)
          return true
        })
        .catch((e: unknown) => {
          // A network failure is not proof the session ended: keep the
          // current token (if any) and let the caller show an error.
          if (e instanceof ApiError && e.isNetworkError) return false
          this.setSession(null, null)
          return false
        })
        .finally(() => {
          this.refreshInFlight = null
        })
    }
    return this.refreshInFlight
  }

  async logout(): Promise<void> {
    try {
      await this.raw('POST', '/auth/logout', {}, false)
    } catch {
      // Signing out locally must always succeed.
    } finally {
      this.setSession(null, null)
    }
  }

  get<T>(path: string, query?: Query, signal?: AbortSignal) {
    return this.request<T>('GET', path, { query, signal })
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body })
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body })
  }

  /** Authenticated request; on 401 refreshes once (shared) and retries once. */
  async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<Envelope<T>> {
    const tokenUsed = this.accessToken
    try {
      return await this.rawEnvelope<T>(method, path, opts, true)
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 401 &&
        opts.retryOn401 !== false
      ) {
        let ok: boolean
        if (this.refreshInFlight) {
          ok = await this.refreshInFlight // join the refresh already running
        } else if (this.accessToken && this.accessToken !== tokenUsed) {
          ok = true // another request refreshed meanwhile: just retry
        } else {
          ok = await this.refresh()
        }
        if (ok) {
          return this.rawEnvelope<T>(method, path, { ...opts, retryOn401: false }, true)
        }
      }
      throw e
    }
  }

  private async raw<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    withToken: boolean,
  ): Promise<T> {
    return (await this.rawEnvelope<T>(method, path, opts, withToken)).data
  }

  private async rawEnvelope<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    withToken: boolean,
  ): Promise<Envelope<T>> {
    const headers: Record<string, string> = { Accept: 'application/json', ...CSRF }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (withToken && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`
    }
    let res: Response
    try {
      res = await this.fetchFn(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: 'same-origin',
        signal: opts.signal,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw new ApiError(0, {
        message: 'Cannot reach the server. Check the connection and try again.',
      })
    }
    if (res.status === 204) return { data: undefined as T, meta: {} }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (!res.ok) {
      throw new ApiError(res.status, (json ?? {}) as Partial<ErrorBody>)
    }
    return json as Envelope<T>
  }

  private url(path: string, query?: Query): string {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    const qs = params.toString()
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`
  }
}
