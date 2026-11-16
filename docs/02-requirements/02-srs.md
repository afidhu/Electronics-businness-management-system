# 2. Software Requirements Specification (SRS)

**Version:** 0.1 | **Status:** Proposed; stakeholder validation required.

## 2.1 Purpose
Define functional and quality requirements for ElectroCore EBMS. `FR` denotes functional requirements; `NFR` denotes non-functional requirements. Priority values: Must, Should, Could.

## 2.2 System context
A browser-based React application calls a NestJS REST API. The API authenticates users, enforces permissions, validates requests and applies business rules. Prisma accesses PostgreSQL. External payment gateway, accounting and supplier integrations are outside MVP.

## 2.3 User classes
Administrator, Manager, Inventory Officer, Procurement Officer, Cashier/Salesperson, Technician (later release), Auditor/Read-only.

## 2.4 Functional requirements

### Identity and access
- FR-AUTH-01 (Must): Active users can sign in with valid credentials.
- FR-AUTH-02 (Must): Passwords are stored using a modern password hash; plaintext is never stored.
- FR-AUTH-03 (Must): Protected API routes require authentication.
- FR-AUTH-04 (Must): Backend enforces permissions for every protected operation.
- FR-AUTH-05 (Should): Admin can create, deactivate and assign roles to users.
- FR-AUTH-06 (Should): Sensitive actions create audit events.

### Catalogue and serialized devices
- FR-CAT-01 (Must): Authorized users can create/update/view/deactivate categories and brands.
- FR-CAT-02 (Must): Product has SKU, name, category, brand, tracking mode and pricing data.
- FR-CAT-03 (Must): SKU is unique within the organisation.
- FR-CAT-04 (Must): Product tracking mode is SERIALIZED or QUANTITY.
- FR-UNIT-01 (Must): A serialized unit has a unique serial/IMEI identifier within the organisation.
- FR-UNIT-02 (Must): Unit has lifecycle state: IN_STOCK, RESERVED, SOLD, RETURNED, UNDER_REPAIR or WRITTEN_OFF.
- FR-UNIT-03 (Must): In-stock unit is assigned to a branch.
- FR-UNIT-04 (Must): A unit cannot be linked to more than one active completed sale.
- FR-UNIT-05 (Should): Dual-SIM units can store multiple identifiers using a child identifier table.

### Suppliers and purchasing
- FR-PUR-01 (Must): Authorized users can manage supplier records.
- FR-PUR-02 (Must): Purchase order stores supplier, branch, reference, status, dates and lines.
- FR-PUR-03 (Must): Goods are added to stock only through an authorized receiving action.
- FR-PUR-04 (Must): Receiving creates ledger entries and stock updates atomically.
- FR-PUR-05 (Should): Purchase states include DRAFT, SUBMITTED, PARTIALLY_RECEIVED, RECEIVED and CANCELLED.
- FR-PUR-06 (Should): Supplier invoice and reference can be recorded.

### Inventory
- FR-INV-01 (Must): Stock is tracked by product and branch.
- FR-INV-02 (Must): Every stock change is represented by a movement record.
- FR-INV-03 (Must): Adjustments require a reason, permission and audit event.
- FR-INV-04 (Must): Normal operations cannot make available stock negative.
- FR-INV-05 (Must): Transfers store source, destination, items, status and movement history.
- FR-INV-06 (Should): Physical counts can be reconciled with approval.
- FR-INV-07 (Should): Low-stock products can be identified by reorder threshold.

### Customers and sales
- FR-SALE-01 (Must): Cashier can search products and check sellable stock at assigned branch.
- FR-SALE-02 (Must): Completed sale has unique receipt, cashier, branch, timestamp, line items and totals.
- FR-SALE-03 (Must): Backend recalculates prices/totals and validates stock; it does not trust client totals.
- FR-SALE-04 (Must): Sale, payment and inventory deduction commit atomically.
- FR-SALE-05 (Must): Serialized unit is sellable only when available at the selling branch.
- FR-SALE-06 (Must): Sale stores payment method, amount and optional external reference.
- FR-SALE-07 (Should): Split/partial payments are supported if business policy permits.
- FR-SALE-08 (Should): Returns/refunds use a controlled workflow; completed sales are not silently deleted.
- FR-SALE-09 (Must): Receipt can be viewed and printed/exported.
- FR-CUST-01 (Should): Customer records can be linked to sales and warranties.

### Warranty and repairs
- FR-WAR-01 (Should): Warranty policy can be defined per product or category.
- FR-WAR-02 (Should): Eligible completed sales create warranty records.
- FR-WAR-03 (Should): Staff can look up warranty by receipt, customer or serial number.
- FR-WAR-04 (Should): Claim has status, issue, assessment and resolution notes.
- FR-REP-01 (Could): Repair job tracks device, customer, technician and status.
- FR-REP-02 (Could): Repair records parts, labour, charges and completion details.

### Reporting and administration
- FR-RPT-01 (Must): Dashboard shows sales and stock summary within the user's permitted scope.
- FR-RPT-02 (Must): Authorized users can filter sales by date, branch and cashier.
- FR-RPT-03 (Should): Inventory valuation and movement reports are available.
- FR-RPT-04 (Should): Reports export to CSV.
- FR-ADM-01 (Must): Users access only permitted branches and functions.
- FR-ADM-02 (Must): Audit events record actor, action, entity, timestamp and safe metadata.

## 2.5 Business rules
- BR-01: Completed sale cannot make available stock negative.
- BR-02: A serialized unit is uniquely identifiable and sold at most once.
- BR-03: Product model and physical product unit are distinct records.
- BR-04: Stock movements are the audit ledger; balances are a query-optimized projection.
- BR-05: Completed sales are immutable for normal users; corrections use returns/refunds/reversals.
- BR-06: Receiving cannot be duplicated by retrying a request.
- BR-07: Discounts, refunds, voids and adjustments require permission and audit.
- BR-08: Monetary values use decimal database types, never binary floating point.
- BR-09: Backend is authoritative for stock, pricing, totals and permissions.
- BR-10: Store timestamps consistently (UTC recommended); display in configured business timezone.

## 2.6 Non-functional requirements
- NFR-SEC-01: Deployed traffic uses HTTPS.
- NFR-SEC-02: Apply least-privilege RBAC and backend authorization.
- NFR-SEC-03: Validate untrusted input; use safe parameterized ORM queries.
- NFR-SEC-04: Never log passwords, tokens, secrets or unnecessary personal data.
- NFR-SEC-05: Define secure token storage, rotation, expiration and CSRF protections for chosen auth approach.
- NFR-PERF-01: Catalogue search should respond within 2 seconds under an agreed demo workload.
- NFR-PERF-02: Paginate large lists and avoid unbounded queries.
- NFR-REL-01: Critical workflows use database transactions and integrity constraints.
- NFR-REL-02: Backup and restore procedures are documented and tested.
- NFR-MAINT-01: Code is modular, typed, linted and covered by automated tests.
- NFR-OBS-01: Log errors and security events with request/correlation IDs.
- NFR-UX-01: Forms show validation errors; destructive actions require confirmation.
- NFR-PORT-01: Runtime and dependency versions are pinned/documented per release.

## 2.7 MVP acceptance criteria
1. Admin creates users and assigns roles.
2. Inventory officer creates serialized and quantity-based products.
3. Receiving creates stock movements and branch balances.
4. Duplicate serial/IMEI is rejected.
5. Cashier completes a sale only with available stock.
6. Sale, payment and stock deduction are atomic.
7. Receipt is retrievable and printable.
8. Manager views date-filtered sales and stock summaries.
9. Unauthorized role receives 403 for restricted actions.
10. Automated tests cover critical flows and deployment guide works on a clean host.

## 2.8 Approved configuration decisions (16 Nov 2026)
| Item | Decision | Reference |
|---|---|---|
| Operating currency | TZS (configurable via `CURRENCY`) | ADR-011 |
| Business timezone (BR-10) | Africa/Dar_es_Salaam (configurable via `BUSINESS_TIMEZONE`); all timestamps stored in UTC | ADR-011 |
| Tax | Configurable business data; never hard-coded. Design to be decided with the POS module. | ADR-012 |
| Money (BR-08) | `Decimal(14,2)` in the database; decimal strings in the API | ADR-011 |
| API base path | `/api/v1` with standard success/error envelopes | ADR-013 |
| Health check | `GET /api/v1/health` (supports NFR-REL and deployment health checks) | ADR-013 |
| Runtime | Node.js 24 LTS | ADR-008 |
| Roles & permissions | 7 system roles, 29 permission keys, fail-closed guards | ADR-016, doc 06 |
| Authentication | 15-min JWT access token; 7-day rotating refresh token (hashed, HttpOnly cookie); **30-day absolute session maximum**; Argon2id; rate limit + lockout | ADR-017, ADR-018, ADR-021 |
| Purchase approval | MANAGER and SYSTEM_ADMIN approve; procurement officers create but never approve | doc 06 §6.4 |
| Discounts & returns | Authorised only by MANAGER and SYSTEM_ADMIN; limits/rules in later modules | doc 06 §6.4 |
| Staff visibility | SYSTEM_ADMIN manages all users; MANAGER views staff of own branches only | doc 06 §6.4 |
| Audit visibility | SYSTEM_ADMIN all; MANAGER/AUDITOR own branches; global login events admin-only | doc 06 §6.4, ADR-020 |
| Initial administrator | `admin@gmail.com` (SYSTEM_ADMIN), seeded with a random temporary password; change on first login | ops §12.8 |
| Branch access | Admin all branches; others assigned (Cashier/Technician one); backend-enforced | ADR-019 |
| Audit | Append-only audit log of sensitive actions | ADR-020 |

Still open from the initial implementation review: discounts, payments, receipt numbering, transfers, adjustments, warranty rules and deferred features. They need stakeholder approval before the modules that depend on them are built. The permission-matrix decisions in doc 06 §6.4 were approved on 16 Nov 2026.
