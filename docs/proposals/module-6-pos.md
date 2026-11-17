# Module 6 — Point of Sale (POS) & Sales: Proposal

**Status:** APPROVED by the project owner on 16 Nov 2026 (S0–S20; **S13 warranty deferred**). Delivery in phases: backend → minimal frontend → hosting (§11).
**Prepared:** 16 Nov 2026 from `main` @ `fa06366` (Modules 1–4 and 5.1 complete; 184 unit / 270 e2e tests).
**Goal:** an interview-ready, **hosted** demonstration on **18 November 2026**, without weakening security or data integrity.
**Decisions:** S0–S20 approved as recommended, except **S13 = DEFERRED** (no warranty in Module 6; no catalogue change).

---

## 1. Scope

### MVP (this module)
| # | Capability | Requirements |
|---|---|---|
| 1 | POS product search with **sellable stock at the cashier's branch** and tax-exclusive price; pick serialized units by IMEI/serial | FR-SALE-01, FR-SALE-05 |
| 2 | **Basic customers**: create, search by name/phone; walk-in sales allowed | FR-CUST-01 |
| 3 | **Server-priced quote** (cart preview: prices, tax and totals computed by the server, no side effects) | FR-SALE-03, BR-09 |
| 4 | **Checkout**: sale + lines + payments + stock deduction + ledger + unit SOLD + audit in **one transaction** | FR-SALE-02/04, US-06 |
| 5 | **Payments**: CASH (tendered and change), CARD, MOBILE_MONEY, BANK_TRANSFER; split payments; sum must equal total | FR-SALE-06/07 |
| 6 | **Receipt** (view/print data) with a unique receipt number | FR-SALE-09 |
| 7 | **Duplicate-sale prevention** (mandatory idempotency key) and **no overselling** (conditional decrements, unit status checks, DB constraints) | BR-01, BR-02, T-08..T-12 |
| 8 | **Configurable tax** (single organisation VAT rate, admin-managed, snapshotted on each sale) | BR-12, ADR-012, D7 |
| 9 | **Sales list and daily summary** (date, branch, cashier filters; totals by payment method) for the manager demo | FR-RPT-02 (partly FR-RPT-01), US-07 |

### Out of the immediate MVP (designs to follow; not built)
| Deferred | Why / where |
|---|---|
| Returns, refunds, voids (FR-SALE-08, `sales:return`) | Sales stay immutable (BR-05); corrections later via a controlled return workflow |
| Discounts (`sales:discount`, BR-07) | S3: sell at list price in the MVP |
| Holds, parked carts, reservations (`reserved` stays 0) | I17 |
| Cash drawer / shift open-close / Z-reports | Later |
| Thermal/PDF receipt rendering | The frontend prints the receipt JSON; S12 |
| Warranty registration (FR-WAR-01/02) | **Deferred (S13).** Demo step 7 becomes future work; no Module 3 change |
| Full dashboard (FR-RPT-01), CSV export | Reports module; a minimal daily summary is included (S17) |
| Offline POS, barcode hardware, loyalty, multi-currency | Out of MVP |

### Preservation of Modules 1–5
- No change to existing permissions' meaning. The only proposed grant change is a new `settings:write` (SYSTEM_ADMIN) for tax configuration (S1).
- **Module 5 schema touch (required):** add `SALE` to `MovementType` (separate migration; PostgreSQL enum rule) and allow `'SALE'` in the `stock_movements.reference_type` CHECK. Nothing else in Modules 1–5 changes.
- All stock changes go through `StockLedgerService` (new `decrease` path, same lock order). WAC is unchanged by sales (ADR-029).

---

## 2. Requirements and user stories
**Proposed new rules:**
- **FR-SALE-10:** checkout requires an idempotency key.
- **FR-SALE-11:** a sale snapshots price, tax rate and product name per line.
- **BR-19:** sales and payments are append-only; a unit can belong to at most one completed sale (DB partial unique index).
- **BR-20:** sales are blocked until a tax rate is configured (an explicit 0% is allowed).

**User stories:**
- **US-06 (extended): complete a sale.** As a cashier, I scan or pick products at my branch.
  - The server prices the cart (tax-exclusive prices plus configured VAT).
  - I record one or more payments that sum to the total; cash shows change.
  - The sale commits atomically and I get a receipt.
  - A double-click or network retry never creates two sales.
  - The last unit can't be sold twice.
- **US-07 (extended): review sales.** As a manager, I filter sales by date, branch and cashier, and see a daily summary that reconciles to payments.
- **US-23: register a customer.** As a cashier, I find a customer by phone or create one (name, phone, optional email). Walk-in sales need no customer.
- **US-24: configure tax.** As an administrator, I set the VAT rate. Each sale keeps the rate it used.
- **US-25: reprint a receipt.** As a cashier, I reopen a receipt from my branch.

---

## 3. Data model

| Model | Key fields | Rules |
|---|---|---|
| **TaxSetting** | id, name (`VAT`), ratePercent `Decimal(5,2)` 0–100, isActive, createdById, createdAt | Exactly one active row (partial UNIQUE). Changes create a new row, so history is kept; audited |
| **Customer** | id, name, phone? (normalised `+255…`, UNIQUE when set), email?, notes?, isActive, createdById, timestamps | Organisation-wide (S6); minimal personal data; never deleted |
| **Sale** | id, **receiptNumber** UNIQUE, branchId, cashierId, customerId?, status (`COMPLETED`), currency, subtotal, discountTotal (0), taxRatePercent (snapshot), taxAmount, total, amountPaid, changeGiven, **idempotencyKey** UNIQUE, requestHash, completedAt | **Append-only** (trigger). CHECKs: total = subtotal − discount + tax; amounts ≥ 0; amountPaid = total |
| **SaleItem** | id, saleId, lineNumber, productId, sku and productName (snapshots), productUnitId?, quantity, unitPrice (snapshot of selling price), lineTotal, **costAtSale** (WAC at sale time, S11) | Append-only. lineTotal = quantity × unitPrice. Serialized: quantity = 1 with a unit. **Partial UNIQUE (product_unit_id)**: a unit is in at most one sale (BR-02, FR-UNIT-04) |
| **Payment** | id, saleId, method (`CASH` \| `CARD` \| `MOBILE_MONEY` \| `BANK_TRANSFER`), amount > 0, amountTendered? (cash only, ≥ amount), reference? | Append-only. Deferred trigger: Σ payments = sale total |
| *Module 5 changes* | `MovementType` + `SALE`; `stock_movements.reference_type` CHECK + `'SALE'` | Sales write `quantity_delta < 0` rows |

Sequences reuse `document_sequences`: `RCT:{BRANCH}:{YYYY}` (S5).

**ERD additions:** `BRANCH 1─* SALE *─1 USER(cashier)`; `CUSTOMER 1─* SALE`; `SALE 1─* SALE_ITEM *─1 PRODUCT`; `SALE_ITEM 0..1─1 PRODUCT_UNIT`; `SALE 1─* PAYMENT`; `TAX_SETTING` (standalone, snapshotted).

---

## 4. Checkout flow (one transaction)
```mermaid
sequenceDiagram
  actor Cashier
  participant API as POST /sales
  participant DB as PostgreSQL
  Cashier->>API: { idempotencyKey, branchId, customerId?, items[{productId, quantity | unitId/identifier}], payments[] }
  API->>API: auth, sales:create, branch scope, DTO validation (no client prices/totals accepted)
  API->>DB: idempotency lookup → replay returns the original sale (200)
  API->>DB: BEGIN
  API->>DB: lock products FOR SHARE (price, active); active tax rate; branch active
  API->>DB: lock valuations (sorted) → read WAC for costAtSale
  API->>DB: quantity: UPDATE stock_balances SET on_hand = on_hand − q WHERE on_hand − reserved ≥ q (rowcount=1 else 409 INSUFFICIENT_STOCK)
  API->>DB: serialized: UPDATE product_units SET status='SOLD' WHERE id=… AND status='IN_STOCK' AND branch_id=… (rowcount=1 else 409 UNIT_NOT_AVAILABLE); balance −1
  API->>DB: insert sale (RCT number), items (snapshots), payments; SALE movements (−qty / −1 per unit)
  API->>DB: audit sale.completed (branch)
  API->>DB: COMMIT (deferred triggers: payments = total)
  API-->>Cashier: 201 receipt DTO
```
- **Totals:** subtotal = Σ quantity × sellingPrice (server); tax = round_half_up(subtotal × rate / 100, 2) (S2); total = subtotal + tax.
- **Payments (S4):** Σ amount must equal total exactly. CASH may carry `amountTendered ≥ amount`, and change = tendered − amount. MOBILE_MONEY and BANK_TRANSFER require a reference.
- **Lock order:** sale-level idempotency → products (sorted) → valuations (sorted) → balances (sorted) → units (sorted). This is the same order as receiving, so there are no deadlocks.
- **Rollback (T-10):** any failure (stock, payment mismatch, DB constraint) aborts everything, including stock, units and ledger.

---

## 5. API contract (`/api/v1`)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/pos/catalogue?branchId&q&sku` | sales:create | Active products with selling price (tax-exclusive), `available` at that branch, serialized flag. Never costs |
| GET | `/pos/units?branchId&productId` | sales:create | IN_STOCK units with identifiers, to pick a device. Existing `/inventory/units/lookup` also works |
| POST | `/pos/quote` | sales:create | Same body as checkout without payments; returns priced lines, tax and total; no side effects |
| POST | `/sales` | sales:create + branch | Checkout (idempotent). 201 new / 200 replay |
| GET | `/sales?from&to&branchId&cashierId&customerId&receiptNumber` | sales:read, branch-scoped | Paginated |
| GET | `/sales/:id` and `/sales/:id/receipt` | sales:read | Receipt DTO: business name, branch, cashier, business date/time (Africa/Dar_es_Salaam), lines with serials, subtotal, VAT %, VAT, total, payments, change. `costAtSale` only with cost_read |
| GET | `/sales/summary?date&branchId` | reports:sales | Count, gross, VAT, totals per payment method, per cashier (S17) |
| GET/POST | `/customers?q` | customers:read / customers:write | Search name/phone |
| GET/PATCH | `/customers/:id` | customers:read / customers:write | |
| GET | `/settings/tax` | any authenticated | Active rate |
| PUT | `/settings/tax` | **settings:write** (new, SYSTEM_ADMIN) | Creates a new active rate; audited |

**Checkout request:**
```json
POST /api/v1/sales
{ "idempotencyKey": "uuid", "branchId": "…", "customerId": "…",
  "items": [ { "productId": "…laptop", "identifier": "5CG3301ABC" },
             { "productId": "…cable", "quantity": 2 } ],
  "payments": [ { "method": "MOBILE_MONEY", "amount": "1500000.00", "reference": "MP26111712AB" },
                { "method": "CASH", "amount": "600400.00", "amountTendered": "601000.00" } ] }
```
No prices or totals are accepted from the client (unknown fields → 400).

**New error codes:**
- `INSUFFICIENT_STOCK` (409)
- `UNIT_NOT_AVAILABLE` (409)
- `PAYMENT_MISMATCH` (400)
- `TAX_NOT_CONFIGURED` (409)
- `PRODUCT_NOT_SELLABLE` (400)

`IDEMPOTENCY_KEY_REUSED`, `DUPLICATE_VALUE` and `REFERENCE_INACTIVE` are reused.

---

## 6. Permissions (existing grants; one proposed addition)
| Action | ADMIN | MANAGER | INVENTORY | PROCUREMENT | CASHIER | TECHNICIAN | AUDITOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| POS search, quote, checkout | ✓ (must specify branch) | – | – | – | ✓ (own branch) | – | – |
| View sales and receipts | all | own branches | – | – | own branch (S8) | – | own branches |
| Daily summary | ✓ | ✓ | – | – | – | – | ✓ |
| Customers: read / write | ✓ / ✓ | ✓ / – | – | – | ✓ / ✓ | ✓ / – | ✓ / – |
| Set VAT rate (`settings:write`, new) | ✓ | – | – | – | – | – | – |

Costs (`costAtSale`) are visible only with `catalogue:cost_read`; cashiers never see them.

---

## 7. Audit events
- `sale.completed` (branch, receipt number, total, payment methods, unit count, customer id). Card numbers and similar data are never stored.
- `customer.created` / `customer.updated` (organisation-wide, metadata minimised: no phone or email values, only which fields changed).
- `tax_setting.changed` (old → new rate).
- Checkout failures are not audited individually; they return 4xx and change nothing.

---

## 8. Database constraints and migration strategy
1. `…_sale_movement_type`: `ALTER TYPE "MovementType" ADD VALUE 'SALE'` (own migration).
2. `…_pos`:
   - enums `SaleStatus` and `PaymentMethod`; tables `tax_settings`, `customers`, `sales`, `sale_items`, `payments`;
   - CHECKs: totals arithmetic, non-negative money, line arithmetic, serialized line quantity = 1 with a unit, tender ≥ amount, rate 0–100, receipt format;
   - partial UNIQUE indexes: one active tax rate; one sale per unit;
   - append-only triggers on sales, items and payments; deferred trigger Σ payments = total;
   - the replaced `stock_movements_reference_type_chk` includes `'SALE'`.
3. Drift check, test reset update, `migrate deploy` for test and production. Additive, with no data changes. The tax setting is entered by the admin after deploy (sales are blocked until then, BR-20).

---

## 9. Testing strategy
| Level | Coverage |
|---|---|
| **Unit** | Totals and tax rounding (half-up, edge cents); payment validation (split, tender/change, references, mismatch); receipt number format; phone normalisation; idempotency hash reuse |
| **Integration (DB)** | Partial UNIQUE (unit sold once); append-only sales/items/payments; deferred Σ payments = total; totals CHECKs; one active tax rate; `on_hand >= 0` under sales; movement type SALE accepted |
| **E2E** | Full demo flow (receive → sell serialized + quantity → receipt → stock/ledger/units updated → second sale of the same unit 409); **T-08** insufficient quantity 409 with nothing changed; **T-09** two cashiers buy the last unit concurrently → one 201, one 409; **T-10** forced failure after stock deduction → full rollback; **T-11** same serial twice → 409; **T-12** client-sent price/total rejected and server price used; idempotent replay/concurrent duplicates → one sale; wrong-branch cashier 403; inactive product/branch blocked; tax not configured → 409; rate change doesn't alter past sales; customers CRUD and phone uniqueness; cost masking for cashiers; every role × endpoint; summary reconciles to Σ payments (**T-14**); audit visibility |
| **Reconciliation** | After the suite: balances = Σ movements; serialized on-hand = IN_STOCK units; SOLD units = sale items with units; Σ payments = Σ sale totals |
| **Mutation check** | Remove the conditional stock decrement (DB CHECK must still refuse negatives); remove the unit-status guard (partial UNIQUE must still refuse a double sale); remove price recalculation; remove cost masking |
| **Regression** | All existing suites (184 unit / 270 e2e) green |

---

## 10. Risks
| Risk | Mitigation |
|---|---|
| **No frontend exists yet.** A hosted demo needs a UI | **S0**: decide the demo surface (minimal React POS/admin screens vs Swagger-driven demo) |
| **Hosting not yet prepared** (Docker, proxy, TLS, production env) | Plan a deployment step after Module 6 (deployment guide exists; Dockerfiles not yet written) |
| Overselling under concurrency | Conditional updates + DB CHECK + partial UNIQUE + concurrency tests |
| Double sale on retry/double-click | Mandatory idempotency key; concurrent replay test |
| Tax misconfiguration | Explicit configuration required (BR-20); rate snapshotted per sale |
| Rounding disputes | Single documented rule (S2), unit tests on edge values |
| Cost leakage to cashiers | Single response mapper; per-role tests |
| Deadline pressure | Strict MVP scope; deferrals documented; no partial business rules |

## 11. Implementation roadmap (after approval)
1. Docs first (proposal, SRS, user stories, ERD, data dictionary, sequence diagram, API contract, permission matrix, ADR-031 POS/tax/payments, traceability). Commit.
2. Migrations (MovementType SALE; POS tables and constraints). Drift check.
3. Tax settings + customers (with tests).
4. Pricing/quote engine (pure functions + tests).
5. Checkout with `StockLedgerService.decrease`, units SOLD, payments, receipt numbering, idempotency, audit.
6. Sales read APIs, receipt, daily summary.
7. Concurrency, rollback, security, mutation and regression runs; evidence; commit on `feature/module-6-pos`; report.
8. *(Depending on S0)* minimal frontend and deployment.

---

## 12. Business decisions (all approved 16 Nov 2026 as recommended, except S13 = deferred)
| # | Decision | Options | Recommendation |
|---|---|---|---|
| **S0** | Demo surface for 18 Nov (no UI exists yet) | (a) API-only demo through Swagger; **(b) minimal React screens after Module 6 (login, receive, POS checkout + receipt, sales list)**; (c) full frontend | **(b)**: smallest UI that shows the end-to-end flow, built right after Module 6; then Docker deployment |
| **S1** | Tax configuration | **(a) one active organisation VAT rate in `tax_settings`, admin-managed via new `settings:write` (SYSTEM_ADMIN), snapshotted per sale**; (b) environment variable | **(a)**. An env var would be "configuration", but not auditable business data (ADR-012) |
| **S2** | Tax rounding | **(a) on the sale subtotal, half-up to 2 dp**; (b) per line | **(a)**, simplest with one rate |
| **S3** | Discounts in the MVP | **(a) none (list price)**; (b) manager-authorised line discounts | **(a)**: deferred with a later design |
| **S4** | Payments | Methods CASH/CARD/MOBILE_MONEY/BANK_TRANSFER; **split allowed; Σ = total exactly; no credit/partial**; cash tender + change; **reference required for MOBILE_MONEY and BANK_TRANSFER**, optional for CARD | Approve |
| **S5** | Receipt number | **`RCT-{BRANCHCODE}-{YYYY}-{NNNNNN}`** per branch and year (business timezone) | Approve |
| **S6** | Customers | **Optional (walk-in allowed)**; organisation-wide; name required; phone normalised to +255 format and **unique when set**; email optional; no deletion | Approve |
| S7 | Customer required when selling serialized devices? | (a) **optional**; (b) required (warranty beneficiary) | **(a)** for the MVP; revisit with warranty |
| **S8** | Cashier sales visibility | **(a) all sales of own branch**; (b) only own sales | **(a)** (receipt reprints, shift handover) |
| S9 | Inactive product or branch | **Block sale** (US-03) | Approve |
| S10 | SYSTEM_ADMIN selling | Allowed (holds `sales:create`); must pass `branchId` | Approve |
| **S11** | Cost of goods sold | **(a) store `costAtSale` = current WAC per line (hidden from cashiers)**; (b) none | **(a)**, enabling margin reporting later |
| S12 | Receipt output | **(a) receipt JSON; the frontend prints it (browser print)**; (b) server PDF | **(a)** |
| **S13** | Warranty (demo step 7) | (a) defer; (b) minimal warranty; (c) full policies | **APPROVED: (a) DEFERRED.** No warranty and no catalogue change in Module 6; documented as future work |
| S14 | Quote endpoint | **Include** (no side effects) | Approve |
| S15 | Limits | ≤ 50 lines and ≤ 1,000 units per line per sale | Approve |
| S16 | Idempotency | **Mandatory key on checkout** (as I19) | Approve |
| **S17** | Minimal reporting in Module 6 | **(a) sales list + daily summary** (demo step 8); (b) defer all reporting | **(a)** |
| S18 | Reservations | Remain 0 (no holds) | Approve |
| S19 | Who sells | `sales:create`: CASHIER and SYSTEM_ADMIN only (managers can't ring sales) | Approve current matrix |
| S20 | Price at sale | Product `sellingPrice` read and locked (FOR SHARE) inside the transaction; snapshotted per line | Approve |
