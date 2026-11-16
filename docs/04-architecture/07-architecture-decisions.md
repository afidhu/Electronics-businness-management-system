# 7. Architecture Decision Records (ADR)

## ADR-001: Modular monolith
**Status:** Accepted for prototype.  
**Decision:** One NestJS application with feature modules and clear domain boundaries.  
**Reason:** Lower operational complexity than microservices; easier local development and deployment.  
**Trade-off:** Modules share one deployment and database; boundaries must be maintained in code. Revisit only when scale/team/independent deployment justify it.

## ADR-002: PostgreSQL
**Status:** Accepted.  
**Decision:** PostgreSQL is the primary relational database.  
**Reason:** Strong relational integrity, transactions, constraints, indexes and robust reporting queries.  
**Trade-off:** Team must manage migrations, backups and query performance.

## ADR-003: Prisma ORM
**Status:** Accepted.  
**Decision:** Use Prisma schema and migrations for typed database access.  
**Reason:** Type safety, migration workflow and developer productivity.  
**Trade-off:** Complex locking/conditional updates may require carefully reviewed raw SQL or transaction patterns.

## ADR-004: Separate Product and ProductUnit
**Status:** Accepted.  
**Decision:** Product represents a model/SKU; ProductUnit represents an individual serialized physical device.  
**Reason:** One model can have many distinct IMEIs/serial numbers and independent lifecycle states.  
**Trade-off:** More tables and business rules, but much stronger traceability.

## ADR-005: Inventory ledger plus balance projection
**Status:** Accepted.  
**Decision:** Keep append-only StockMovement entries and maintain StockBalance for fast reads.  
**Reason:** Auditability and efficient branch stock queries.  
**Trade-off:** Both writes must occur in the same transaction; reconciliation jobs/tests are required.

## ADR-006: REST API
**Status:** Accepted.  
**Decision:** Use versioned REST endpoints under `/api/v1`.  
**Reason:** Straightforward integration with React, Swagger and external systems later.  
**Trade-off:** API contract and backwards compatibility need discipline.

## ADR-007: Docker deployment
**Status:** Proposed.  
**Decision:** Containerize frontend/API/database for reproducible deployment.  
**Reason:** Consistent environment and easier setup.  
**Trade-off:** Persistent storage, secrets, networking and backups must be configured correctly; Docker alone is not a backup.

---

## Implementation decisions (Module 0–1)
ADR-008 onward were approved by the project owner on 16 Nov 2026, while the backend foundation (Module 1) was being implemented. Each ADR names the files that put it into effect.

## ADR-008: Node.js 24 LTS runtime
**Status:** Accepted (16 Nov 2026).  
**Decision:** EBMS runs on Node.js 24 LTS (24.22.3, pinned in `.nvmrc` at the repository root; `engines.node >= 24.9.0` in the backend). Jest is started with `node --experimental-vm-modules` (backend `npm test` scripts). Node.js 22 stays installed through nvm as a fallback and remains the machine default for other projects.  
**Reason:** NestJS 12 ships only as ES modules. Jest 30 can load ES modules from CommonJS test code only on Node ≥ 24.9 **and** with the VM-modules flag. On Node 22 every test suite failed before running.  
**Trade-off:** The flag prints an `ExperimentalWarning`. The app builds and runs on Node 22, but its tests do not. Revisit when Jest supports this without the flag.

## ADR-009: Prisma ORM 7 with the node-postgres driver adapter
**Status:** Accepted (16 Nov 2026). Refines ADR-003.  
**Decision:** Prisma 7.10.1 (exact pin) with `@prisma/adapter-pg`, installed locally in the backend only, never globally. Connection settings live in `prisma.config.ts`, not in `schema.prisma`. The generated client goes to `src/generated/prisma` (CommonJS, git-ignored, regenerated on `postinstall`). The development database is the existing local PostgreSQL 17 (`electrocore_db`), not Docker. `prisma migrate dev` uses a dedicated empty shadow database, `electrocore_db_shadow`, created from `template0` and configured through the optional `SHADOW_DATABASE_URL`. Production applies migrations with `prisma migrate deploy` and needs no shadow database.  
**Reason:** Prisma 7 requires a driver adapter and a config file. On the local PostgreSQL server, `template1` contains leftover tables from an unrelated tutorial, so shadow databases that Prisma creates itself report false schema drift. The owner decided that `template1` must **not** be modified.  
**Trade-off:** One extra local database. Any new EBMS database must be created `TEMPLATE template0`.

## ADR-010: Validated configuration and secret handling
**Status:** Accepted (16 Nov 2026).  
**Decision:** All configuration comes from environment variables, loaded with `@nestjs/config` and validated at startup with class-validator (`src/config/env.validation.ts`). Missing or invalid values stop the app immediately. Error messages name the variable but never print its value. `.env` and `.env.test` are git-ignored; `.env.example` documents every key with placeholders only.  
**Reason:** NFR-SEC-04 and deployment guide §11.3. A misconfiguration should stop startup, not surface later at runtime.

## ADR-011: Business locale, time and money conventions
**Status:** Accepted (16 Nov 2026).  
**Decision:**
- Operating currency: **TZS** (`CURRENCY`). Business timezone: **Africa/Dar_es_Salaam** (`BUSINESS_TIMEZONE`). Both are configuration defaults, not literals scattered through the code.
- Timestamps are stored in **UTC**. DateTime columns use `timestamptz`, the PostgreSQL session timezone is pinned to `UTC` by `PrismaService`, and the API returns ISO-8601 strings ending in `Z`.
- Business dates (receipt day, warranty start, daily reports) are derived in the business timezone (`src/common/time/business-time.ts`).
- Money columns are `Decimal(14,2)` (BR-08). In the API, money is a **decimal string**, never a JSON number. Input must match `^(0|[1-9]\d{0,11})(\.\d{1,2})?$` (`@IsMoneyAmount()`). Output always has two decimals (`toMoneyString`, e.g. `"1750000.00"`). Arithmetic uses `Prisma.Decimal` only.  
**Reason:** BR-08 and BR-10. Avoids floating-point errors and timezone-dependent behaviour.

## ADR-012: Tax is configurable business data, never hard-coded
**Status:** Accepted principle (16 Nov 2026). The detailed design will be decided with POS / Sales (Module 6).  
**Decision:** No tax rate appears in code or in environment variables. Tax rules will be stored as application data, changeable only by authorised users, with every change audited and the rate applied recorded on each sale.  
**Open:** Whether prices are tax-inclusive, and whether rules apply per product, category or organisation, still need stakeholder input (charter §1.7).

## ADR-013: HTTP API conventions
**Status:** Accepted (16 Nov 2026). Implements the API contract (doc 08) and system design §6.9.  
**Decision:**
- Every route is under **`/api/v1`**. The starter demo routes (`/`, `/afidhu`) were removed.
- Success responses: `{ data, meta: { requestId, pagination? } }`. Error responses: `{ statusCode, code, message, requestId, details? }`, using the stable codes in `src/common/errors/error-codes.ts`.
- Stack traces, SQL and other internals are logged on the server only.
- Prisma errors are translated: P2002 → 409 `DUPLICATE_VALUE`; P2003 → 409 `REFERENCE_CONFLICT`; P2025 → 404 `NOT_FOUND`; anything else → generic 500.
- Global validation pipe: unknown properties are **rejected** (`forbidNonWhitelisted`); input is transformed into DTO classes; failures return 400 `VALIDATION_ERROR` with per-field `details`.
- Pagination on every list endpoint: `page` ≥ 1, `limit` 1–100, default 20.
- Each request gets a correlation ID (`X-Request-Id`). A safe incoming value is reused; otherwise a UUID is generated. The ID is echoed in the response header and the body.
- Access logs record method, path (no query string), status, duration and request ID. Bodies, headers and query strings are never logged.
- Security baseline: `helmet` headers, and a CORS allow-list from `CORS_ORIGINS` (credentials enabled for the future refresh-token cookie).
- `GET /api/v1/health` checks that the API is running and the database answers; it returns 503 `SERVICE_UNAVAILABLE` when the database does not.
- OpenAPI/Swagger UI at `/api/docs` (JSON at `/api/docs-json`), enabled by default outside production and disabled in production unless `SWAGGER_ENABLED=true`.  
**Reason:** One consistent contract for the frontend and integrators (ADR-006), and NFR-SEC-03/04 and NFR-OBS-01.

## ADR-014: Isolated test database
**Status:** Accepted (16 Nov 2026).  
**Decision:** Automated tests use only `electrocore_test_db` (created from `template0`), configured in a git-ignored `.env.test`.
- Jest refuses to start if `DATABASE_URL` does not name a database matching `*_test_db` (`test/test-env.ts`). This is checked in both `setupFiles` and the e2e `globalSetup`.
- The e2e `globalSetup` runs `prisma migrate deploy` (never `reset`/`dev`) against the test database.
- In the `test` environment the app reads `.env.test` only.  
**Reason:** Integration tests must never modify or reset the development database.  
**Trade-off:** Developers must create the test database once; the backend README explains how.

## ADR-015: Dependency and supply-chain hygiene
**Status:** Accepted (16 Nov 2026).  
**Decision:**
- Removed `@nestjs/mau` and its `deploy` script: it was unused, since deployment is Docker on Ubuntu (ADR-007), and it was the only source of the two HIGH audit findings (`tmp`, `undici`).
- The remaining audit findings are in the Jest 30 toolchain (`glob`, `minimatch`, `deepmerge`; moderate/low, development-only, no untrusted input). They are **accepted and tracked**: npm's suggested "fix" is a downgrade to Jest 25, and no glob override is applied. Production dependencies: 0 known vulnerabilities (`npm audit --omit=dev`).
- npm 11 install scripts are decided explicitly in `package.json` `allowScripts`: allowed for `prisma` and `@prisma/engines`; denied for `@scarf/scarf` (analytics ping) and `@parcel/watcher` (prebuilt binaries already shipped).  
**Review:** Re-run `npm audit` whenever dependencies change and before each release (test strategy §10.4).

---

## Module 2 decisions (authentication and authorization)
The project owner approved the roles, branch access and authentication strategy on 16 Nov 2026. ADR-016 to ADR-020 record those decisions and the implementation choices made to carry them out.

## ADR-016: Permission-based RBAC, defined in code, failing closed
**Status:** Accepted (16 Nov 2026).  
**Decision:**
- Seven system roles (SYSTEM_ADMIN, MANAGER, INVENTORY_OFFICER, PROCUREMENT_OFFICER, CASHIER, TECHNICIAN, AUDITOR) are bundles of fine-grained permission keys (`resource:action`), stored in `roles`, `permissions` and `role_permissions`.
- The matrix lives in `src/access/permissions.ts` (documented in `02-requirements/06-permission-matrix.md`). It is seeded idempotently by `npm run db:seed`, so permission changes are reviewed in Git like any other change.
- Roles are read-only through the API. Each user has exactly one role (ERD).
- Code checks **permission keys only**, never role names.
- Three global guards run in order: `JwtAuthGuard` → `PermissionsGuard` → `BranchScopeGuard`.
- Every route must declare `@Public()`, `@AuthenticatedOnly()` or `@RequirePermissions(...)`. Undeclared routes are denied (fail closed).  
**Reason:** FR-AUTH-04 and NFR-SEC-02 (least privilege). A forgotten decorator must not open an endpoint.  
**Trade-off:** Custom roles require a code change. That is acceptable for the MVP; a later admin UI can add data-defined roles alongside the system roles.

## ADR-017: JWT access tokens, rotating refresh tokens in HttpOnly cookies
**Status:** Accepted (16 Nov 2026). Resolves the open item "refresh strategy" in the README technology baseline and NFR-SEC-05.  
**Decision:**
- **Access token:** HS256 JWT, **15 minutes**, claims `sub`, `typ=access`, `iss`, `aud`. Sent as `Authorization: Bearer`. The SPA keeps it **in memory only** (never in localStorage). The signing secret comes from `JWT_ACCESS_SECRET` (≥ 32 characters).
- **User loaded per request:** the user, role, permissions and branches are re-loaded from the database for every request rather than trusted from token claims. Deactivation and role or branch changes therefore take effect immediately. Tokens issued before the user's `passwordChangedAt` are rejected.
- **Refresh token:** 256 random bits (base64url), valid **7 days**, stored **only as a SHA-256 hash**. SHA-256 is enough because the token is high-entropy; it is not a password.
- **Rotation:** every `/auth/refresh` revokes the presented token (`ROTATED`) and issues a new one in the same *family* (one family per login).
- **Reuse detection:** presenting an already-rotated token revokes the whole family (`REUSE_DETECTED`) and is audited. A conditional update makes concurrent rotations safe; the loser of a race is treated as reuse.
- **Cookie** `ebms_refresh`: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` (required in production; `COOKIE_SECURE`), `Max-Age` 7 days. The refresh token never appears in a response body.
- **Logout** revokes the cookie's family and clears the cookie. It works with an expired access token and is idempotent. **Logout-all**, a password change, an admin password reset and user deactivation revoke every session of the user.  
**CSRF:** the only cookie-authenticated endpoints are `POST /auth/refresh` and `POST /auth/logout`. They are protected by (1) `SameSite=Strict`, (2) a required `X-Requested-With: XMLHttpRequest` header, which a cross-site page cannot send without a CORS preflight the allow-list rejects, and (3) an Origin allow-list check when an `Origin` header is present. All other endpoints use the Bearer header, which browsers never attach automatically, so they are not exposed to CSRF.  
**CORS:** explicit allow-list (`CORS_ORIGINS`) with `credentials: true`. A wildcard origin is never used. In development the SPA and API are on `localhost` (same *site*, different port), so the cookie still flows. In production, serve the SPA and `/api` from the same origin behind the reverse proxy (deployment guide).  
**Trade-offs:** One database lookup per request (acceptable at prototype scale). Sessions slide in 7-day steps but are capped at 30 days after login (amended by ADR-021). Two browser tabs refreshing at the same instant can trigger reuse detection and sign the user out; the frontend should share one refresh call.

## ADR-018: Password hashing, policy and brute-force protection
**Status:** Accepted (16 Nov 2026).  
**Decision:**
- **Argon2id** via `@node-rs/argon2` (prebuilt binaries, no install script), with OWASP parameters m = 19 MiB, t = 2, p = 1.
- **Password policy** (NIST SP 800-63B style): 12–128 characters; not blank; not one repeated character; must not contain the local part of the user's email. There are no composition rules.
- **Login responses** are identical (`401 INVALID_CREDENTIALS`, "Invalid email or password") for an unknown email, wrong password, inactive account or locked account. Unknown emails are checked against a dummy hash so response timing is equal.
- **Rate limiting:** `@nestjs/throttler` on `POST /auth/login`, 5 requests per IP per 60 s by default (`LOGIN_RATE_LIMIT`, `LOGIN_RATE_WINDOW_SECONDS`). Excess requests get 429 `RATE_LIMITED` with `Retry-After`. Behind a reverse proxy, set `TRUST_PROXY=1` so the real client IP is used.
- **Account lockout:** 5 consecutive failures lock the account for 15 minutes (`LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`). The counter is incremented atomically; success or an admin password reset unlocks the account.
- Login attempts are audited. The attempted email is *not* stored for unknown accounts (minimal personal data).  
**Trade-offs:** The throttler is in memory, which suits the single-instance deployment; multiple API replicas would need a shared store such as Redis. Lockout can be abused to lock out a known user for 15 minutes; IP rate limiting reduces this, and an administrator can unlock by resetting the password.

## ADR-019: Branch isolation
**Status:** Accepted (16 Nov 2026).  
**Decision:**
- SYSTEM_ADMIN accesses every branch through the `branches:access_all` permission. All other roles access only branches assigned in `user_branches`.
- CASHIER and TECHNICIAN may have at most one branch (`roles.max_branches = 1`); the other roles may have several. Branch-scoped roles must have at least one **active** branch, and SYSTEM_ADMIN must have none.
- Enforcement has two layers:
  - **Request layer:** `@BranchScoped(source, field)` makes the global `BranchScopeGuard` reject any client-supplied branch ID (path, query or body, including arrays) outside the caller's scope with 403 `BRANCH_ACCESS_DENIED`.
  - **Data layer:** services use `BranchAccessService` (`assertCanAccess`, `scopeFilter`), so lists show only in-scope records.
- Out-of-scope *branches* return 403. Out-of-scope *users* return 404, so their existence isn't revealed.  
**Reason:** FR-ADM-01 and T-13. A branch ID from the frontend is never trusted.

## ADR-020: Append-only audit log
**Status:** Accepted (16 Nov 2026). Implements FR-AUTH-06 and FR-ADM-02.  
**Decision:**
- `audit_logs` records actor, action, entity, optional branch, sanitised JSON metadata, IP and request ID.
- A PostgreSQL trigger blocks `UPDATE` and `DELETE`, so the log is append-only even for the application's own database user.
- Metadata keys resembling `password`, `token`, `secret`, `hash`, `cookie` or `authorization` are stripped at any depth before writing.
- Where possible, events are written in the same transaction as the change they describe.
- `GET /audit-logs` (`audit:read`) is branch-scoped.
- Events recorded: logins (success/failure/lock), logout and logout-all, refresh-token reuse, password change and reset, user created/updated/deactivated/reactivated, branch created/updated/deactivated.  
**Trade-off:** Test databases are cleaned with `TRUNCATE`, which the row-level trigger does not block; that is acceptable because tests only ever touch `*_test_db`.

## ADR-021: Absolute session lifetime of 30 days
**Status:** Accepted (16 Nov 2026). Amends ADR-017.  
**Decision:**
- Each login session ends at most **30 days** after sign-in (`SESSION_MAX_LIFETIME_DAYS`, default 30).
- At login every refresh token records `session_expires_at = login + 30 days`. Rotation **copies** that value; it never recomputes it.
- A new token expires at `min(now + 7 days, session_expires_at)`, and the cookie's `Max-Age` equals the token's remaining lifetime.
- `/auth/refresh` rejects tokens whose session has ended (401 `INVALID_TOKEN`).
- The database enforces `expires_at <= session_expires_at` with a check constraint.
- Configuration validation rejects `REFRESH_TOKEN_TTL_DAYS > SESSION_MAX_LIFETIME_DAYS`.
- Existing sessions were backfilled with `created_at + 30 days`.  
**Reason:** Owner decision. Limits how long a stolen-but-active session can live, and forces periodic re-authentication.  
**Tests:** `auth-units.spec.ts` (expiry calculation); `auth.e2e-spec.ts` › absolute session lifetime (30-day end preserved across rotation, token/cookie capped near the end, refresh rejected after the end, DB constraint).

## ADR-022: Business access decisions of 16 Nov 2026
**Status:** Accepted. Amends ADR-016 (doc 06 §6.4 holds the details).  
**Decision:**
- MANAGER gains `users:read`, scoped to staff sharing at least one of the manager's branches, and gets no write access. This is the only permission-matrix change.
- Confirmed unchanged: `procurement:approve`, `sales:discount` and `sales:return` are held only by MANAGER and SYSTEM_ADMIN, and audit visibility is branch-scoped with global login events admin-only.
- Procurement officers must never approve purchase orders. Module 4 (Procurement) enforces this in the workflow; the creator can never approve their own PO (ADR-023).
- The initial administrator is `admin@gmail.com` (SYSTEM_ADMIN), created by `npm run db:seed` with a randomly generated temporary password supplied through `SEED_ADMIN_PASSWORD`. That password is never stored in Git, logs or documentation.

## ADR-023: Separation of duties for purchase-order approval
**Status:** Accepted (16 Nov 2026). Implemented in **Module 4 (Procurement)**; corrected from "Module 3" by decision D1. Extended by P3: the **submitter** is excluded as well as the creator (ADR-027).  
**Decision:**
- Procurement officers create purchase orders. Only holders of `procurement:approve` (MANAGER, SYSTEM_ADMIN) may approve or reject them, and only for branches within their scope (ADR-019).
- **The creator of a purchase order can never approve or reject it, regardless of role.** This includes SYSTEM_ADMIN and MANAGER, even though SYSTEM_ADMIN holds every permission. The check compares the PO's `createdBy` with the acting user inside the approval transaction; on mismatch the request fails with 403.
- Approval and rejection are recorded in the audit log (actor, PO, branch, outcome, rejection reason).
- Business rule BR-11, user story US-12.  
**Reason:** Owner decision. Standard procurement control against self-authorised purchases.  
**Consequence:** A deployment needs at least two people with purchasing roles (a creator and a different approver).

## ADR-024: Single repository (monorepo) for backend, frontend and docs
**Status:** Accepted (16 Nov 2026).  
**Decision:**
- One Git repository rooted at the project folder: `backend/`, `frontend/`, `docs/`, `.nvmrc` and `.gitignore`.
- The backend's existing history is preserved: commit `3bbd1b6` is kept with its original hash, and the move into `backend/` is a pure-rename commit, so `git log --follow` works across it.
- The documentation moved unchanged into `docs/` (SHA-256 verified) before path references were updated in a separate commit.
- The root `.gitignore` excludes `.env*` (except `.env.example`), keys, `node_modules/`, build output, coverage, `*.tsbuildinfo`, the generated Prisma client, logs and editor/office lock files.
- A mirror backup of the pre-move backend history is kept outside the repository (`../_backups/backend-history-20261116.git`).  
**Reason:** One history for code and its documentation keeps them synchronised and reviewable together.

## ADR-025: Product catalogue design
**Status:** Accepted (16 Nov 2026). Proposal: `docs/proposals/module-3-catalogue.md`.  
**Decision:**
- Category, Brand and Product are organisation-wide, not branch-scoped.
- **Case-insensitive uniqueness** uses a normalised `name_key` column with a plain UNIQUE constraint. Expression indexes are avoided because Prisma would try to drop them.
- The SKU is normalised to upper case, validated by a DB CHECK and UNIQUE, and immutable, like the tracking mode and identifier policy (D9).
- Serialized products declare `identifier_type` (IMEI/SERIAL) and `identifiers_per_unit` (1–2). A DB CHECK enforces consistency with the tracking mode.
- Prices are `Decimal(14,2)`, TZS, **tax-exclusive**, organisation-wide.
- **Field-level authorization:** price fields need `catalogue:price`, other fields `catalogue:write`. A mixed PATCH needs both, otherwise it is rejected atomically.
- **Cost visibility** follows `catalogue:cost_read`, applied in the response mapper so that no endpoint can leak it.
- Category and brand rows are row-locked (`FOR SHARE` when products are created or reassigned, `FOR UPDATE` when deactivating), so a product can never be attached to a category or brand that is being deactivated concurrently.
- All writes and their audit events share one transaction. Price changes are audited as `product.price_changed` with per-field old → new values; selling below cost adds `product.selling_below_cost`.
- `db:seed:demo` inserts demo catalogue data only when `NODE_ENV=development`, and refuses otherwise.  
**Reason:** FR-CAT-01..04, US-03, decisions D3–D15.

## ADR-026: Organisation-wide audit events visible to audit readers
**Status:** Accepted (16 Nov 2026). Amends ADR-020 and doc 06 §6.4 item 4 (decision D13).  
**Decision:** Users without `branches:access_all` see audit events of their branches **plus** organisation-wide catalogue events (`entityType` Category, Brand or Product, which have no branch). Identity and authentication events with no branch (logins, logouts, token reuse, password changes, user administration without a single branch) remain visible only to SYSTEM_ADMIN.

## ADR-027: Procurement design
**Status:** Accepted (16 Nov 2026). Proposal: `docs/proposals/module-4-procurement.md` (P1–P16).  
**Decision:**
- **Lifecycle:** `DRAFT → SUBMITTED → APPROVED | REJECTED`; `REJECTED → DRAFT` (reopen); cancellation with a reason from DRAFT, SUBMITTED or REJECTED (`procurement:write`) and from APPROVED when nothing has been received (`procurement:approve`). PARTIALLY_RECEIVED and RECEIVED are reached only by Module 5.
- Every transition is a conditional status update inside a row-locked transaction; concurrent conflicting actions resolve to one success and one 409.
- **Separation of duties** in three layers: permission (`procurement:approve`), service (actor ≠ creator and ≠ submitter, including SYSTEM_ADMIN; blocked attempts audited) and database (CHECK constraints on approver and rejecter).
- **Lines** are frozen outside DRAFT by a trigger, except `quantity_received` while APPROVED or PARTIALLY_RECEIVED (the Module 5 hook).
- **Totals** are computed by the server in Decimal; quantities are whole numbers; unit cost is > 0, TZS and tax-exclusive; one line per product; a product-name snapshot is kept per line.
- **Numbering:** `PO-{BRANCHCODE}-{YYYY}-{NNNNNN}` from a `document_sequences` row per branch and year, incremented atomically in the same transaction. Gaps from rolled-back transactions are acceptable.
- **Suppliers** are organisation-wide (case-insensitive unique name, TIN unique when set). Deactivation is blocked while open orders exist. Supplier audit events are organisation-wide (ADR-026 extended to `Supplier`).
- Purchase audit events carry the order's branch (branch-scoped visibility).
- No new permissions; product cost prices are not changed (P14, decided in Module 5).

## ADR-028: Receiving separation of duties (requirement for Module 5)
**Status:** Accepted (16 Nov 2026, decision P15 Option B). **To be implemented and tested in Module 5.**  
**Decision:** A user can never receive goods, partially or finally, against a purchase order they **created** or **approved**. Receiving must be performed by another user holding `inventory:receive`, and the receiving user and all receiving details are audited. `inventory:receive` stays with PROCUREMENT_OFFICER. Module 4 provides `createdById` and `approvedById` on every order so the check can be enforced in the backend (and, ideally, by a database constraint on the goods-receipt table).
