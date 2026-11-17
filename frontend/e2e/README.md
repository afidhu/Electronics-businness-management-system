# Browser end-to-end test

`npm run e2e` drives the installed Google Chrome (headless, DevTools protocol,
no extra packages) through the complete workflow against a **real backend
running on the TEST database** (never the development database):

purchase (created and approved through the API) → receive with serials and IMEIs
(inventory officer, UI) → stock → POS search → device picker / IMEI scan →
cart → server quote → split payment (mobile money + cash with change) →
checkout → receipt (screen and print media) → sales history → manager dashboard
and daily summary → admin VAT settings → tablet/phone layouts.

A second scenario starts from nothing:
- the administrator creates a branch and one user for every role in the UI;
- each user signs in and sees only their own menu;
- the cashier changes the temporary password (the old one stops working);
- the inventory officer creates a category, brand and product;
- the procurement officer adds a supplier, then creates and submits a purchase order;
- the manager approves it from the approval queue, and the inventory officer receives it;
- the manager changes the price, which the inventory officer cannot;
- the cashier sells to a customer created at the till;
- the auditor reads the audit log and valuation;
- the technician sees no costs;
- a deactivated user is refused at sign-in.

It also covers:
- a wrong password;
- reload restoring the session with exactly one refresh;
- a simulated expired access token (401) followed by one refresh and a retry;
- no tokens in web storage;
- role navigation and deep-link guards;
- insufficient stock;
- a lost checkout response followed by a retry with the same idempotency key, creating no duplicate;
- a triple-click on "Complete sale" creating one sale;
- no costs shown to cashiers.

## Setup (once per test-database reset)

The backend's Jest e2e suites truncate the test database, so re-create the
test-only admin first. These are throwaway **test** credentials:

```bash
cd EBMS && nvm use && cd backend
npm run build
set -a && . ./.env.test && set +a
SEED_ADMIN_EMAIL=e2e.admin@ebms.test SEED_ADMIN_NAME="E2E Admin" \
SEED_ADMIN_PASSWORD='E2e-Admin-Pass-2026!' node dist/database/seed.js
```

## Run

```bash
# terminal 1 — backend on the test DB; allow the e2e origin (CSRF guard)
cd EBMS/backend && NODE_ENV=test PORT=3100 LOGIN_RATE_LIMIT=1000 \
  CORS_ORIGINS=http://localhost:5174 node dist/main.js
# terminal 2 — frontend proxying to it
cd EBMS/frontend && VITE_API_PROXY=http://localhost:3100 npx vite --port 5174 --strictPort
# terminal 3
cd EBMS/frontend && npm run e2e
```

Each run creates a fresh branch (`DSM-xxxxx`), users and products through the
API, so runs never collide. Screenshots are written to `e2e/screenshots/`
(git-ignored).
