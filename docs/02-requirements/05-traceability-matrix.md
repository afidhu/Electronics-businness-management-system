# 5. Requirements Traceability Matrix

| Requirement | Design/module | Test evidence |
|---|---|---|
| FR-AUTH-01..04 | Auth module, JWT guard, permission guard | Auth integration tests; forbidden-role tests |
| FR-CAT-01..04 | Catalogue module (Module 3): Category, Brand, Product | Product CRUD, unique SKU (incl. race), tracking mode/immutability tests; see Module 3 evidence |
| FR-UNIT-01..04 | ProductUnit / UnitIdentifier | Duplicate identifier and single-sale tests |
| FR-PUR-01..05 | Supplier, Purchase, PurchaseItem (Module 4); receiving service (Module 5) | Purchase state tests (Module 4); receiving idempotency tests (Module 5) |
| FR-INV-01..12 | Inventory (Module 5): ledger, balances, receiving; adjustments/transfers in stage 5.2 | Ledger, receiving, idempotency, BR-14 tests (Module 5); transfer/adjustment tests with stage 5.2 |
| FR-SALE-01..11 | Module 6: POS catalogue/quote, checkout, payments, receipts (returns FR-SALE-08 deferred) | Checkout, insufficient stock, concurrent sale, rollback, idempotency, payment tests (Module 6) |
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

### Module 3 (16 Nov 2026)
| Requirement | Implemented in | Test evidence |
|---|---|---|
| FR-CAT-01 (categories/brands) | `catalogue/classification.*` | `catalogue.e2e-spec.ts` › categories and brands |
| FR-CAT-02 (product data) | `catalogue/products.*`, `dto/product.dto.ts` | › creating products |
| FR-CAT-03 (unique SKU) / T-04 | DB UNIQUE `products.sku`, upper-case normalisation | › duplicate SKUs, concurrent creates |
| FR-CAT-04 (tracking mode) | `TrackingMode` enum, DB CHECK, immutability trigger | › creating products; database constraints |
| FR-UNIT-01/05 groundwork (D3) | `catalogue-rules.ts` identifier normalisation and IMEI check; `identifiersPerUnit` | `catalogue-rules.spec.ts` |
| US-03, US-13, US-14 | field-level PATCH, cost masking, price audit | › field-level permissions; cost visibility |
| BR-07/BR-08 (audited price changes; decimal money) | `product.price_changed`, `Decimal(14,2)`, money DTOs | › audited with old → new |
| BR-12 (tax-exclusive) | `priceIncludesTax: false`; no tax in catalogue | › creating products |
| BR-13 (immutability; deactivation) | service checks + DB trigger; row locks | › immutability; deactivation rules |

### Module 4 (16 Nov 2026)
| Requirement | Implemented in | Test evidence |
|---|---|---|
| FR-PUR-01 (suppliers) / US-15 | `procurement/suppliers.*` | `procurement.e2e-spec.ts` › suppliers |
| FR-PUR-02 (PO data) / US-16 | `procurement/purchases.*`, `dto/purchase.dto.ts` | › creating purchase orders |
| FR-PUR-05 (lifecycle incl. APPROVED/REJECTED) | `procurement-rules.ts`, conditional transitions, DB status-consistency CHECK | `procurement-rules.spec.ts`; › approval, rejection; cancellation; concurrency |
| FR-PUR-06 (supplier reference) | `purchases.supplier_reference` | › creating purchase orders |
| BR-11 / US-12 / ADR-023 (separation of duties) | service check + `purchases_sod_*_chk` | › separation of duties; database guarantees; mutation check |
| BR-15 (frozen lines, whole quantities, cost > 0, one line per product) | DTOs, trigger `purchase_items_locked`, CHECKs | › creating; editing; database guarantees |
| FR-ADM-01 (branch isolation) | `BranchAccessService`, `@BranchScoped` | › reading and branch isolation |
| BR-14 (receiving SoD) | **Module 5** (data provided: createdBy/approvedBy) | › Module 5 hand-off |

### Module 5 stage 5.1 (16 Nov 2026)
| Requirement | Implemented in | Test evidence |
|---|---|---|
| FR-PUR-03/04, FR-INV-08/09, US-04 | `inventory/receiving.service.ts`, `POST /purchases/:id/receive` | `inventory.e2e-spec.ts` › partial and complete receiving |
| BR-14 (+I4, I22) | service check + `goods_receipts_br14` trigger | › BR-14; database guarantees; mutation check |
| FR-UNIT-01..03/05, D3, BR-17 | `product_units`, `unit_identifiers` (UNIQUE, format CHECK, deferred count/type trigger) | › serialized identifiers; concurrency |
| FR-INV-01/02/10, BR-04, BR-16 | `stock-ledger.service.ts`, append-only `stock_movements`, `stock_balances` CHECK | › reconciliation; database guarantees |
| BR-06 / FR-INV-11 (I19) | idempotency key + request hash | › idempotency |
| I3 (no over-receiving) | service + Module 4 CHECK | › over-receiving; concurrency |
| BR-18 / ADR-029 (I1, I2) | `inventory_valuations`, `weightedAverageCost` | `inventory-rules.spec.ts`; › valuation |
| FR-INV-07 / US-21 (I21) | `GET /inventory/balances?lowStock=true` | › read APIs |
| FR-INV-12 (cost masking) | `inventory-query.service.ts` | › CASHIER sees quantities but never costs |
| FR-INV-03/05/06, I6–I10c, I13 | **Stage 5.2, deferred** | — |

### Module 6 stages 6.1–6.3 (16 Nov 2026)
| Requirement | Implemented in | Test evidence |
|---|---|---|
| BR-19 (append-only sales, one sale per unit) | migration `…_pos` (triggers, UNIQUE) | `pos-schema.e2e-spec.ts` |
| BR-20 / S1 (VAT configured before sales; history; `settings:write`) | `settings/tax-settings.service.ts`, `tax_settings` rules | `tax-settings.spec.ts`; `settings-customers.e2e-spec.ts` › VAT |
| FR-CUST-01 / S6 (customers, normalised unique phone) | `customers/*`, `customers` CHECK and UNIQUE | `phone.spec.ts`; › customers |
| FR-SALE-01 (product search: name, SKU, brand; branch stock; active only) | `GET /pos/catalogue` — `pos/pos.service.ts` | `pos-quote.e2e-spec.ts` › product search |
| FR-SALE-05 / S9 / I15 (serialized unit selection, IN_STOCK at branch only) | `GET /pos/units`, `PosService.resolveCart` | › serialized device selection; › pricing preview |
| FR-SALE-03 / S2 / S14 / S20 (server pricing, half-up VAT on subtotal, preview) | `pos/pricing.ts`, `POST /pos/quote` | `pricing.spec.ts`; › pricing preview |
| S10 / S19 (selling branch; `sales:create` only) | `PosService.resolveBranch`, `PosController` | › roles and authentication; › selling branch |
| FR-SALE-02, 04, 06, 07, 09–11 (checkout, payments, receipt) | Stages 6.4–6.5 (pending); FR-SALE-08 returns deferred | — |
