import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { CatalogueItem, PaymentInput, PaymentMethod, PosUnit, Quote, SaleDetail } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, Money, PageHeader, Spinner } from '../components/ui.tsx'
import { METHOD_LABELS, errorText } from '../lib/format.ts'
import { useDebounced } from '../lib/hooks.ts'
import { addQuantity, addUnit, removeLine, setQuantity, toRequestItems, type CartLine, type CartProduct } from '../lib/cart.ts'
import { IdempotencyKeys } from '../lib/idempotency.ts'
import { isMoney, paymentProgress } from '../lib/money.ts'
import { navigate } from '../lib/router.ts'

const keys = new IdempotencyKeys()
const CHECKOUT_SCOPE = 'checkout'
const METHODS: PaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER']

interface PaymentDraft extends PaymentInput {
  rowId: number
}

let rowSeq = 1
const newPayment = (method: PaymentMethod = 'CASH', amount = ''): PaymentDraft => ({ rowId: rowSeq++, method, amount })

/** Is this failure ambiguous (the sale may exist)? Then the same key must be reused. */
function uncertain(e: unknown): boolean {
  return e instanceof ApiError && (e.isNetworkError || e.status >= 500)
}

export function PosPage() {
  const { branch, branches } = useSession()
  const multiBranch = branches.length > 1

  // ---- catalogue search
  const [q, setQ] = useState('')
  const query = useDebounced(q, 250)
  const [results, setResults] = useState<CatalogueItem[] | null>(null)
  const [searchError, setSearchError] = useState<unknown>(null)

  // ---- cart + server quote
  const [lines, setLines] = useState<CartLine[]>([])
  const [cartError, setCartError] = useState<string | null>(null)
  // Each server response is tagged with the exact request it answered, so a
  // stale quote (cart changed since) is never shown as current or used to pay.
  const [quoteState, setQuoteState] = useState<{ key: string; quote: Quote | null; error: unknown } | null>(null)

  // ---- device picker / scanner
  const [picker, setPicker] = useState<{ product: CatalogueItem; units: PosUnit[] | null; error?: unknown } | null>(null)
  const [scan, setScan] = useState('')
  const [scanError, setScanError] = useState<unknown>(null)

  // ---- payments + checkout
  const [payments, setPayments] = useState<PaymentDraft[]>([newPayment()])
  const [checkoutError, setCheckoutError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingRetry, setPendingRetry] = useState(false)

  const branchParam = multiBranch ? branch?.id : undefined

  // Search active products with stock at the selling branch.
  useEffect(() => {
    if (!branch) return
    const ctrl = new AbortController()
    api
      .get<CatalogueItem[]>('/pos/catalogue', { branchId: branchParam, q: query.trim() || undefined, limit: 20 }, ctrl.signal)
      .then((r) => {
        setResults(r.data)
        setSearchError(null)
      })
      .catch((e) => !ctrl.signal.aborted && setSearchError(e))
    return () => ctrl.abort()
  }, [query, branch, branchParam])

  // Server price preview whenever the cart changes (never computed here).
  const items = useMemo(() => toRequestItems(lines), [lines])
  const quoteKey = useMemo(() => JSON.stringify({ branchParam, items }), [branchParam, items])
  useEffect(() => {
    if (!branch || items.length === 0) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      api
        .request<Quote>('POST', '/pos/quote', { body: { branchId: branchParam, items }, signal: ctrl.signal })
        .then((r) => setQuoteState({ key: quoteKey, quote: r.data, error: null }))
        .catch((e) => {
          if (!ctrl.signal.aborted) setQuoteState({ key: quoteKey, quote: null, error: e })
        })
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [items, branch, branchParam, quoteKey])

  const current = items.length > 0 && quoteState?.key === quoteKey ? quoteState : null
  const quote = current?.quote ?? null
  const quoteError = current?.error ?? null
  const quoting = items.length > 0 && !current
  const quoteFresh = !!quote
  const progress = quote ? paymentProgress(quote.total, payments) : null

  const apply = (r: ReturnType<typeof addQuantity>) => {
    if (r.ok) {
      setLines(r.lines)
      setCartError(null)
    } else setCartError(r.error)
  }

  const toCartProduct = (p: CatalogueItem): CartProduct => ({ id: p.id, sku: p.sku, name: p.name, trackingMode: p.trackingMode })

  async function choose(p: CatalogueItem) {
    if (p.trackingMode === 'QUANTITY') {
      apply(addQuantity(lines, toCartProduct(p)))
      return
    }
    setPicker({ product: p, units: null })
    try {
      const r = await api.get<PosUnit[]>('/pos/units', { branchId: branchParam, productId: p.id, limit: 100 })
      setPicker({ product: p, units: r.data })
    } catch (e) {
      setPicker({ product: p, units: [], error: e })
    }
  }

  async function onScan(e: FormEvent) {
    e.preventDefault()
    const value = scan.trim()
    if (!value) return
    setScanError(null)
    try {
      const r = await api.get<PosUnit[]>('/pos/units', { branchId: branchParam, identifier: value })
      const unit = r.data[0]
      const known = results?.find((p) => p.id === unit.productId)
      apply(
        addUnit(
          lines,
          known ? toCartProduct(known) : { id: unit.productId, sku: unit.sku, name: unit.sku, trackingMode: 'SERIALIZED' },
          { id: unit.id, identifiers: unit.identifiers },
        ),
      )
      setScan('')
    } catch (err) {
      setScanError(err)
    }
  }

  const updatePayment = (rowId: number, patch: Partial<PaymentDraft>) =>
    setPayments((ps) => ps.map((p) => (p.rowId === rowId ? { ...p, ...patch } : p)))

  /** Fill a row with what is still due (server total minus the other rows). */
  function fillRemaining(rowId: number) {
    if (!quote) return
    const others = payments.filter((p) => p.rowId !== rowId)
    const due = paymentProgress(quote.total, others).remaining
    if (!due.startsWith('-')) updatePayment(rowId, { amount: due })
  }

  const paymentProblems = useMemo(() => {
    const out: string[] = []
    payments.forEach((p, i) => {
      const n = `Payment ${i + 1}`
      if (!isMoney(p.amount) || /^0+(\.0+)?$/.test(p.amount.trim())) out.push(`${n}: enter an amount greater than 0.`)
      if (p.method === 'CASH' && p.amountTendered && !isMoney(p.amountTendered)) out.push(`${n}: cash received is not a valid amount.`)
      if ((p.method === 'MOBILE_MONEY' || p.method === 'BANK_TRANSFER') && !p.reference?.trim()) {
        out.push(`${n}: a transaction reference is required for ${METHOD_LABELS[p.method].toLowerCase()}.`)
      }
    })
    return out
  }, [payments])

  const checkoutBody = useCallback(() => {
    return {
      branchId: branchParam,
      items,
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount.trim(),
        ...(p.method === 'CASH' && p.amountTendered?.trim() ? { amountTendered: p.amountTendered.trim() } : {}),
        ...(p.method !== 'CASH' && p.reference?.trim() ? { reference: p.reference.trim() } : {}),
      })),
    }
  }, [branchParam, items, payments])

  const submittingRef = useRef(false)
  async function checkout() {
    if (submittingRef.current) return // double click
    submittingRef.current = true
    setSubmitting(true)
    setCheckoutError(null)
    const body = checkoutBody()
    const idempotencyKey = keys.keyFor(CHECKOUT_SCOPE, body)
    try {
      const r = await api.post<SaleDetail>('/sales', { ...body, idempotencyKey })
      keys.clear(CHECKOUT_SCOPE)
      setPendingRetry(false)
      setLines([])
      setPayments([newPayment()])
      navigate(`/sales/${r.data.id}/receipt?new=1`)
    } catch (e) {
      if (uncertain(e)) {
        setPendingRetry(true) // same payload + same key on retry → no duplicate sale
      } else {
        keys.clear(CHECKOUT_SCOPE)
        setPendingRetry(false)
      }
      setCheckoutError(e)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function abandonRetry() {
    setPendingRetry(false)
    setCheckoutError(null)
  }

  if (!branch) {
    return (
      <>
        <PageHeader title="Point of sale" />
        <Alert kind="info" testId="pos-choose-branch">
          {branches.length === 0 ? 'You have no active branch assigned.' : 'Choose the selling branch at the top of the page.'}
        </Alert>
      </>
    )
  }

  const locked = submitting || pendingRetry
  const canCheckout = quoteFresh && lines.length > 0 && paymentProblems.length === 0 && !!progress?.exact && !locked

  return (
    <>
      <PageHeader title="Point of sale" subtitle={`${branch.code} · ${branch.name} · prices exclude VAT; VAT is added by the server`} />
      <div className="pos">
        {/* ------------------------------------------------ products */}
        <section className="card pos-products" aria-label="Products">
          <form onSubmit={onScan} className="scan-row">
            <input
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan or type IMEI / serial"
              aria-label="Scan IMEI or serial"
              data-testid="pos-scan"
              disabled={locked}
            />
            <button className="btn" type="submit" disabled={locked}>
              Add
            </button>
          </form>
          <ErrorAlert error={scanError} testId="pos-scan-error" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, SKU or brand"
            aria-label="Search products"
            data-testid="pos-search"
          />
          <ErrorAlert error={searchError} />
          {!results && !searchError && <Spinner />}
          {results && results.length === 0 && <Empty>No active products match.</Empty>}
          <ul className="product-list" data-testid="pos-results">
            {results?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="product-item"
                  disabled={!p.inStock || locked}
                  onClick={() => void choose(p)}
                  data-testid={`pos-product-${p.sku}`}
                >
                  <span className="product-main">
                    <span className="product-name">{p.name}</span>
                    <span className="muted small mono">
                      {p.sku} · {p.brand}
                      {p.trackingMode === 'SERIALIZED' ? ` · ${p.identifierType}` : ''}
                    </span>
                  </span>
                  <span className="product-side">
                    <Money value={p.sellingPrice} currency={p.currency} />
                    <span className={p.inStock ? 'small ok' : 'small warn'}>{p.inStock ? `${p.available} available` : 'Out of stock'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------ cart */}
        <section className="card pos-cart" aria-label="Cart">
          <h2>Cart</h2>
          {cartError && <Alert kind="warning">{cartError}</Alert>}
          {lines.length === 0 && <Empty>Add products from the list or scan a device.</Empty>}
          {lines.length > 0 && (
            <ul className="cart-lines" data-testid="cart-lines">
              {lines.map((l, i) => {
                const ql = quote?.lines[i]
                return (
                  <li key={l.key} className="cart-line" data-testid={`cart-line-${i}`}>
                    <div className="cart-line-main">
                      <span className="product-name">{ql?.name ?? l.product.name}</span>
                      <span className="muted small mono">{l.product.sku}</span>
                      {l.unit && (
                        <span className="small mono ident">
                          {l.unit.identifiers.map((x) => `${x.type} ${x.value}`).join(' · ')}
                        </span>
                      )}
                    </div>
                    <div className="cart-line-qty">
                      {l.unit ? (
                        <span className="muted">1</span>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={l.quantity}
                          aria-label={`Quantity of ${l.product.sku}`}
                          disabled={locked}
                          onChange={(e) => apply(setQuantity(lines, l.key, Number(e.target.value)))}
                          data-testid={`cart-qty-${i}`}
                        />
                      )}
                    </div>
                    <div className="cart-line-total">{ql ? <Money value={ql.lineTotal} /> : <span className="muted">…</span>}</div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      aria-label={`Remove ${l.product.sku}`}
                      disabled={locked}
                      onClick={() => setLines(removeLine(lines, l.key))}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <ErrorAlert error={quoteError} testId="quote-error" />
          {lines.length > 0 && (
            <dl className="totals" data-testid="quote-totals" aria-busy={quoting}>
              <dt>Subtotal</dt>
              <dd data-testid="quote-subtotal">{quote ? <Money value={quote.subtotal} /> : '…'}</dd>
              <dt>VAT {quote ? `${Number(quote.taxRatePercent)}%` : ''}</dt>
              <dd data-testid="quote-tax">{quote ? <Money value={quote.taxAmount} /> : '…'}</dd>
              <dt className="grand">Total</dt>
              <dd className="grand" data-testid="quote-total">{quote ? <Money value={quote.total} strong /> : '…'}</dd>
            </dl>
          )}
          {quoting && <p className="muted small">Updating prices from the server…</p>}
        </section>

        {/* ------------------------------------------------ payment */}
        <section className="card pos-pay" aria-label="Payment">
          <h2>Payment</h2>
          {payments.map((p, i) => (
            <div key={p.rowId} className="pay-row" data-testid={`pay-row-${i}`}>
              <select
                value={p.method}
                aria-label={`Payment ${i + 1} method`}
                disabled={locked}
                onChange={(e) => updatePayment(p.rowId, { method: e.target.value as PaymentMethod })}
                data-testid={`pay-method-${i}`}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
              <div className="pay-amount">
                <input
                  inputMode="decimal"
                  placeholder="Amount"
                  value={p.amount}
                  aria-label={`Payment ${i + 1} amount`}
                  disabled={locked}
                  onChange={(e) => updatePayment(p.rowId, { amount: e.target.value })}
                  data-testid={`pay-amount-${i}`}
                />
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!quote || locked}
                  onClick={() => fillRemaining(p.rowId)}
                  data-testid={`pay-fill-${i}`}
                >
                  Remaining
                </button>
              </div>
              {p.method === 'CASH' ? (
                <input
                  inputMode="decimal"
                  placeholder="Cash received (optional)"
                  value={p.amountTendered ?? ''}
                  aria-label={`Payment ${i + 1} cash received`}
                  disabled={locked}
                  onChange={(e) => updatePayment(p.rowId, { amountTendered: e.target.value })}
                  data-testid={`pay-tendered-${i}`}
                />
              ) : (
                <input
                  placeholder={p.method === 'CARD' ? 'Card approval code (optional)' : 'Transaction reference'}
                  value={p.reference ?? ''}
                  maxLength={100}
                  aria-label={`Payment ${i + 1} reference`}
                  disabled={locked}
                  onChange={(e) => updatePayment(p.rowId, { reference: e.target.value })}
                  data-testid={`pay-reference-${i}`}
                />
              )}
              {payments.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  aria-label={`Remove payment ${i + 1}`}
                  disabled={locked}
                  onClick={() => setPayments((ps) => ps.filter((x) => x.rowId !== p.rowId))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {payments.length < 5 && (
            <button
              type="button"
              className="btn btn-small"
              disabled={locked}
              onClick={() => setPayments((ps) => [...ps, newPayment('MOBILE_MONEY')])}
              data-testid="pay-add"
            >
              + Split payment
            </button>
          )}
          {progress && (
            <dl className="totals small" data-testid="pay-progress">
              <dt>Paid</dt>
              <dd><Money value={progress.paid} /></dd>
              <dt>{progress.remaining.startsWith('-') ? 'Over by' : 'Still due'}</dt>
              <dd data-testid="pay-remaining" className={progress.exact ? 'ok' : 'warn'}>
                <Money value={progress.remaining.replace('-', '')} />
              </dd>
              {progress.change !== '0.00' && (
                <>
                  <dt>Change to give</dt>
                  <dd data-testid="pay-change"><Money value={progress.change} /></dd>
                </>
              )}
            </dl>
          )}
          {lines.length > 0 && paymentProblems.length > 0 && (
            <ul className="hints small">{paymentProblems.map((m) => <li key={m}>{m}</li>)}</ul>
          )}
          {pendingRetry && (
            <Alert kind="warning" testId="checkout-uncertain">
              The connection failed before the sale was confirmed. <strong>Retry</strong> to confirm it — the same request
              is resent and can never create a second sale.
            </Alert>
          )}
          {checkoutError !== null && !pendingRetry && <ErrorAlert error={checkoutError} testId="checkout-error" />}
          {pendingRetry && checkoutError !== null && <p className="muted small">{errorText(checkoutError)}</p>}
          <div className="form-actions">
            {pendingRetry ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void checkout()} disabled={submitting} data-testid="checkout-retry">
                  {submitting ? 'Confirming…' : 'Retry checkout'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={abandonRetry} disabled={submitting}>
                  Edit sale
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={!canCheckout}
                onClick={() => void checkout()}
                data-testid="checkout-submit"
              >
                {submitting ? 'Completing sale…' : quote ? `Complete sale · ${quote.currency} ${quote.total}` : 'Complete sale'}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ device picker */}
      {picker && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPicker(null)}>
          <div
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-label={`Choose a ${picker.product.name}`}
            onClick={(e) => e.stopPropagation()}
            data-testid="unit-picker"
          >
            <h2>Choose device · {picker.product.name}</h2>
            <p className="muted small">Only devices in stock at {branch.code} are listed.</p>
            {picker.error !== undefined && <ErrorAlert error={picker.error} />}
            {!picker.units && <Spinner />}
            {picker.units && picker.units.length === 0 && !picker.error && <Empty>No devices available here.</Empty>}
            <ul className="unit-list">
              {picker.units?.map((u) => {
                const inCart = lines.some((l) => l.key === u.id)
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="unit-item"
                      disabled={inCart}
                      onClick={() => {
                        apply(addUnit(lines, toCartProduct(picker.product), { id: u.id, identifiers: u.identifiers }))
                        setPicker(null)
                      }}
                      data-testid={`unit-${u.identifiers[0]?.value}`}
                    >
                      {u.identifiers.map((x) => (
                        <span key={x.value} className="mono">
                          {x.type} {x.value}
                        </span>
                      ))}
                      {inCart && <span className="tag">in cart</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setPicker(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
