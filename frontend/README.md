# ElectroCore EBMS — Frontend (MVP)

React 19 + TypeScript on Vite. A single-page app for the interview demo:
login, role-based navigation, dashboard, stock, receiving with IMEI/serial
entry, POS (search, device selection, cart, server price preview, split
payments, checkout), printable receipts, sales history, daily summary and
VAT settings. **No runtime dependencies beyond React.**

## Run

```bash
cd EBMS && nvm use            # Node 24 (.nvmrc)
cd backend && npm run start:dev   # API on :3000 (CORS_ORIGINS=http://localhost:5173)
cd ../frontend && npm run dev     # http://localhost:5173
```

The dev server proxies `/api` to the backend (`VITE_API_PROXY`, default
`http://localhost:3000`). The app must reach the API on the **same origin**:
the refresh cookie is `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, and the
backend's CSRF guard accepts only the configured `CORS_ORIGINS`. In
production, Caddy serves the built files and proxies `/api` in the same way.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with the API proxy |
| `npm run build` | Typecheck (`tsc -b`) and production build to `dist/` |
| `npm run typecheck` / `npm run lint` | TypeScript / oxlint |
| `npm test` | Unit + render tests (Vite SSR build → `node --test`) |
| `npm run e2e` | Real-browser end-to-end test (see `e2e/README.md`) |

## Security and correctness rules

- **Access token in memory only** (`src/api/client.ts`). Nothing is written
  to localStorage/sessionStorage except a branch id preference and pending
  idempotency keys. A reload restores the session from the HttpOnly cookie.
- **Single-flight refresh:** concurrent 401s share one `POST /auth/refresh`
  (refresh tokens rotate, so parallel refreshes would revoke each other);
  each request is retried once.
- **No authoritative prices or totals in the browser.** The cart holds product
  and device ids and quantities only. Prices, VAT and totals come from
  `POST /pos/quote` and `POST /sales`. Each quote is tagged with the cart it
  priced, so a stale quote never enables checkout. The only arithmetic is the
  "still due / change" hint while typing payments (integer cents; the server
  re-validates).
- **Idempotency keys** (`src/lib/idempotency.ts`): one key per payload for
  checkout and receiving, reused on retries and across a reload. If a checkout
  outcome is uncertain (network error or 5xx), the cart locks and offers a
  retry that resends the same key, so it can never create a second sale.
- **Permissions:** navigation and route guards follow the user's permissions
  (`src/lib/permissions.ts`); the backend enforces every rule regardless. Costs
  are never rendered unless the server sends them (summary profit for roles
  with `catalogue:cost_read`); receipts never contain costs.

## Layout

```
src/api/          API client (auth, refresh, errors) and response types
src/app/          session provider/context, API singleton
src/components/   layout (nav, branch picker) and UI primitives
src/lib/          router, permissions, money display, cart, idempotency
src/pages/        screens
e2e/              API fixture + Chrome DevTools-protocol browser test
```
