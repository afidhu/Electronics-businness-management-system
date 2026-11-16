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
