# 10. Test Strategy & Quality Plan

## 10.1 Test levels
- Unit: isolated service/domain rules (price calculations, state transitions, permission policies).
- Integration: NestJS services + test PostgreSQL + Prisma transaction behavior.
- API/e2e: Supertest for authentication, roles, catalogue, receiving and checkout endpoints.
- Frontend: component and workflow tests for forms, permissions and POS.
- Manual acceptance: execute end-to-end demo as each user role.
- Security: access control, input validation, rate limits, secret handling and dependency review.
- Performance: realistic catalogue searches and checkout workload after data volume is agreed.

## 10.2 Critical test cases
| ID | Scenario | Expected result |
|---|---|---|
| T-01 | Login with valid credentials | Authenticated response |
| T-02 | Login with invalid credentials | Generic 401; no sensitive detail |
| T-03 | Cashier accesses user admin | 403 |
| T-04 | Create duplicate SKU | 409/validation error |
| T-05 | Receive serialized unit with duplicate IMEI | Rejected by validation/unique constraint |
| T-06 | Receive purchase | Receipt, movements and balance commit |
| T-07 | Receiving request retried | No duplicate stock |
| T-08 | Sell unavailable quantity | Rejected; no partial records |
| T-09 | Two cashiers sell final unit concurrently | At most one succeeds |
| T-10 | Sale transaction fails after stock update | Full rollback |
| T-11 | Serialized unit sold twice | Second sale rejected |
| T-12 | Client tampers with price/total | Backend uses authoritative price |
| T-13 | User requests another branch without access | 403 |
| T-14 | Completed sale appears in report | Totals reconcile |
| T-15 | Restore backup to test database | Data and application checks pass |

## 10.3 Definition of done
- Acceptance criteria met.
- Validation and permission checks implemented server-side.
- Unit/integration tests pass.
- Critical API behavior documented in Swagger.
- No secrets committed.
- Logs redact sensitive data.
- UI loading, empty, success and error states handled.
- Migration reviewed and tested.
- README and relevant docs updated.
- Code reviewed before merge.

## 10.4 Release gates
Do not deploy a release if critical tests fail, migrations are unreviewed, production secrets are missing, backups have not been configured, or known critical security vulnerabilities remain unresolved.

## 10.5 Test environment and commands (implemented, Module 1)
- **Runtime:** Node.js 24 (`nvm use` at the repository root). Jest runs with `--experimental-vm-modules` (ADR-008).
- **Database isolation (ADR-014):** tests use only `electrocore_test_db`, configured in a git-ignored `backend/.env.test`. Jest refuses to run against any database whose name does not end in `_test_db`. The e2e global setup applies migrations with `prisma migrate deploy` only. The development database is never touched.
- **Commands (from `backend/`):** `npm test` (unit), `npm run test:e2e` (API + database, run in band), `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- **Module 1 evidence:** 76 unit tests (config validation, error filter and Prisma error mapping, response envelope, pagination, validation and money, business time, request ID, health service, test-DB guard) and 21 e2e tests (health with database, request IDs, security headers, removed demo routes, 404/500/400 error shapes with no internals leaked, validation details, pagination bounds, CORS allow-list, OpenAPI document, test-DB connection, UTC session, applied migrations).

## 10.6 Module 2 evidence (authentication & authorization)
- **Unit (108 total):** permission-matrix invariants (7 roles, auditor read-only, only admin has all-branch/user admin, branch limits); Argon2id hashing and password policy; refresh-token format, hashing and expiry; cookie parsing; audit-metadata sanitising; PermissionsGuard (public, all-of, fail closed); CsrfGuard; authentication config validation.
- **E2E (81 total, real PostgreSQL test DB):**
  - `auth.e2e-spec.ts` (24): T-01/T-02, inactive account, input validation, lockout and expiry, cookie flags, hashed storage, forged/expired/wrong-type tokens, refresh rotation, reuse detection revoking the family, CSRF header/origin, logout/logout-all, deactivation blocking a live token, change-password invalidating older tokens, no secrets in logs or audit, rate limiting (429 + Retry-After).
  - `access-control.e2e-spec.ts` (36): fail-closed routes, 12-case 403 matrix (T-03), 403 never mutates, branch isolation for every scoped role (T-13), `@BranchScoped` on path/query/body, auditor scoping of users and audit, user administration rules (duplicates, weak password, branch limits per role, multi-branch roles, live role/branch changes, deactivation, self-lockout and last-admin protection, password reset), branch administration, append-only audit trigger.
- **Mutation check:** disabling branch isolation failed 4 tests; disabling the permission check failed 14. Both were restored afterwards.

### Module 2 amendments (16 Nov 2026)
- The suites grew to **111 unit** and **88 e2e** tests: 30-day session cap (expiry maths, rotation keeps the absolute end, token/cookie capped, refresh rejected after the end, DB constraint), managers viewing only their branches' staff (and receiving 403 on user writes), and managers' audit visibility excluding global login events.
- Live verification of the seeded administrator: login 200 with 29/29 permissions; `admin123` rejected. The password, access token and refresh token were absent from a verbose server log and from the `users`, `audit_logs` and `refresh_tokens` data.

## 10.7 Module 3 evidence (product catalogue)
- **Totals after Module 3:** **151 unit** and **161 e2e** tests, all passing (Modules 1–3).
- **Unit (40 new):** SKU, name and specification rules; IMEI Luhn and identifier normalisation (for Module 5); cost masking; tracking policy; immutability; audit change sets; `@RequireAnyPermission`; permission-matrix snapshot (exact grant counts per role, so an accidental extra grant fails).
- **E2E `catalogue.e2e-spec.ts` (73):**
  - CRUD and search; case-insensitive duplicate names and SKUs (T-04), including a three-way concurrent create (one 201, two 409)
  - 13 invalid-input cases; inactive and unknown references
  - every role × every endpoint; cost hidden for CASHIER and TECHNICIAN in list and detail responses (D4)
  - field-level PATCH: INVENTORY_OFFICER and MANAGER rejected on mixed requests with nothing changed; only MANAGER and SYSTEM_ADMIN change prices (D5)
  - price audit with old → new values per field and the actor; below-cost event (D6); immutability (D9)
  - deactivation blocked and a concurrency invariant (D12)
  - database CHECK/UNIQUE constraints and the immutability trigger on direct writes
  - audit visibility (D13); `db:seed:demo` guard and idempotency (D15)
- **Mutation check:** removing the price-permission check failed 4 tests, removing cost masking 3, removing the category/brand checks 3. The code was restored afterwards.
- **Stability:** one intermittent failure was traced to a test asserting the position of equal-named rows (order among equal names follows a random UUID). The test was fixed to assert membership; the suite then passed 5/5 consecutive runs.

## 10.8 Module 4 evidence (procurement)
- **Totals after Module 4:** **172 unit** and **230 e2e** tests, all passing (Modules 1–4).
- **Unit (21 new, `procurement-rules.spec.ts`):** every action × status transition; separation of duties (creator, submitter, earlier-cycle submitter); exact decimal line maths and Decimal(14,2) overflow; duplicate lines; PO reference format and range; TIN; invariants (every `procurement:read` holder has `catalogue:cost_read`; approvers are exactly MANAGER and SYSTEM_ADMIN).
- **E2E `procurement.e2e-spec.ts` (69):**
  - suppliers: normalisation, case-insensitive name and TIN uniqueness, validation (incl. rejected bank fields), every role read/write
  - creating: per-branch/year numbering, 5 concurrent creates → distinct consecutive numbers, branch refusal, 10 invalid-order cases (incl. client `subtotal`, unit cost 0, fractional quantity, overflow, past or impossible date, duplicate lines), inactive or unknown references
  - branch isolation for reading and acting; cross-branch refusals proven to change **nothing**
  - draft editing by another officer (creator kept, line changes audited); DRAFT-only edits
  - **separation of duties:** an admin who created; an admin who submitted; a creator promoted to MANAGER; an earlier-cycle submitter after reject → reopen → resubmit; blocked attempts audited; wrong-branch approver
  - reject reasons, reopen history, re-check of references at submission, illegal transitions (409)
  - cancellation rules (P5), including approved-and-partly-received → 409
  - three-way approve/reject/approve race → exactly one winner
  - supplier deactivation blocked while open orders exist
  - database guarantees on direct SQL: SoD CHECKs, status consistency, line lock, immutability, arithmetic, and the Module 5 `quantity_received` hook
  - audit visibility per branch and role; the Module 5 hand-off listing; `awaitingMyApproval`
- **Mutation check:**
  - removing the service separation-of-duties check failed 4 tests, and the **database CHECK still refused the self-approval** (transaction rolled back)
  - removing the cancel permission rule failed 2 tests
  - removing the branch check on actions **initially went undetected**: the tests asserted only the HTTP status, and the final read masked the committed change. The tests were strengthened to assert that a refused action changes nothing, after which this mutant failed 2 tests. All code was restored.
- **Stability:** 3/3 consecutive runs green.

## 10.9 Module 5 stage 5.1 evidence (inventory: receiving, ledger, valuation)
- **Totals after stage 5.1:** **184 unit** and **270 e2e** tests, all passing (Modules 1–5).
- **Unit (12 new, `inventory-rules.spec.ts`):** moving WAC (zero stock, blending, half-up rounding to 4 dp, sequences, invalid input); BR-14 receiver check (creator, submitter, approver, earlier submitters); canonical-JSON idempotency hash; serialized unit preparation (dual IMEI, count and format problems, repeats after normalisation); GRN references.
- **E2E `inventory.e2e-spec.ts` (40):**
  - **BR-14:** creator/submitter, a different submitter, SYSTEM_ADMIN approver, earlier-cycle submitter; blocked attempts audited; refusals change nothing; MANAGER/CASHIER/TECHNICIAN/AUDITOR lack `inventory:receive`
  - partial → complete receiving (PARTIALLY_RECEIVED → RECEIVED); over-receiving 409 with nothing changed
  - dual-SIM IMEIs with normalisation; 5 invalid-identifier cases; duplicates within a request and against existing identifiers after normalisation
  - idempotent replay (200, same receipt, stock not doubled); key reuse with another payload or user → 409; key mandatory; **3 concurrent identical requests → one 201 + two 200**
  - **3 parallel receipts of the full outstanding → one 201 + two 409**; the same serial on two orders concurrently → one 201 + one 409
  - non-receivable statuses; another branch refused with nothing changed; inactive product receivable (I5), inactive branch not
  - WAC 115.0000 after 10@100 + 30@120, with catalogue prices untouched (I2) and the valuation API value 4600.00
  - valuation permissions; branch-scoped balances and low-stock filter; **CASHIER never sees costs** in movements, units, receipts; TECHNICIAN no access; identifier lookup with I15 disclosure; unit history; branch audit visibility
  - DB guarantees: append-only ledger, receipts and identifiers; non-negative balances; BR-14 trigger on direct insert; deferred identifier count/type trigger
  - **reconciliation:** every balance = Σ movements; serialized on-hand = IN_STOCK units; Σ PO received = Σ receipt quantities
- **Defect found by the tests:** the deferred identifier trigger in migration `…_inventory` used a PL/pgSQL `CASE` that referenced a column absent from one of the firing tables, so every serialized receipt failed with 500. It was confirmed by a direct SQL reproduction and fixed by a **forward corrective migration** `…_inventory_identifier_trigger_fix`; the applied migration was not edited, so no database reset was needed.
- **Mutation check:**
  - removing the service BR-14 check failed 3 tests, and the **DB trigger still refused** (0 self-receipts stored)
  - removing the over-receiving guard failed 1 test, and the **Module 4 CHECK kept 0 lines over-received**
  - removing cost masking failed 1 test
  - all code was restored
- **Stability:** 3/3 consecutive runs green.
- **Not run:** `npm audit` could not reach the registry (network error). No dependencies were added in Module 5.

## 10.10 Module 6 stages 6.1–6.2 evidence (POS schema, VAT settings, customers)
- **Totals after stage 6.2:** **226 unit** and **335 e2e** tests, all passing (Modules 1–5 unchanged).
- **6.1 `pos-schema.e2e-spec.ts` (26):** every POS database rule on direct writes:
  - whole-sale deferred trigger (payments = total, lines = subtotal, change)
  - header CHECKs; one sale per unit; append-only tables
  - payment rules; tax-history immutability; customer rules
  - SALE ledger movements
  - **Finding:** Prisma's 1:1 `connect` on `sale_items.product_unit_id` would detach a unit from its earlier sale. The append-only trigger blocks it; checkout must write scalar foreign keys.
- **6.2 unit (42 new):** phone normalisation (Tanzanian and international formats; every local format of one number maps to one value; invalid inputs), VAT-rate format, `requireActive` sales guard (BR-20, 0% counts as configured), permission snapshot (`settings:write` held only by SYSTEM_ADMIN).
- **6.2 `settings-customers.e2e-spec.ts` (39):**
  - VAT: unconfigured → guard blocks; six non-admin roles get 403 and nothing is stored; validation; set 18% → all roles read it; 0% allowed; history kept; no-op not audited; concurrent admins → exactly one active rate; audit visibility
  - customers: normalisation; duplicates across formats → 409; validation; search by name, full phone in any format or partial digits; update/clear/deactivate
  - **audit stores changed field names only, never phone, email or name**
  - every role × read/write; a refused write changes nothing
- **Defect found by unit tests:** a mistyped 9-digit number starting with 0 was turned into an impossible `+2550…` number. Fixed: bare 9-digit subscriber numbers never start with 0.
- **Mutation check:** opening the VAT route to any authenticated user failed 7 tests; writing personal values into customer audit failed 1. Code restored.

## 10.11 Module 6 stage 6.3 evidence (POS search, unit selection, pricing preview)
- **Totals after stage 6.3:** **237 unit** and **394 e2e** tests, all passing (Modules 1–5 and stages 6.1–6.2 unchanged). No migration.
- **Unit `pricing.spec.ts` (11):**
  - half-up rounding to 2 decimals
  - demo cart 1,780,000 + 18% = 2,100,400
  - VAT rounded once on the subtotal, not per line
  - fractional rates; 0% VAT
  - Decimal(14,2) overflow; invalid quantity or rate rejected
- **`pos-quote.e2e-spec.ts` (59):** stock is received through the real PO → approve → receive API.
  - **VAT not configured:** quote → 409 `TAX_NOT_CONFIGURED`; the catalogue stays browsable.
  - **Roles:** 401 without a token. MANAGER, INVENTORY, PROCUREMENT, TECHNICIAN and AUDITOR get 403 on all three endpoints. CASHIER (branch implied) and SYSTEM_ADMIN (branch chosen) are allowed.
  - **Branches:**
    - a cashier at another branch → 403 `BRANCH_ACCESS_DENIED`
    - admin without `branchId` → 400
    - inactive branch → 400 `REFERENCE_INACTIVE`; unknown branch → 404
  - **Search:**
    - search by name, SKU or brand, case-insensitive
    - inactive products are hidden even when they have stock
    - available stock is per branch; `inStockOnly` filter
    - **no cost field anywhere in the response**; unknown query parameters → 400
  - **Units:**
    - only IN_STOCK units at the selling branch are listed, with identifiers (dual IMEI, primary first)
    - a scanned serial or IMEI resolves regardless of case, spaces or dashes
    - a sold unit, another branch's unit, or a unit of an inactive product → 409 `UNIT_NOT_AVAILABLE`, without revealing where the unit is (I15)
  - **Quote:**
    - server prices and totals
    - every client-supplied price, total, tax rate or discount field → 400
    - S15 limits (50 lines, 1–1,000 units, integers only)
    - insufficient stock → 409 `INSUFFICIENT_STOCK` with line details
    - inactive or unknown product → 400 `PRODUCT_NOT_SELLABLE`
    - serialized-line rules: unit required, quantity 1, matching product, no unit twice
    - the same quantity product twice → `DUPLICATE_PRODUCT_LINE`
    - **no side effects** (balances, units, movements, sales, payments, sequences and audit are identical)
    - a VAT change (0%) and a manager's price change apply to the next quote
- **Mutation check (each rule removed in turn, tests failed, code restored, 0 markers left):**
  - active-product check: 2 failed
  - stock check: 2 failed
  - unit branch/status check: 6 failed
  - inactive product on scanned unit: 1 failed
- **Stability:** the new suite passed 3/3 consecutive runs.

## 10.12 Module 6 stage 6.4 evidence (complete POS sales workflow: checkout, payments, stock, receipts, summary)
- **Totals after stage 6.4:** **249 unit** and **458 e2e** tests, all passing (Modules 1–5 and stages 6.1–6.3 unchanged). No migration.
- **Unit (12 new):**
  - payment settlement: demo split with change; exact card payment; under/overpayment; zero amount; tender below amount; tender on a non-cash method; missing mobile-money or bank reference
  - receipt-number format and range
  - WAC → ledger cost rounding
  - receipt date/time in the business timezone
- **`sales.e2e-spec.ts` (64):** stock received through the real PO → approve → receive API at two branches.
  - **Workflow:** search → scan serial → quote → checkout (mobile money + cash with change) → receipt.
    - Exact totals 1,780,000 + 18% VAT = 2,100,400; change 600.
    - Stock −2 cables / −1 laptop; the device becomes SOLD.
    - SALE ledger rows reference the sale at WAC; WAC is unchanged.
    - `sale.completed` audit without payment references.
    - Receipt numbers are sequential per branch (`RCT-BR-A-YYYY-000001`, `…-000002`, `RCT-BR-B-…-000001`).
  - **Costs:** never shown to cashiers, never on receipts; `costAtSale` shown to manager, auditor and admin only.
  - **Payments:** all four methods in one split sale. Under/overpayment → `PAYMENT_MISMATCH`. Missing references, bad tender, zero/negative/3-dp/numeric amounts, unknown method, 0 or 6 payments → 400. Every refusal changes nothing.
  - **Tampering:** 13 client-supplied price/total/tax/cost/discount/payment/cashier/receipt/status fields → 400 because of that field, and nothing changes. A payment computed from a lower fake price → `PAYMENT_MISMATCH`.
  - **Stock and devices:** insufficient stock → 409; sold or other-branch device → 409; inactive product → 400; a dual-IMEI phone sells by either IMEI.
  - **Idempotency:** a retry returns the identical sale (200) with no changes. Same key with a different body, or from another cashier → 409. Missing or malformed key → 400. **6 simultaneous submissions of one sale → one 201 and five 200 with the same sale.**
  - **Concurrency:**
    - **6 checkouts race for the last 3 SIM cards → exactly 3 sales, stock 0.**
    - **5 checkouts of one device → exactly one sale; one sale line and one SALE movement for it.**
  - **Rollback:** a failure injected at the last step (audit) → 500 with no internal detail. Stock, devices, sale, lines, payments, movements, audit and the receipt sequence are all unchanged, and the next receipt number has no gap. A mixed cart failing on its last line changes nothing.
  - **Permissions:**
    - only CASHIER and SYSTEM_ADMIN can check out
    - a cashier cannot sell at another branch; the admin must choose an active branch; unknown or inactive customer → 400
    - sales list, detail and receipt are branch-scoped: a cashier sees their whole branch (S8), a manager or auditor their branches, the admin all; another branch's sale → 403; inventory, procurement and technician roles → 403
    - list filters work by receipt, cashier, customer and business-date range
  - **Snapshots:** a later price change and a VAT change (16%) do not alter completed sales; new sales use the new values.
  - **Daily summary:**
    - count, units, tax and total equal the database figures; payment methods add up to the total; cashier counts add up
    - manager, auditor and admin may read it; cashiers and other roles → 403; another branch → 403
    - an empty day returns zeros
  - **Reconciliation:**
    - balances = Σ movements, never negative; serialized on-hand = IN_STOCK units
    - each sale's SALE movements = its lines; SOLD units ⇔ sold lines; payments = totals
    - no orphan SALE movements; one audit event per sale
- **Mutation check (each rule removed in turn; code restored; 0 markers left):**
  - conditional stock decrement: 3 failed
  - idempotency-key lock: 1 failed
  - payment rules: 9 failed
  - branch check on sale reads: 1 failed
  - cost masking: 2 failed
  - **Survived by design:** removing the `IN_STOCK` guard on the device update. The partial UNIQUE index on `sale_items.product_unit_id` still rejects the second sale, the losing checkout rolls back completely, and the API returns the same 409 `UNIT_NOT_AVAILABLE`. This confirms the database backstop works independently.
- **Stability:** the new suite passed 3/3 consecutive runs (including the concurrency tests).

## 10.13 Frontend MVP evidence (16 Nov 2026)
- **Approach:** no new dependencies (the npm registry was unreachable from the build machine).
  - Unit and render tests compile with Vite's SSR build and run on Node's built-in test runner, rendering with `react-dom/server`.
  - Browser tests drive the installed Google Chrome over the DevTools protocol against a backend on the **test** database (`frontend/e2e/README.md`).
- **Unit/render (36):**
  - **API client:** token in memory only (nothing in web storage); Bearer header; anti-CSRF header and same-origin credentials on refresh.
  - **Refresh:** a 401 triggers one refresh and one retry. **Six concurrent 401s share one refresh call.** Concurrent explicit refreshes are shared too.
  - **Session end and failures:** an ended session signs out with no refresh loop; a network error during refresh keeps the session; logout works offline; error envelopes and network errors are mapped correctly.
  - **Money and cart:** money display (exact decimal strings, change and remaining amount in integer cents); the cart never sends a price, total, tax or cost field.
  - **Idempotency keys:** reused for the same payload (any field order) and across a reload; new for a changed payload; cleared after success.
  - **Role navigation and route guards:** all 7 roles, using the seeded RBAC permissions; branch picker and nav rendering.
- **Browser end-to-end (53 checks, real backend):**
  - the full purchase → receive (serials, dual IMEIs) → search → device → quote → split payment → checkout → receipt (screen and print) → history → summary → VAT workflow;
  - reload restores the session with exactly one refresh; a simulated 401 is refreshed once and retried;
  - role navigation and deep-link refusals for cashier and manager;
  - insufficient stock disables checkout;
  - **a lost checkout response followed by a retry creates no duplicate (same idempotency key on both attempts)**, and a triple-click creates one sale;
  - no cost or profit shown to cashiers;
  - layouts at 1440, 820 and 390 px (sidebar collapses; no horizontal scroll).
- **Defects found and fixed:**
  - The purchase API did not return line ids, so no API client could call receiving. Fixed by exposing `id`, `identifierType` and `identifiersPerUnit` (commit `5d358a1`, with backend tests).
  - The browser run also confirmed that the CSRF origin check refuses cookie refresh and logout from an origin that is not configured; the test backend is started with the e2e origin allowed.

