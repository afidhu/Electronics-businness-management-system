import { useEffect, useState, type FormEvent } from 'react'
import type { TaxCurrent } from '../api/types.ts'
import { api } from '../app/api.ts'
import { Alert, ErrorAlert, PageHeader, Spinner } from '../components/ui.tsx'

const RATE_RE = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/

/** VAT rate (S1, BR-20). Only SYSTEM_ADMIN (settings:write) reaches this page; the server enforces it. */
export function VatSettingsPage() {
  const [current, setCurrent] = useState<TaxCurrent | null>(null)
  const [rate, setRate] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    api
      .get<TaxCurrent>('/settings/tax')
      .then((r) => {
        setCurrent(r.data)
        setRate(r.data.ratePercent ? String(Number(r.data.ratePercent)) : '')
      })
      .catch(setError)

  useEffect(() => {
    void load()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(null)
    setError(null)
    const value = rate.trim()
    if (!RATE_RE.test(value)) {
      setFormError('Enter a rate from 0 to 100 with at most 2 decimals, e.g. 18 or 16.5.')
      return
    }
    setFormError(null)
    setBusy(true)
    try {
      await api.put('/settings/tax', { ratePercent: value })
      setSaved(`VAT is now ${value}%. New sales use this rate; completed sales keep the rate they were sold at.`)
      await load()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="VAT settings" subtitle="One organisation-wide VAT rate, applied by the server to every new sale" />
      {!current && !error && <Spinner />}
      {current && (
        <div className="card stack" data-testid="vat-card">
          {current.configured ? (
            <p data-testid="vat-current">
              Current rate: <strong>{Number(current.ratePercent)}%</strong>
              {current.effectiveFrom && <span className="muted"> · since {new Date(current.effectiveFrom).toLocaleString()}</span>}
              {current.setBy && <span className="muted"> · set by {current.setBy.fullName}</span>}
            </p>
          ) : (
            <Alert kind="warning" testId="vat-unconfigured">
              VAT is not configured. Sales are blocked until a rate is set.
            </Alert>
          )}
          <form onSubmit={submit} className="inline-form">
            <label className="field field-inline">
              <span>New rate (%)</span>
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                data-testid="vat-input"
                aria-describedby="vat-help"
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="vat-save">
              {busy ? 'Saving…' : 'Save rate'}
            </button>
          </form>
          <p id="vat-help" className="muted small">
            Prices are entered excluding VAT. VAT = subtotal × rate, rounded half-up to 2 decimals.
          </p>
          {formError && <Alert kind="error" testId="vat-form-error">{formError}</Alert>}
          {saved && <Alert kind="success" testId="vat-saved">{saved}</Alert>}
        </div>
      )}
      <ErrorAlert error={error} />
    </>
  )
}
