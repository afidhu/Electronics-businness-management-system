# Module 3 — Product Catalogue: Approved Proposal

**Status:** Approved by the project owner on 16 Nov 2026 (decisions D1–D15 below). Implementation authorised for Module 3 only.
**Scope reminder:** Procurement (Module 4) and Inventory (Module 5) are excluded.
**Related:** ADR-004 (Product vs ProductUnit), ADR-011 (money and time), ADR-012 (tax), ADR-016 (permissions), ADR-020 (audit), ADR-025 (catalogue design), ADR-026 (catalogue audit visibility); permission matrix doc 06.

## 1. Objectives and scope
Provide one **organisation-wide catalogue** of product models (SKUs), grouped by category and brand. Each product declares whether its stock is tracked per physical device (serial/IMEI) or by quantity.
Requirements covered: FR-CAT-01..04, US-03, PB-05, T-04, plus the groundwork for FR-UNIT-01 and FR-UNIT-05.

| In scope | Out of scope (later modules) |
|---|---|
| Categories and brands: create, view, update, deactivate | Physical units (ProductUnit/UnitIdentifier) and stock (Module 5, Inventory) |
| Products: SKU, name, description, category, brand, tracking mode, identifier policy, cost and selling price, reorder level, specifications | Suppliers, purchase orders, approval and separation of duties (Module 4, Procurement) |
| Field-level price permissions; cost-price visibility | Warranty policies; barcodes (D14); images; linked variants |
| Search, filtering, pagination; audit events | Tax calculation (POS module; prices are tax-exclusive, D7) |
| Optional development-only demo data (`db:seed:demo`) | |

## 2. Data model
```
CATEGORY 1──* PRODUCT *──1 BRAND
USER 1──* PRODUCT (created_by / updated_by)
(Module 5: PRODUCT 1──* PRODUCT_UNIT 1──* UNIT_IDENTIFIER)
```
| Model | Fields | Rules |
|---|---|---|
| Category | id, name, nameKey, description?, isActive, timestamps | `nameKey` = lower-case, whitespace-collapsed name, **UNIQUE**. Flat; no hierarchy (D11). |
| Brand | id, name, nameKey, isActive, timestamps | Same case-insensitive uniqueness. |
| Product | id, sku, name, description?, categoryId, brandId, trackingMode (`SERIALIZED`/`QUANTITY`), identifierType (`IMEI`/`SERIAL`, serialized only), identifiersPerUnit (1–2, serialized only), costPrice, sellingPrice (`Decimal(14,2)`, TZS, **tax-exclusive**), reorderLevel, specifications (JSON), isActive, createdById?, updatedById?, timestamps | SKU UNIQUE, upper-case, immutable. Tracking mode and identifier policy immutable (D9). Money ≥ 0. Deactivated, never deleted. |

Normalised key columns are used instead of expression indexes, because Prisma would try to drop an expression index it doesn't know about.

## 3. Migration plan
- Migration `…_catalogue`: purely additive (enums `TrackingMode`, `IdentifierType`; tables `categories`, `brands`, `products`).
- Hand-written database constraints:
  - SKU format `^[A-Z0-9][A-Z0-9._-]{1,39}$`
  - prices ≥ 0, reorder level ≥ 0
  - tracking/identifier consistency (serialized ⇔ identifier type set and 1–2 identifiers per unit; quantity ⇔ both null)
  - `name_key` must be lower-case
  - non-blank names
- Indexes on name, category_id, brand_id, is_active.
- Applied with `migrate dev` locally, by the e2e global setup on the test database, and with `migrate deploy` in production.
- Rollback: before real data exists, drop the three tables; afterwards, fix forward.

## 4. API (`/api/v1`, standard envelope, pagination, unknown fields rejected)
| Method | Path | Permission |
|---|---|---|
| GET | `/categories` (`q`, `isActive`, page, limit) | catalogue:read |
| POST | `/categories` `{ name, description? }` | catalogue:write |
| GET / PATCH | `/categories/:id` `{ name?, description?, isActive? }` | catalogue:read / catalogue:write |
| GET | `/brands` | catalogue:read |
| POST | `/brands` `{ name }` | catalogue:write |
| GET / PATCH | `/brands/:id` `{ name?, isActive? }` | catalogue:read / catalogue:write |
| GET | `/products` (`q`, `sku` exact, `categoryId`, `brandId`, `trackingMode`, `isActive`, `sort`=name\|sku\|sellingPrice\|createdAt, `order`) | catalogue:read |
| POST | `/products` | catalogue:write (initial prices included) |
| GET | `/products/:id` | catalogue:read |
| PATCH | `/products/:id` | **field-level:** ordinary fields need catalogue:write; `costPrice` / `sellingPrice` need **catalogue:price**. A mixed request needs both, otherwise the whole request is rejected (403) and nothing changes. |

`GET/POST /products/:id/units` from the original contract moves to Module 5 (D2).

**Create example:**
```json
POST /api/v1/products
{ "sku": "hp-pb450-g10-i5", "name": "HP ProBook 450 G10 i5 16GB/512GB",
  "categoryId": "…", "brandId": "…", "trackingMode": "SERIALIZED",
  "identifierType": "SERIAL", "identifiersPerUnit": 1,
  "costPrice": "1450000", "sellingPrice": "1750000.00", "reorderLevel": 2,
  "specifications": { "cpu": "Intel Core i5-1335U", "ram": "16GB", "storage": "512GB SSD" } }
```
**Response 201:** the product, with `sku` upper-cased, money as 2-decimal strings, `currency: "TZS"`, `priceIncludesTax: false`, `category {id,name}` and `brand {id,name}`. `costPrice` is **omitted** for callers without `catalogue:cost_read`.

**New error codes:**
- `REFERENCE_INACTIVE` (400): category or brand is inactive
- `CATEGORY_IN_USE` / `BRAND_IN_USE` (409): deactivation would orphan active products
- `IMMUTABLE_FIELD` (400): attempt to change sku, trackingMode, identifierType or identifiersPerUnit

Duplicates return 409 `DUPLICATE_VALUE` with field `details`.

## 5. Permissions (all seven roles)
| Role | catalogue:read | catalogue:write | catalogue:price *(new)* | catalogue:cost_read *(new; enforces D4)* |
|---|:-:|:-:|:-:|:-:|
| SYSTEM_ADMIN | ✓ | ✓ | ✓ | ✓ |
| MANAGER | ✓ | – | ✓ | ✓ |
| INVENTORY_OFFICER | ✓ | ✓ (initial prices only) | – | ✓ |
| PROCUREMENT_OFFICER | ✓ | – | – | ✓ |
| CASHIER | ✓ | – | – | – |
| TECHNICIAN | ✓ | – | – | – |
| AUDITOR | ✓ | – | – | ✓ |

`catalogue:cost_read` exists because ADR-016 requires checks on permission keys, never role names. It reproduces D4 exactly and grants no other access.

## 6. Catalogue rules
- **Categories and brands:** flat, case-insensitive unique names, deactivated rather than deleted. They can't be deactivated while active products use them (409, D12). Inactive ones can't be assigned to products.
- **SKU:** entered manually; trimmed and upper-cased; 2–40 characters `A–Z 0–9 . _ -`; unique across the organisation; immutable (D9). Each variant is its own SKU (D10).
- **Specifications:** a flat object of at most 30 entries. Keys are 1–40 characters (letters, digits, space, `_`); values are a string (≤ 200), number or boolean. Descriptive only.
- **Prices:** organisation-wide (D8), **tax-exclusive** (D7; tax is computed by the POS from configurable settings, never hard-coded). Selling below cost is allowed but audited (D6).

## 7. Serialized vs quantity products
| | SERIALIZED | QUANTITY |
|---|---|---|
| Physical item | ProductUnit created **only at receiving** (Module 5); opening stock through an audited stock adjustment (D2) | none |
| Product policy | `identifierType` IMEI/SERIAL; `identifiersPerUnit` 1–2 (dual-SIM) | not applicable |
| Identifier rules (used by Module 5) | Normalised (trim, upper-case; IMEI digits only). IMEI = 15 digits with a valid Luhn check digit; serial = 4–64 `A-Z 0-9 - . /`. **Unique across the whole organisation after normalisation (D3).** | — |

Module 3 provides the identifier normalisation and validation utilities with unit tests; Module 5 adds the database-level uniqueness on UnitIdentifier.

## 8. Validation and duplicates
- Requests are validated with DTOs; database UNIQUE and CHECK constraints are the final guarantee.
- A race between two identical SKU creations results in exactly one 201 and one 409 (tested).
- Category and brand rows are locked inside transactions, so a product cannot be attached to a category that is being deactivated at the same moment.

## 9. Branches
The catalogue is organisation-wide (FR-CAT-03), so it is not branch-scoped. Branch stock comes with Module 5 and will be shown only for branches inside the user's scope.

## 10. Audit events (written in the same transaction as the change)
- `category.created|updated|deactivated|reactivated`
- `brand.created|updated|deactivated|reactivated`
- `product.created|updated|deactivated|reactivated`
- `product.price_changed`: per changed field, old → new value; the actor and timestamp come from the audit record
- `product.selling_below_cost`: whenever a create or price change leaves sellingPrice below costPrice

**Visibility (D13):** catalogue events are visible to every `audit:read` holder (SYSTEM_ADMIN, MANAGER, AUDITOR). Login and other global events stay SYSTEM_ADMIN-only.

## 11. Tests
- **Unit:** SKU and name normalisation, specifications, IMEI Luhn and identifier normalisation, price-change detection, cost-price masking, permission-matrix invariants (new permissions granted only as approved).
- **Integration:** database CHECK and UNIQUE constraints.
- **E2E:**
  - CRUD for all resources; search and pagination
  - duplicate SKU (including different case) and a concurrent race
  - inactive references; deactivation blocked
  - immutable fields; money validation
  - every role × every endpoint
  - field-level price permission, including mixed PATCH requests
  - cost hidden for CASHIER and TECHNICIAN
  - audit old/new values and below-cost events; audit visibility per role
  - `db:seed:demo` refuses to run outside development

## 12. Dependencies
- **Module 1:** config, Prisma, errors, validation, money helpers, pagination, envelope, test database.
- **Module 2:** guards and decorators, permissions seed, AuditService (transactional), test helpers.
- No new npm packages.

## 13. Approved decisions
| # | Decision |
|---|---|
| D1 | Purchasing and the purchase separation-of-duties rule are implemented in **Module 4 (Procurement)**; ADR-023 updated. |
| D2 | Serialized units are created during receiving (Inventory module). Opening stock uses an audited stock adjustment. |
| D3 | IMEI/serial identifiers are unique across the whole organisation after normalisation. |
| D4 | CASHIER and TECHNICIAN never receive cost prices from the API (enforced server-side through `catalogue:cost_read`). |
| D5 | New `catalogue:price` for MANAGER and SYSTEM_ADMIN. INVENTORY_OFFICER enters initial prices at creation only and cannot change them afterwards. Every price change records old value, new value, user, timestamp and changed fields. Field-level permissions apply to mixed PATCH requests. |
| D6 | Selling below cost is allowed and audited. |
| D7 | Selling prices are **tax-exclusive**. The POS calculates tax from configurable settings; no hard-coded rates. |
| D8 | Organisation-wide pricing for the MVP. |
| D9 | SKU, tracking mode and identifier policy are immutable after creation. |
| D10 | Each variant has its own SKU. |
| D11 | Flat categories. |
| D12 | Category or brand deactivation is blocked with 409 while active products depend on it. |
| D13 | MANAGER and AUDITOR see catalogue audit events; SYSTEM_ADMIN sees everything; global login events stay SYSTEM_ADMIN-only. |
| D14 | Barcode support deferred. |
| D15 | Optional `db:seed:demo`, development environment only; it refuses to run in any other environment. |
