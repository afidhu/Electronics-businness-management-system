import { useEffect, useState } from 'react'
import type { SaleDetail } from '../api/types.ts'
import { api } from '../app/api.ts'
import { Alert, ErrorAlert, Spinner } from '../components/ui.tsx'
import { METHOD_LABELS } from '../lib/format.ts'
import { formatMoney } from '../lib/money.ts'

/** Receipt from GET /sales/:id/receipt (never contains costs); printed by the browser. */
export function ReceiptPage({ saleId, isNew }: { saleId: string; isNew: boolean }) {
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    api
      .get<SaleDetail>(`/sales/${saleId}/receipt`)
      .then((r) => setSale(r.data))
      .catch(setError)
  }, [saleId])

  if (error) return <ErrorAlert error={error} />
  if (!sale) return <Spinner />
  const m = (v: string) => formatMoney(v, sale.currency)

  return (
    <>
      <div className="no-print receipt-actions">
        {isNew && (
          <Alert kind="success" testId="sale-complete">
            Sale completed · receipt <strong className="mono">{sale.receiptNumber}</strong>
            {sale.changeGiven !== '0.00' && (
              <>
                {' '}· give change <strong data-testid="sale-change">{m(sale.changeGiven)}</strong>
              </>
            )}
          </Alert>
        )}
        <div className="quick-links">
          <button type="button" className="btn btn-primary" onClick={() => window.print()} data-testid="print-receipt">
            Print receipt
          </button>
          {isNew && (
            <a className="btn" href="#/pos">
              New sale
            </a>
          )}
          <a className="btn btn-ghost" href="#/sales">
            Sales history
          </a>
        </div>
      </div>

      <article className="receipt" data-testid="receipt">
        <header className="receipt-head">
          <h1>{sale.businessName}</h1>
          <p>{sale.branch.name}</p>
          {sale.branch.address && <p>{sale.branch.address}</p>}
          {sale.branch.phone && <p>Tel {sale.branch.phone}</p>}
        </header>
        <dl className="receipt-meta">
          <dt>Receipt</dt>
          <dd className="mono" data-testid="receipt-number">{sale.receiptNumber}</dd>
          <dt>Date</dt>
          <dd>{sale.businessDateTime}</dd>
          <dt>Cashier</dt>
          <dd>{sale.cashier.fullName}</dd>
          {sale.customer && (
            <>
              <dt>Customer</dt>
              <dd>{sale.customer.name}</dd>
            </>
          )}
        </dl>
        <table className="receipt-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.lineNumber}>
                <td>
                  {l.productName}
                  <div className="small mono">{l.sku}</div>
                  {l.unit?.identifiers.map((x) => (
                    <div key={x.value} className="small mono">
                      {x.type}: {x.value}
                    </div>
                  ))}
                </td>
                <td className="num">{l.quantity}</td>
                <td className="num">{m(l.unitPrice)}</td>
                <td className="num">{m(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="receipt-totals" data-testid="receipt-totals">
          <dt>Subtotal (excl. VAT)</dt>
          <dd>{m(sale.subtotal)}</dd>
          <dt>VAT {Number(sale.taxRatePercent)}%</dt>
          <dd>{m(sale.taxAmount)}</dd>
          <dt className="grand">Total</dt>
          <dd className="grand" data-testid="receipt-total">{m(sale.total)}</dd>
          {sale.payments.map((p, i) => (
            <div key={i} className="contents">
              <dt>
                {METHOD_LABELS[p.method]}
                {p.reference ? ` (${p.reference})` : ''}
              </dt>
              <dd>{m(p.amount)}</dd>
              {p.amountTendered && (
                <>
                  <dt className="indent">Cash received</dt>
                  <dd>{m(p.amountTendered)}</dd>
                </>
              )}
            </div>
          ))}
          <dt>Change</dt>
          <dd data-testid="receipt-change">{m(sale.changeGiven)}</dd>
        </dl>
        <footer className="receipt-foot">
          <p>Prices exclude VAT · {sale.timeZone}</p>
          <p>Thank you for shopping with us.</p>
        </footer>
      </article>
    </>
  )
}
