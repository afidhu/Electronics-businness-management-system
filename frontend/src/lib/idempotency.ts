/**
 * Idempotency keys for checkout and receiving (S16, I19).
 *
 * One key per logical submission: retrying the SAME payload (after a timeout,
 * a network error or a double click) reuses the key, so the backend returns
 * the original sale/receipt instead of creating a second one. A changed
 * payload gets a new key. The key is kept in sessionStorage (this tab only)
 * so it also survives a page reload during an uncertain submission.
 * Only the key and a payload fingerprint are stored — never tokens.
 */

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const PREFIX = 'ebms.idem.'

/** Stable JSON: object keys sorted, so equal payloads compare equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

function defaultStore(): KeyValueStore {
  try {
    const s = globalThis.sessionStorage
    const probe = `${PREFIX}probe`
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return memoryStore()
  }
}

export class IdempotencyKeys {
  private readonly store: KeyValueStore
  private readonly generate: () => string

  constructor(store?: KeyValueStore, generate?: () => string) {
    this.store = store ?? defaultStore()
    this.generate = generate ?? (() => globalThis.crypto.randomUUID())
  }

  /** The key for `payload` in `scope`: reused while the payload is unchanged. */
  keyFor(scope: string, payload: unknown): string {
    const fingerprint = canonicalJson(payload)
    try {
      const saved = this.store.getItem(PREFIX + scope)
      if (saved) {
        const parsed = JSON.parse(saved) as { key: string; fingerprint: string }
        if (parsed.fingerprint === fingerprint) return parsed.key
      }
    } catch {
      // unreadable entry: replace it
    }
    const key = this.generate()
    try {
      this.store.setItem(PREFIX + scope, JSON.stringify({ key, fingerprint }))
    } catch {
      // storage full/blocked: the in-flight key is still returned
    }
    return key
  }

  /** Forget the key once the submission definitely completed (or was refused). */
  clear(scope: string): void {
    try {
      this.store.removeItem(PREFIX + scope)
    } catch {
      // ignore
    }
  }
}
