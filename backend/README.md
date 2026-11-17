# ElectroCore EBMS — Backend API

NestJS 12 modular monolith + Prisma 7 + PostgreSQL. Project documentation lives in
`../docs` (architecture decisions: `04-architecture/`, API contract: `05-api/`).

> Independent prototype for software-engineering demonstration; not an officially commissioned system.

## Requirements
- **Node.js 24 LTS** — run `nvm use` at the repository root (reads `.nvmrc`). Node 22 can build and run the app, but tests need Node ≥ 24.9 (ADR-008).
- **PostgreSQL** (developed against local PostgreSQL 17).

## Setup
```bash
nvm use && cd backend      # from the repository root
npm ci                      # also runs `prisma generate` (postinstall)
cp .env.example .env        # then fill in real values — never commit .env
```

Create the databases. Always use `TEMPLATE template0`: the local server's `template1` contains stray tables and must not be modified (ADR-009).
```sql
CREATE DATABASE electrocore_db        TEMPLATE template0;  -- development (Prisma can also create it)
CREATE DATABASE electrocore_db_shadow TEMPLATE template0;  -- `prisma migrate dev` shadow DB
CREATE DATABASE electrocore_test_db   TEMPLATE template0;  -- automated tests only
```

Create `.env.test` (git-ignored) with the same keys as `.env`, but `NODE_ENV=test`, `LOG_LEVEL=error` and
`DATABASE_URL` pointing at `electrocore_test_db`. Tests refuse to run against any database whose name does not end in `_test_db` (ADR-014).

Apply migrations to the development database, then seed roles/permissions and the first administrator:
```bash
npm run prisma:migrate      # prisma migrate dev && prisma generate
npm run prisma:status
# set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (>= 12 chars) in .env, then:
npm run db:seed             # idempotent; remove SEED_ADMIN_PASSWORD afterwards
npm run db:seed:demo        # OPTIONAL demo catalogue; refuses unless NODE_ENV=development
```
First login and how to retrieve the temporary admin password: documentation `09-operations/12-operations-security.md` §12.8.

## Run
```bash
npm run start:dev           # watch mode
npm run build && npm run start:prod
```
- API base path: `http://localhost:3000/api/v1`
- Health: `GET /api/v1/health` → 200 `{ data: { status: "ok", checks: { database: "up" } } }` or 503
- Swagger UI: `http://localhost:3000/api/docs` (disabled in production unless `SWAGGER_ENABLED=true`)

## Test and quality checks
```bash
npm test                    # unit tests
npm run test:e2e            # API + database tests (test DB only; migrations applied with `migrate deploy`)
npm run test:cov
npm run lint
npx tsc --noEmit -p tsconfig.json
npm run build
```

## Configuration
All settings come from environment variables, validated at startup (`src/config/env.validation.ts`). See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `SHADOW_DATABASE_URL` | — | Dev only, for `prisma migrate dev` |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allow-list |
| `LOG_LEVEL` | `log` | `error` \| `warn` \| `log` \| `debug` \| `verbose` |
| `BUSINESS_TIMEZONE` | `Africa/Dar_es_Salaam` | IANA name; timestamps are always stored in UTC |
| `CURRENCY` | `TZS` | ISO 4217 |
| `BUSINESS_NAME` | `ElectroCore Electronics` | Trading name printed on receipts |
| `SWAGGER_ENABLED` | on outside production | |
| `JWT_ACCESS_SECRET` | — (required) | ≥ 32 chars; `openssl rand -base64 48`; unique per environment |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access-token lifetime (15 min) |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh-token lifetime (rotated on each use) |
| `SESSION_MAX_LIFETIME_DAYS` | `30` | Absolute session cap; rotation never extends past it (ADR-021) |
| `COOKIE_SECURE` | `true` in production | Must be true in production |
| `TRUST_PROXY` | `0` | Set `1` behind Nginx/Caddy |
| `LOGIN_RATE_LIMIT` / `LOGIN_RATE_WINDOW_SECONDS` | `5` / `60` | Login requests per IP per window |
| `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES` | `5` / `15` | Account lockout |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD` | — | Only for `npm run db:seed` |

There is deliberately **no tax setting**: tax will be business data managed in the application (ADR-012).

## Code layout
```
src/
  main.ts, app.module.ts, app.setup.ts   bootstrap; shared HTTP pipeline (also used by e2e tests)
  config/                                validated configuration (AppConfigService)
  prisma/                                PrismaService (pg adapter, UTC session)
  health/                                GET /api/v1/health (public)
  auth/                                  login, refresh, logout(-all), me, change-password; guards; tokens; Argon2id
  access/                                permission matrix (permissions.ts), RBAC seed, branch access, GET /roles, /permissions
  users/  branches/  audit/              user & branch administration; append-only audit log (GET /audit-logs)
  catalogue/                             categories, brands, products; field-level price permissions; cost masking (Module 3)
  procurement/                           suppliers, purchase orders, approval workflow, PO numbering (Module 4)
  inventory/                             goods receiving, units, ledger, balances, WAC valuation (Module 5.1)
  database/seed.ts                       `npm run db:seed`
  common/
    errors/          error codes, AppException, error response DTO
    filters/         global exception filter → { statusCode, code, message, requestId, details? }
    interceptors/    success envelope → { data, meta: { requestId, pagination? } }
    pagination/      PaginationQueryDto, PaginatedResult, toSkipTake
    request-context/ X-Request-Id + access log (no bodies/queries logged)
    time/            business-date helpers (business timezone ↔ UTC)
    validation/      global ValidationPipe, @IsMoneyAmount, toMoneyString
  generated/prisma/  generated Prisma client (git-ignored)
prisma/              schema.prisma, migrations/
test/                e2e specs, test-env guard, global setup
```

## Authentication & authorization (Module 2)
- `POST /api/v1/auth/login` returns an access token (15 min, keep in memory) and sets the `ebms_refresh` HttpOnly cookie (7 days).
- `POST /auth/refresh` and `/auth/logout` need the cookie **and** the header `X-Requested-With: XMLHttpRequest`.
- Roles, permissions and branch rules: `../docs/02-requirements/06-permission-matrix.md`. ADRs 016–020 cover the design.

## Product catalogue (Module 3)
- `/categories`, `/brands`, `/products`. Prices are TZS decimal strings and **tax-exclusive**.
- `costPrice` is omitted unless the caller holds `catalogue:cost_read` (not CASHIER or TECHNICIAN).
- `PATCH /products/:id`: price fields need `catalogue:price` (MANAGER, SYSTEM_ADMIN); other fields need `catalogue:write`. SKU and tracking policy are immutable.

## Procurement (Module 4)
- `/suppliers`, `/purchases` plus `/purchases/:id/{submit,approve,reject,reopen,cancel}`.
- Lifecycle: DRAFT → SUBMITTED → APPROVED | REJECTED (→ reopen → DRAFT); cancellation with a reason. Receiving belongs to Module 5.
- **The creator or submitter of an order can never approve or reject it**, whatever their role. Enforced in the service and by database CHECK constraints.
- Totals are computed by the server; lines are frozen once submitted (database trigger).

## Inventory (Module 5, stage 5.1)
- `POST /purchases/:id/receive` (mandatory `idempotencyKey`). Serialized lines send `units: [{ identifiers: [...] }]`.
- The PO's creator, submitter (any cycle) or approver can never receive it (BR-14: service and DB trigger).
- Reads: `/goods-receipts`, `/inventory/balances` (`lowStock`), `/inventory/movements`, `/inventory/units` (`/lookup`), `/inventory/valuation`.
- **All stock changes go through `StockLedgerService`:** lock valuations (sorted), then change balances and write the append-only ledger in one transaction.
- Stage 5.2 (adjustments, transfers, close short, opening balances) is deferred.

## Conventions for new modules
- Every route declares exactly one of `@Public()`, `@AuthenticatedOnly()` or `@RequirePermissions(PERMISSIONS.X)`; undeclared routes are denied.
- Branch-owned data: add `@BranchScoped('body' | 'query' | 'params', 'branchId')` for client-supplied branch IDs, and use `BranchAccessService.scopeFilter()` / `assertCanAccess()` in services.
- Record sensitive changes with `AuditService.record(event, tx)` inside the same transaction.
- Controllers handle HTTP only; services own business rules and transactions.
- Throw `AppException(status, ErrorCode.X, message)` for business failures; never put secrets or internals in messages.
- List endpoints accept `PaginationQueryDto` (or a subclass with whitelisted filters) and return `PaginatedResult`.
- Money: `Decimal(14,2)` columns, `@IsMoneyAmount()` on input, `toMoneyString()` on output, `Prisma.Decimal` arithmetic.
- Timestamps: `@db.Timestamptz(3)`; business dates via `common/time/business-time.ts`.
