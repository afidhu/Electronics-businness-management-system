# 5. Requirements Traceability Matrix

| Requirement | Design/module | Test evidence |
|---|---|---|
| FR-AUTH-01..04 | Auth module, JWT guard, permission guard | Auth integration tests; forbidden-role tests |
| FR-CAT-01..04 | Catalogue module, Product model | Product CRUD, unique SKU, tracking mode tests |
| FR-UNIT-01..04 | ProductUnit / UnitIdentifier | Duplicate identifier and single-sale tests |
| FR-PUR-01..05 | Supplier, Purchase, PurchaseItem, receiving service | Purchase state and receiving idempotency tests |
| FR-INV-01..07 | Inventory, StockMovement, StockBalance | Branch stock, transfer, adjustment and ledger tests |
| FR-SALE-01..09 | Sales, SaleItem, Payment, receipt service | Checkout, insufficient stock, concurrent sale and payment tests |
| FR-CUST-01 | Customer module | Customer validation and sales association tests |
| FR-WAR-01..04 | Warranty, WarrantyClaim | Warranty start/end and eligibility tests |
| FR-RPT-01..04 | Reports module | Date/branch filter and reconciliation tests |
| FR-ADM-01..02 | RBAC, BranchAccess, AuditLog | Access-control and audit event tests |
| NFR-SEC-01..05 | Reverse proxy, secrets, auth, validation | Security checklist and configuration review |
| NFR-REL-01..02 | Transactions, constraints, backups | Transaction rollback and restore drill |
| NFR-PERF-01..02 | Indexed queries, pagination | Load/search test with agreed dataset |
| NFR-OBS-01 | Logger and request ID middleware | Log inspection; secret-redaction test |

A requirement is not complete until its acceptance criteria and relevant test evidence are recorded.

## Implementation evidence (updated 16 Nov 2026)
| Requirement | Implemented in | Test evidence |
|---|---|---|
| NFR-SEC-03 (input validation) | `common/validation/validation.pipe.ts` | `validation.spec.ts`; `app.e2e-spec.ts` › validation |
| NFR-SEC-04 (no secrets in logs/responses) | `all-exceptions.filter.ts`, `env.validation.ts`, access log | `all-exceptions.filter.spec.ts`; `env.validation.spec.ts`; `app.e2e-spec.ts` › generic 500 |
| NFR-PERF-02 (pagination) | `common/pagination/pagination.ts` | `pagination.spec.ts`; `app.e2e-spec.ts` › pagination |
| NFR-OBS-01 (request IDs) | `common/request-context/request-id.middleware.ts` | `request-id.middleware.spec.ts`; `app.e2e-spec.ts` › health |
| NFR-REL-01 (health / fail fast) | `health/*`, `PrismaService` | `health.service.spec.ts`; `prisma.e2e-spec.ts` |
| BR-08 (decimal money) | `is-money-amount.decorator.ts`, `money.ts` | `validation.spec.ts` › money |
| BR-10 (UTC storage, business timezone) | `common/time/business-time.ts`, `PrismaService` | `business-time.spec.ts`; `prisma.e2e-spec.ts` › UTC session |

### Module 2 (16 Nov 2026)
| Requirement | Implemented in | Test evidence |
|---|---|---|
| FR-AUTH-01 (sign in) | `auth/auth.service.ts`, `auth.controller.ts` | `auth.e2e-spec.ts` › login |
| FR-AUTH-02 (password hashing) | `auth/password.service.ts` (Argon2id) | `auth-units.spec.ts` › PasswordService |
| FR-AUTH-03 (protected routes) | `auth/guards/jwt-auth.guard.ts` (global) | `auth.e2e-spec.ts` › access tokens |
| FR-AUTH-04 (backend permissions) | `auth/guards/permissions.guard.ts`, `access/permissions.ts` | `access-control.e2e-spec.ts` › permission matrix; `permissions.spec.ts` |
| FR-AUTH-05 (user admin) | `users/*` | `access-control.e2e-spec.ts` › user administration |
| FR-AUTH-06 / FR-ADM-02 (audit) | `audit/*`, migration trigger | `access-control.e2e-spec.ts` › audit log integrity; `auth.e2e-spec.ts` › secrets never leak |
| FR-ADM-01 (branch access) | `access/branch-access.service.ts`, `branch-scope.guard.ts` | `access-control.e2e-spec.ts` › branch isolation |
| NFR-SEC-05 (token storage/rotation/CSRF) | `refresh-token.service.ts`, `refresh-cookie.ts`, `guards/csrf.guard.ts` | `auth.e2e-spec.ts` › refresh, logout |
| Brute force (risk register) | `@nestjs/throttler`, lockout in `auth.service.ts` | `auth.e2e-spec.ts` › lockout, rate limiting |
