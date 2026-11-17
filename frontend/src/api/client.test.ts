import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiClient, ApiError } from './client.ts'

const USER = {
  id: 'u1',
  email: 'cashier@ebms.test',
  fullName: 'Cashier One',
  role: 'CASHIER',
  permissions: ['sales:create', 'sales:read'],
  branchIds: ['b1'],
  allBranches: false,
}

interface Call {
  url: string
  init: RequestInit
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Fake backend: access tokens "t1", "t2", …; any request with an outdated
 * token gets 401 INVALID_TOKEN. `refreshDelay` keeps the refresh pending so
 * concurrent callers can pile up behind it.
 */
function fakeServer(opts: { refreshOk?: boolean; refreshDelay?: number; refreshNetworkError?: boolean } = {}) {
  const calls: Call[] = []
  let current = 't1'
  let n = 1
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const headers = (init.headers ?? {}) as Record<string, string>
    if (url.endsWith('/auth/login')) return json(200, { data: { accessToken: current, user: USER }, meta: {} })
    if (url.endsWith('/auth/refresh')) {
      if (opts.refreshDelay) await new Promise((r) => setTimeout(r, opts.refreshDelay))
      if (opts.refreshNetworkError) throw new TypeError('fetch failed')
      if (opts.refreshOk === false) {
        return json(401, { statusCode: 401, code: 'INVALID_TOKEN', message: 'Session expired', requestId: 'r' })
      }
      current = `t${++n}`
      return json(200, { data: { accessToken: current, user: USER }, meta: {} })
    }
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 })
    if (headers.Authorization !== `Bearer ${current}`) {
      return json(401, { statusCode: 401, code: 'INVALID_TOKEN', message: 'Invalid or expired token', requestId: 'r' })
    }
    return json(200, { data: { ok: true, path: url }, meta: { requestId: 'x' } })
  }
  return {
    calls,
    fetchFn,
    expireAccessToken() {
      current = `t${++n}` // server-side rotation: the client's token is now stale
    },
    refreshCalls: () => calls.filter((c) => c.url.endsWith('/auth/refresh')).length,
  }
}

describe('ApiClient — authentication', () => {
  it('keeps the access token in memory and sends it as a Bearer header; never in storage', async () => {
    const writes: string[] = []
    const spy = { setItem: (k: string) => writes.push(k), getItem: () => null, removeItem: () => {} }
    Object.assign(globalThis, { localStorage: spy, sessionStorage: spy })
    try {
      const s = fakeServer()
      const api = new ApiClient('/api/v1', s.fetchFn)
      const session = await api.login('cashier@ebms.test', 'secret-pass-123')
      assert.equal(session.user.role, 'CASHIER')
      assert.equal(api.hasAccessToken, true)
      await api.get('/sales')
      const last = s.calls.at(-1)!
      assert.equal((last.init.headers as Record<string, string>).Authorization, 'Bearer t1')
      assert.deepEqual(writes, [], 'no token or credential is written to web storage')
      // The login body is sent once and never echoed into URLs.
      assert.ok(!s.calls.some((c) => c.url.includes('secret-pass-123')))
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage')
      Reflect.deleteProperty(globalThis, 'sessionStorage')
    }
  })

  it('auth calls send the anti-CSRF header and same-origin credentials (refresh cookie)', async () => {
    const s = fakeServer()
    const api = new ApiClient('/api/v1', s.fetchFn)
    await api.refresh()
    const refresh = s.calls.find((c) => c.url.endsWith('/auth/refresh'))!
    assert.equal((refresh.init.headers as Record<string, string>)['X-Requested-With'], 'XMLHttpRequest')
    assert.equal(refresh.init.credentials, 'same-origin')
    assert.equal(refresh.init.method, 'POST')
  })

  
  it('on 401 refreshes once and retries the request with the new token', async () => {
    const s = fakeServer()
    const api = new ApiClient('/api/v1', s.fetchFn)
    await api.login('a', 'b')
    s.expireAccessToken()
    const res = await api.get<{ ok: boolean }>('/sales')
    assert.equal(res.data.ok, true)
    assert.equal(s.refreshCalls(), 1)
  })

  it('many simultaneous 401s share ONE refresh request (single-flight)', async () => {
    const s = fakeServer({ refreshDelay: 30 })
    const api = new ApiClient('/api/v1', s.fetchFn)
    await api.login('a', 'b')
    s.expireAccessToken()
    const results = await Promise.all(
      ['/sales', '/pos/catalogue', '/inventory/balances', '/sales/summary', '/settings/tax', '/branches'].map((p) =>
        api.get<{ ok: boolean }>(p),
      ),
    )
    assert.ok(results.every((r) => r.data.ok))
    assert.equal(s.refreshCalls(), 1, 'rotating refresh tokens must not be refreshed in parallel')
  })

  it('concurrent explicit refresh() calls (e.g. StrictMode double effect) also share one request', async () => {
    const s = fakeServer({ refreshDelay: 20 })
    const api = new ApiClient('/api/v1', s.fetchFn)
    const [a, b, c] = await Promise.all([api.refresh(), api.refresh(), api.refresh()])
    assert.deepEqual([a, b, c], [true, true, true])
    assert.equal(s.refreshCalls(), 1)
  })

  it('when the session has ended, refresh fails once, signs out locally and the error surfaces', async () => {
    const s = fakeServer({ refreshOk: false })
    const api = new ApiClient('/api/v1', s.fetchFn)
    const events: (string | null)[] = []
    api.onSession((x) => events.push(x ? x.user.id : null))
    await api.login('a', 'b')
    s.expireAccessToken()
    await assert.rejects(api.get('/sales'), (e: unknown) => e instanceof ApiError && e.status === 401)
    assert.equal(s.refreshCalls(), 1, 'no refresh loop')
    assert.deepEqual(events, ['u1', null])
    assert.equal(api.hasAccessToken, false)
  })

  it('a network failure during refresh does not sign the user out', async () => {
    const s = fakeServer({ refreshNetworkError: true })
    const api = new ApiClient('/api/v1', s.fetchFn)
    await api.login('a', 'b')
    assert.equal(await api.refresh(), false)
    assert.equal(api.hasAccessToken, true)
  })

  it('logout clears the in-memory token even if the server cannot be reached', async () => {
    const api = new ApiClient('/api/v1', async (url) => {
      if (url.endsWith('/auth/login')) return json(200, { data: { accessToken: 't', user: USER }, meta: {} })
      throw new TypeError('offline')
    })
    await api.login('a', 'b')
    await api.logout()
    assert.equal(api.hasAccessToken, false)
  })
})

describe('ApiClient — errors', () => {
  it('maps the backend error envelope (code, details, requestId)', async () => {
    const api = new ApiClient('/api/v1', async () =>
      json(409, {
        statusCode: 409,
        code: 'INSUFFICIENT_STOCK',
        message: 'Not enough available stock',
        requestId: 'req-1',
        details: [{ field: 'items.1.quantity', messages: ['only 2 CABLE available at this branch'] }],
      }),
    )
    const err = await api.post('/pos/quote', { items: [] }).catch((e: unknown) => e)
    assert.ok(err instanceof ApiError)
    assert.equal(err.code, 'INSUFFICIENT_STOCK')
    assert.equal(err.requestId, 'req-1')
    assert.deepEqual(err.fieldMessages('items.1'), ['only 2 CABLE available at this branch'])
    assert.deepEqual(err.fieldMessages('payments'), [])
  })

  it('a failed connection becomes NETWORK_ERROR (status 0) so callers can retry safely', async () => {
    const api = new ApiClient('/api/v1', async () => {
      throw new TypeError('fetch failed')
    })
    const err = await api.get('/sales').catch((e: unknown) => e)
    assert.ok(err instanceof ApiError)
    assert.equal(err.isNetworkError, true)
    assert.equal(err.code, 'NETWORK_ERROR')
  })

  it('builds query strings without empty values', async () => {
    const s = fakeServer()
    const api = new ApiClient('/api/v1', s.fetchFn)
    await api.login('a', 'b')
    await api.get('/sales', { from: '2026-11-16', branchId: undefined, receiptNumber: '', page: 2 })
    assert.equal(s.calls.at(-1)!.url, '/api/v1/sales?from=2026-11-16&page=2')
  })
})
