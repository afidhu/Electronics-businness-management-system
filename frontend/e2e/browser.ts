/**
 * Real-browser end-to-end test (Chrome via the DevTools protocol; no extra
 * dependencies). Drives the frontend served by Vite (E2E_APP, default
 * http://localhost:5174) whose /api proxy points at a backend running on the
 * TEST database (E2E_API, default http://localhost:3100/api/v1).
 *
 *   purchase (API fixture) → receive (inventory officer, UI) → search →
 *   device selection → server quote → split payment → checkout → receipt,
 *   plus refresh, role navigation, failures and duplicate-checkout retries.
 *
 * Usage: see e2e/README.md. Screenshots go to e2e/screenshots/.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADMIN, API, USER_PASSWORD, buildFixture, imei, loginToken, type Fixture } from './fixture.ts'

const APP = process.env.E2E_APP ?? 'http://localhost:5174'
const CHROME = process.env.CHROME_BIN ?? 'google-chrome'
const SHOTS = join(import.meta.dirname, 'screenshots')
const PORT = 9300 + Math.floor(Math.random() * 500)

// ------------------------------------------------------------------ CDP
type Json = Record<string, unknown>
class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, ((p: Json) => void)[]>()
  private ws: WebSocket
  constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: Json; result?: Json; error?: { message: string } }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) p?.reject(new Error(msg.error.message))
        else p?.resolve(msg.result ?? {})
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params ?? {})
      }
    })
  }
  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(method: string, h: (p: Json) => void) {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), h])
  }
  off(method: string, h: (p: Json) => void) {
    this.handlers.set(method, (this.handlers.get(method) ?? []).filter((x) => x !== h))
  }
  /** Fire-and-forget command (errors are logged, never thrown). */
  fire(method: string, params: Json = {}) {
    this.send(method, params).catch((e: unknown) => console.log(`    (cdp ${method}: ${e instanceof Error ? e.message : e})`))
  }
}

// ---------------------------------------------------------------- results
const results: { name: string; ok: boolean; detail?: string }[] = []
let currentStep = ''
function check(cond: unknown, name: string, detail?: string) {
  results.push({ name: `${currentStep} › ${name}`, ok: !!cond, detail: cond ? undefined : detail })
  console.log(`${cond ? '  ✔' : '  ✖'} ${name}${cond || !detail ? '' : ` — ${detail}`}`)
}
function step(name: string) {
  currentStep = name
  console.log(`\n▶ ${name}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------- page
class Page {
  private cdp: Cdp
  apiCalls: { method: string; url: string }[] = []
  authResponses: { url: string; status: number }[] = []
  constructor(cdp: Cdp) {
    this.cdp = cdp
    cdp.on('Network.responseReceived', (p) => {
      const r = p.response as { url: string; status: number }
      if (r.url.includes('/api/v1/auth/')) this.authResponses.push({ url: r.url.replace(/^.*\/api\/v1/, ''), status: r.status })
    })
    cdp.on('Network.requestWillBeSent', (p) => {
      const r = p.request as { method: string; url: string }
      if (r.url.includes('/api/v1/')) this.apiCalls.push({ method: r.method, url: r.url })
    })
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = (await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
      result: { value?: T }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value as T
  }
  async goto(hash: string) {
    await this.cdp.send('Page.navigate', { url: `${APP}/${hash}` })
    await sleep(400)
  }
  async waitFor(expr: string, label: string, timeout = 10_000): Promise<boolean> {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      try {
        if (await this.eval<boolean>(`!!(${expr})`)) return true
      } catch {
        // page navigating
      }
      await sleep(100)
    }
    const shot = `fail-${results.length + 1}`
    await this.screenshot(shot).catch(() => {})
    check(false, `waited for ${label}`, `timeout after ${timeout} ms (screenshot ${shot}.png; auth: ${JSON.stringify(this.authResponses.slice(-4))})`)
    return false
  }
  sel(testId: string) {
    return `document.querySelector('[data-testid="${testId}"]')`
  }
  async exists(testId: string) {
    return this.eval<boolean>(`!!${this.sel(testId)}`)
  }
  async text(testId: string) {
    return this.eval<string>(`(${this.sel(testId)}?.innerText ?? '').trim()`)
  }
  async bodyText() {
    return this.eval<string>('document.body.innerText')
  }
  async waitTestId(testId: string, timeout?: number) {
    return this.waitFor(this.sel(testId), testId, timeout)
  }
  async click(testId: string) {
    await this.waitTestId(testId)
    await this.eval(`${this.sel(testId)}.click()`)
  }
  /** Set a React-controlled input/select value the way a user would. */
  async fill(testId: string, value: string) {
    await this.waitTestId(testId)
    await this.eval(`(() => {
      const el = ${this.sel(testId)};
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    })()`)
  }
  async submitForm(testId: string) {
    await this.eval(`${this.sel(testId)}.requestSubmit()`)
  }
  async screenshot(name: string) {
    const r = (await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })) as { data: string }
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'))
  }
  async viewport(width: number, height: number, mobile = false) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  }
  async media(media: '' | 'print') {
    await this.cdp.send('Emulation.setEmulatedMedia', { media })
  }
  async login(email: string, password = USER_PASSWORD) {
    await this.goto('#/login')
    await this.waitTestId('login-form')
    await this.fill('login-email', email)
    await this.fill('login-password', password)
    await this.submitForm('login-form')
    await this.waitTestId('user-chip')
  }
  async logout() {
    await this.click('logout')
    await this.waitTestId('login-form')
  }
  async navLabels() {
    return this.eval<string[]>(`[...document.querySelectorAll('.nav .nav-link')].map((a) => a.innerText.trim())`)
  }
}

// ------------------------------------------------------- API verification
async function apiGet<T>(token: string, path: string): Promise<{ data: T; meta: { pagination?: { total: number } } }> {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await r.json()) as { data: T; meta: { pagination?: { total: number } } }
}

// ------------------------------------------------------------------- main
async function main() {
  mkdirSync(SHOTS, { recursive: true })
  console.log('Building fixture through the API (test database)…')
  const fx: Fixture = await buildFixture()
  console.log(`Branch ${fx.branch.code}; purchase ${fx.purchaseReference}`)

  const profile = mkdtempSync(join(tmpdir(), 'ebms-e2e-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  try {
    let targets: { type: string; webSocketDebuggerUrl: string }[] = []
    for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
      await sleep(200)
      try {
        targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as typeof targets
      } catch {
        // starting
      }
    }
    const target = targets.find((t) => t.type === 'page')
    if (!target) throw new Error('Chrome did not start')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((r, j) => {
      ws.addEventListener('open', r)
      ws.addEventListener('error', j)
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    const page = new Page(cdp)
    await page.viewport(1440, 900)
    await run(page, cdp, fx)
    ws.close()
  } finally {
    chrome.kill('SIGTERM')
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    for (const f of failed) console.log(`FAILED: ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
    process.exit(1)
  }
}

async function run(page: Page, cdp: Cdp, fx: Fixture) {
  const laptopSerials = [`5CG${fx.run}01`, `5CG${fx.run}02`]
  const phoneImeis = [imei(`3520990${String(Date.now()).slice(-7)}`), imei(`3520991${String(Date.now()).slice(-7)}`)]

  // --------------------------------------------------------------- login
  step('Login and authentication')
  await page.goto('#/dashboard')
  check(await page.waitTestId('login-form'), 'unauthenticated users are sent to the login screen')
  await page.screenshot('01-login')
  await page.fill('login-email', fx.users.cashier.email)
  await page.fill('login-password', 'wrong-password-123')
  await page.submitForm('login-form')
  await page.waitTestId('login-error')
  check((await page.text('login-error')).includes('Incorrect email or password'), 'wrong password shows a clear error')

  // ----------------------------------------------------------- receiving
  step('Receiving with IMEI/serial entry (inventory officer)')
  await page.login(fx.users.inventory.email)
  check(
    JSON.stringify(await page.navLabels()) === JSON.stringify(['Dashboard', 'Stock', 'Receiving']),
    'inventory officer navigation: Dashboard, Stock, Receiving',
    JSON.stringify(await page.navLabels()),
  )
  await page.goto('#/receiving')
  await page.waitTestId(`receive-${fx.purchaseReference}`)
  await page.screenshot('02-receiving-list')
  await page.click(`receive-${fx.purchaseReference}`)
  await page.waitTestId('receive-form')
  const lap = fx.products.laptop.sku
  const ph = fx.products.phone.sku
  // Leave one identifier blank first: client-side validation must stop the submit.
  await page.fill(`ident-${lap}-0-0`, laptopSerials[0])
  await page.submitForm('receive-form')
  await page.waitTestId('receive-form-error')
  check((await page.text('receive-form-error')).includes('enter every'), 'missing serials are flagged before sending')
  await page.fill(`ident-${lap}-1-0`, laptopSerials[1])
  await page.fill(`ident-${ph}-0-0`, phoneImeis[0])
  await page.fill(`ident-${ph}-0-1`, phoneImeis[1])
  await page.screenshot('03-receiving-form')
  await page.submitForm('receive-form')
  check(await page.waitTestId('receive-success'), 'goods receipt recorded')
  check((await page.text('receive-success')).includes('GRN-'), 'GRN reference shown', await page.text('receive-success'))
  await page.screenshot('04-receiving-done')
  await page.goto('#/inventory')
  await page.waitTestId('stock-table')
  await page.fill('stock-search', fx.run)
  await sleep(700)
  const stockText = await page.text('stock-table')
  check(stockText.includes(fx.products.cable.sku) && /\b20\b/.test(stockText), 'stock shows 20 cables received')
  check(!/cost|1,400,000|1400000/i.test(await page.bodyText()), 'no cost figures on the stock screen')
  await page.screenshot('05-stock')
  await page.logout()

  // -------------------------------------------- cashier: nav, refresh, guard
  step('Cashier session, token refresh and role navigation')
  await page.login(fx.users.cashier.email)
  check(
    JSON.stringify(await page.navLabels()) === JSON.stringify(['Dashboard', 'Point of sale', 'Sales history', 'Stock']),
    'cashier navigation: Dashboard, POS, Sales history, Stock',
    JSON.stringify(await page.navLabels()),
  )
  const storage = await page.eval<string>('JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie')
  check(!/eyJ|ebms_refresh/.test(storage), 'no access or refresh token in localStorage, sessionStorage or JS-readable cookies')
  // Reload: the in-memory token is gone; the HttpOnly cookie restores the session.
  page.apiCalls = []
  await cdp.send('Page.reload')
  await page.waitTestId('user-chip')
  const refreshes = page.apiCalls.filter((c) => c.url.endsWith('/auth/refresh')).length
  check(refreshes === 1, 'after reload the session is restored with exactly one refresh call', `refresh calls: ${refreshes}`)
  // Expired access token mid-session: the server answers 401 → one refresh → retry.
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/pos/catalogue*', requestStage: 'Request' }] })
  let rejected = 0
  const onPaused = (p: Json) => {
    const requestId = p.requestId as string
    if (rejected < 2) {
      rejected++
      cdp.fire('Fetch.fulfillRequest', {
        requestId,
        responseCode: 401,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Invalid or expired token', requestId: 'sim' })).toString('base64'),
      })
    } else cdp.fire('Fetch.continueRequest', { requestId })
  }
  cdp.on('Fetch.requestPaused', onPaused)
  page.apiCalls = []
  await page.goto('#/pos')
  await page.waitTestId(`pos-product-${fx.products.cable.sku}`, 15_000)
  await cdp.send('Fetch.disable')
  cdp.off('Fetch.requestPaused', onPaused)
  const r2 = page.apiCalls.filter((c) => c.url.endsWith('/auth/refresh')).length
  check(rejected >= 1 && r2 === 1, 'an expired access token is refreshed once and the request retried', `401s: ${rejected}, refreshes: ${r2}`)
  await page.goto('#/settings/vat')
  check(await page.waitTestId('forbidden'), 'cashier deep link to VAT settings is refused')
  await page.goto('#/summary')
  check(await page.waitTestId('forbidden'), 'cashier deep link to the daily summary is refused')

  // ------------------------------------------------ POS search → checkout
  step('POS: search, device selection, cart, server quote')
  await page.goto('#/pos')
  await page.fill('pos-search', 'ProBook')
  await page.waitTestId(`pos-product-${lap}`)
  await page.click(`pos-product-${lap}`)
  await page.waitTestId('unit-picker')
  check(await page.exists(`unit-${laptopSerials[0]}`), 'device picker lists received serials')
  await page.screenshot('06-device-picker')
  await page.click(`unit-${laptopSerials[0]}`)
  await page.fill('pos-search', fx.products.cable.sku)
  await page.waitTestId(`pos-product-${fx.products.cable.sku}`)
  await page.click(`pos-product-${fx.products.cable.sku}`)
  await page.waitTestId('cart-qty-1')
  await page.fill('cart-qty-1', '2')
  await page.waitFor(`${page.sel('quote-total')}?.innerText.includes('2,100,400.00')`, 'server total 2,100,400.00')
  check((await page.text('quote-subtotal')).includes('1,780,000.00'), 'server subtotal 1,780,000.00')
  check((await page.text('quote-tax')).includes('320,400.00'), 'server VAT 18% = 320,400.00')
  check(!/cost/i.test(await page.bodyText()), 'no cost information anywhere on the POS screen')

  // Failed request: more cables than in stock → server refuses, checkout disabled.
  await page.fill('cart-qty-1', '50')
  await page.waitTestId('quote-error')
  check((await page.text('quote-error')).toLowerCase().includes('available'), 'insufficient stock is reported by the server', await page.text('quote-error'))
  check(await page.eval<boolean>(`${page.sel('checkout-submit')}.disabled`), 'checkout is disabled while the quote is invalid')
  await page.screenshot('07-pos-insufficient-stock')
  await page.fill('cart-qty-1', '2')
  await page.waitFor(`${page.sel('quote-total')}?.innerText.includes('2,100,400.00')`, 'quote recovers')

  step('Checkout with split payment (mobile money + cash with change)')
  await page.fill('pay-method-0', 'MOBILE_MONEY')
  await page.fill('pay-amount-0', '1500000')
  check(await page.eval<boolean>(`${page.sel('checkout-submit')}.disabled`), 'checkout disabled until payments equal the total')
  await page.fill('pay-reference-0', 'MP26111712AB')
  await page.click('pay-add')
  await page.waitTestId('pay-method-1')
  await page.fill('pay-method-1', 'CASH')
  await page.click('pay-fill-1')
  await page.waitFor(`${page.sel('pay-amount-1')}.value === '600400.00'`, 'remaining amount filled from the server total')
  await page.fill('pay-tendered-1', '601000')
  await page.waitTestId('pay-change')
  check((await page.text('pay-change')).includes('600.00'), 'change hint 600.00')
  await page.screenshot('08-pos-ready')
  await page.click('checkout-submit')
  await page.waitTestId('receipt', 15_000)
  const receipt1 = await page.text('receipt-number')
  check(new RegExp(`^RCT-${fx.branch.code}-\\d{4}-000001$`).test(receipt1), 'receipt number RCT-<branch>-<year>-000001', receipt1)
  check((await page.text('receipt-total')).includes('2,100,400.00'), 'receipt total 2,100,400.00')
  check((await page.text('receipt-change')).includes('600.00'), 'receipt change 600.00')
  check((await page.text('receipt')).includes(laptopSerials[0]), 'receipt lists the sold serial number')
  check(!/cost/i.test(await page.bodyText()), 'receipt shows no cost')
  check(await page.exists('print-receipt'), 'print button available')
  await page.screenshot('09-receipt')
  await page.media('print')
  await page.screenshot('10-receipt-print-preview')
  await page.media('')

  // ------------------------------------ duplicate checkout / lost response
  step('Lost response + retry never creates a duplicate sale')
  const cashierToken = await loginToken(fx.users.cashier.email, USER_PASSWORD)
  const salesBefore = (await apiGet<unknown[]>(cashierToken, `/sales?branchId=${fx.branch.id}&limit=1`)).meta.pagination!.total
  await page.goto('#/pos')
  await page.waitTestId('pos-scan')
  await page.fill('pos-scan', phoneImeis[1]) // scan the SECOND IMEI of the dual-SIM phone
  await page.submitForm('pos-scan-form')
  await page.waitTestId('cart-line-0')
  check((await page.text('cart-line-0')).includes(phoneImeis[0]), 'scanning either IMEI adds the phone (both IMEIs shown)')
  await page.waitFor(`${page.sel('quote-total')}?.innerText.includes('1,062,000.00')`, 'phone total 1,062,000.00')
  await page.click('pay-fill-0')
  await page.waitFor(`${page.sel('pay-amount-0')}.value === '1062000.00'`, 'cash amount filled')
  // Let the request reach the server (the sale commits) but drop the response.
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/sales', requestStage: 'Response' }] })
  let dropped = 0
  let sentKeys: string[] = []
  const onSent = (p: Json) => {
    const r = p.request as { method: string; url: string; postData?: string }
    if (r.method === 'POST' && r.url.endsWith('/api/v1/sales') && r.postData) {
      sentKeys.push((JSON.parse(r.postData) as { idempotencyKey: string }).idempotencyKey)
    }
  }
  cdp.on('Network.requestWillBeSent', onSent)
  const onSalePaused = (p: Json) => {
    const url = (p.request as { url: string }).url
    if (!url.endsWith('/api/v1/sales')) return
    const requestId = p.requestId as string
    if (dropped === 0) {
      dropped++
      cdp.fire('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' })
    } else cdp.fire('Fetch.continueRequest', { requestId })
  }
  cdp.on('Fetch.requestPaused', onSalePaused)
  await page.click('checkout-submit')
  check(await page.waitTestId('checkout-uncertain'), 'a lost response is reported as uncertain, with a safe retry')
  check(await page.eval<boolean>(`${page.sel('pos-scan')}.disabled`), 'the cart is locked while the outcome is uncertain')
  await page.screenshot('11-pos-lost-response')
  const afterDrop = (await apiGet<unknown[]>(cashierToken, `/sales?branchId=${fx.branch.id}&limit=1`)).meta.pagination!.total
  check(afterDrop === salesBefore + 1, 'the server did complete the sale despite the lost response')
  await page.click('checkout-retry')
  await page.waitTestId('receipt', 15_000)
  await cdp.send('Fetch.disable')
  cdp.off('Fetch.requestPaused', onSalePaused)
  const receipt2 = await page.text('receipt-number')
  const afterRetry = (await apiGet<unknown[]>(cashierToken, `/sales?branchId=${fx.branch.id}&limit=1`)).meta.pagination!.total
  check(afterRetry === salesBefore + 1, 'retry returned the original sale — no duplicate', `sales: ${afterRetry}`)
  check(receipt2.endsWith('-000002'), 'the receipt shown is the one sale (000002)', receipt2)
  check(sentKeys.length === 2 && sentKeys[0] === sentKeys[1], 'both attempts carried the same idempotency key', JSON.stringify(sentKeys))

  step('Double click on "Complete sale" creates one sale')
  sentKeys = []
  await page.goto('#/pos')
  await page.fill('pos-search', fx.products.cable.sku)
  await page.click(`pos-product-${fx.products.cable.sku}`)
  await page.waitFor(`${page.sel('quote-total')}?.innerText.includes('17,700.00')`, 'cable total 17,700.00')
  await page.fill('pay-method-0', 'CARD')
  await page.click('pay-fill-0')
  await page.waitFor(`!${page.sel('checkout-submit')}.disabled`, 'checkout enabled')
  await page.eval(`(() => { const b = ${page.sel('checkout-submit')}; b.click(); b.click(); b.click(); })()`)
  await page.waitTestId('receipt', 15_000)
  await sleep(500)
  const afterDouble = (await apiGet<unknown[]>(cashierToken, `/sales?branchId=${fx.branch.id}&limit=1`)).meta.pagination!.total
  check(afterDouble === salesBefore + 2, 'one sale for three rapid clicks', `sales: ${afterDouble}`)

  step('Sales history')
  await page.goto('#/sales')
  await page.waitTestId('sales-table')
  const salesText = await page.text('sales-table')
  check(['000001', '000002', '000003'].every((n) => salesText.includes(n)), 'today’s three receipts are listed', salesText)
  check(salesText.includes('Mobile money + Cash'), 'split payment methods shown')
  await page.screenshot('12-sales-history')
  await page.fill('sales-receipt-filter', receipt1)
  await page.click('sales-apply')
  await page.waitFor(`${page.sel('sales-table')}?.querySelectorAll('tbody tr').length === 1`, 'receipt filter narrows to one sale')
  await page.logout()

  // ------------------------------------------------------------- manager
  step('Manager: dashboard and daily summary')
  await page.login(fx.users.manager.email)
  check(
    JSON.stringify(await page.navLabels()) === JSON.stringify(['Dashboard', 'Sales history', 'Daily summary', 'Stock']),
    'manager navigation: no POS, no receiving, no VAT settings',
    JSON.stringify(await page.navLabels()),
  )
  await page.waitTestId('stat-sales-count')
  check((await page.text('stat-sales-count')) === '3', 'dashboard shows 3 sales today')
  await page.screenshot('13-manager-dashboard')
  await page.goto('#/summary')
  await page.waitTestId('summary-stats')
  check((await page.text('summary-count')) === '3', 'summary: 3 sales')
  check((await page.text('summary-total')).includes('3,180,100.00'), 'summary total 2,100,400 + 1,062,000 + 17,700 = 3,180,100.00', await page.text('summary-total'))
  check(await page.exists('summary-profit'), 'manager (cost_read) sees gross profit')
  await page.screenshot('14-daily-summary')
  await page.goto('#/pos')
  check(await page.waitTestId('forbidden'), 'manager cannot open the POS')
  await page.logout()

  step('Cashier never sees cost or profit')
  await page.login(fx.users.cashier.email)
  await page.goto('#/sales')
  await page.waitTestId('sales-table')
  check(!/cost|profit/i.test(await page.bodyText()), 'no cost/profit on the cashier’s sales history')
  await page.logout()

  // --------------------------------------------------------------- admin
  step('Administrator: VAT settings and branch choice')
  await page.login(ADMIN.email, ADMIN.password)
  await page.goto('#/settings/vat')
  await page.waitTestId('vat-current')
  check((await page.text('vat-current')).includes('18%'), 'current VAT 18% shown')
  await page.fill('vat-input', '18.555')
  await page.click('vat-save')
  check(await page.waitTestId('vat-form-error'), 'invalid rate rejected in the form')
  await page.fill('vat-input', '18')
  await page.click('vat-save')
  check(await page.waitTestId('vat-saved'), 'rate saved (same rate is a no-op on the server)')
  await page.screenshot('15-vat-settings')
  await page.goto('#/pos')
  check(await page.waitTestId('pos-choose-branch'), 'a multi-branch admin must choose the selling branch')
  await page.fill('branch-select', fx.branch.id)
  check(await page.waitTestId('pos-search'), 'after choosing a branch the POS opens')

  // ------------------------------------------------------------ responsive
  step('Responsive layout')
  await page.viewport(820, 1180, true)
  await page.goto('#/pos')
  await page.waitTestId('pos-search')
  await page.screenshot('16-tablet-pos')
  await page.viewport(390, 844, true)
  await page.goto('#/dashboard')
  await page.waitTestId('user-chip')
  const sidebarHidden = await page.eval<boolean>(`getComputedStyle(document.querySelector('.sidebar')).display === 'none'`)
  check(sidebarHidden, 'on a phone the sidebar collapses behind the menu button')
  await page.eval(`document.querySelector('.menu-toggle').click()`)
  await sleep(200)
  check(await page.eval<boolean>(`getComputedStyle(document.querySelector('.sidebar')).display !== 'none'`), 'menu button opens navigation')
  await page.screenshot('17-phone-menu')
  const overflow = await page.eval<boolean>('document.documentElement.scrollWidth > window.innerWidth + 1')
  check(!overflow, 'no horizontal page scroll at 390 px')
  await page.viewport(1440, 900)
  await page.logout()
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
