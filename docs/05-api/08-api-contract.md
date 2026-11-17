# 8. REST API Contract (Proposed; conventions implemented)

Base path: `/api/v1`  
Content type: `application/json`  
Authentication: `Authorization: Bearer <access token>` on every route except public ones; the refresh token travels only in the `ebms_refresh` HttpOnly cookie (ADR-017).  
All list endpoints should support pagination (`page`, `limit`) and safe filters.

## Response conventions
*Implemented in Module 1, see ADR-013.*

Success:
```json
{ "data": {}, "meta": { "requestId": "..." } }
```
Paginated list:
```json
{ "data": [], "meta": { "requestId": "...", "pagination": { "page": 1, "limit": 20, "total": 41, "totalPages": 3 } } }
```
Error:
```json
{ "statusCode": 409, "code": "INSUFFICIENT_STOCK", "message": "Not enough available stock", "requestId": "..." }
```
Validation error (field `details` are included only for validation failures):
```json
{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "Validation failed", "requestId": "...",
  "details": [ { "field": "items.0.quantity", "messages": ["quantity must not be less than 1"] } ] }
```
Do not expose stack traces, SQL, secrets or internal host information. Unexpected failures return a generic 500 `INTERNAL_ERROR`; the details are logged on the server only, under the request ID.

### Request ID
Every response carries an `X-Request-Id` header, which is also returned as `requestId` in the body. A caller or reverse proxy may send its own `X-Request-Id` (8–64 characters from `A-Z a-z 0-9 . _ -`); otherwise the server generates a UUID.

### Input rules
- Request bodies and query strings are validated against DTOs. **Unknown properties are rejected** with 400 `VALIDATION_ERROR`, so client-supplied totals or prices cannot be smuggled in.
- Pagination: `page` (integer ≥ 1, default 1) and `limit` (integer 1–100, default 20).

### Money and time formats
- Money is sent and received as a **decimal string** in the operating currency (TZS by default), never as a JSON number. Input: up to 12 integer digits and 2 decimal places, non-negative (e.g. `"1750000"`, `"1750000.50"`). Output: always two decimals (`"1750000.00"`).
- Timestamps are ISO-8601 in UTC (e.g. `"2026-11-16T11:45:09.279Z"`). Business dates (`YYYY-MM-DD`) are calculated in the business timezone (Africa/Dar_es_Salaam by default).

### Error codes
| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input failed DTO validation; see `details` |
| `BAD_REQUEST` | 400 | Malformed request (e.g. invalid JSON) |
| `UNAUTHENTICATED` | 401 | Missing/invalid credentials or token |
| `FORBIDDEN` | 403 | Authenticated but lacking permission or branch access |
| `NOT_FOUND` | 404 | Route or resource not found |
| `CONFLICT` | 409 | State conflict |
| `DUPLICATE_VALUE` | 409 | Unique value already exists (e.g. SKU, serial/IMEI) |
| `REFERENCE_CONFLICT` | 409 | Operation conflicts with a related record |
| `PAYLOAD_TOO_LARGE` | 413 | Request body too large |
| `RATE_LIMITED` | 429 | Too many requests |
| `SERVICE_UNAVAILABLE` | 503 | Dependency (database) unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected server error (generic message) |
| `INVALID_CREDENTIALS` | 401 | Login failed (identical for unknown email, wrong password, inactive or locked account); 400 on change-password with a wrong current password |
| `INVALID_TOKEN` | 401 | Missing/invalid/expired/revoked access or refresh token |
| `PERMISSION_DENIED` | 403 | Required permission missing, or route declares no access rule |
| `BRANCH_ACCESS_DENIED` | 403 | Branch outside the caller's scope |
| `CSRF_CHECK_FAILED` | 403 | Refresh/logout without `X-Requested-With: XMLHttpRequest` or from a disallowed Origin |
| `WEAK_PASSWORD` | 400 | Password policy not met (see `details`) |
| `BRANCH_ASSIGNMENT_INVALID` | 400 | Branch assignments break the role's rules |
| `REFERENCE_INACTIVE` | 400 | Selected category/brand is inactive |
| `CATEGORY_IN_USE` / `BRAND_IN_USE` | 409 | Deactivation blocked: active products depend on it |
| `IMMUTABLE_FIELD` | 400 | Attempt to change sku, trackingMode, identifierType or identifiersPerUnit |
| `INVALID_STATUS_TRANSITION` | 409 | Action not allowed in the order's current status (incl. lost races) |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Creator or submitter tried to approve/reject (any role) |
| `SUPPLIER_IN_USE` | 409 | Supplier deactivation blocked: open purchase orders exist |
| `PURCHASE_NOT_EDITABLE` | 409 | Edit attempted on an order that is not DRAFT |
| `DUPLICATE_PRODUCT_LINE` | 400 | The same product appears on more than one line |
| `SELF_RECEIVING_FORBIDDEN` | 403 | Creator, submitter or approver tried to receive the order (BR-14) |
| `OVER_RECEIVING` | 409 | Quantity exceeds what is still outstanding on the PO line |
| `INVALID_IDENTIFIER` | 400 | IMEI (15 digits + Luhn) or serial format invalid |
| `IDENTIFIER_COUNT_MISMATCH` | 400 | Units/identifiers don't match quantity × identifiersPerUnit |
| `DUPLICATE_IDENTIFIER` | 409 | Identifier already exists or is repeated in the request |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same idempotency key used for a different request |
| `INSUFFICIENT_STOCK` | 409 | Not enough available stock at the branch |
| `UNIT_NOT_AVAILABLE` | 409 | Serialized unit not IN_STOCK at the selling branch (or already sold) |
| `PAYMENT_MISMATCH` | 400 | Payments don't sum to the total, or tender/reference rules failed |
| `TAX_NOT_CONFIGURED` | 409 | No VAT rate configured yet (BR-20) |
| `PRODUCT_NOT_SELLABLE` | 400 | Product inactive or not found |
| `ADMIN_LOCKOUT_PREVENTED` | 409 | Would deactivate/demote yourself or remove the last active administrator |

Business modules add specific codes (e.g. `INSUFFICIENT_STOCK`) as they are implemented.

### API documentation
OpenAPI UI at `/api/docs` and JSON at `/api/docs-json`. Enabled by default outside production; disabled in production unless `SWAGGER_ENABLED=true`.

## Endpoint catalogue
| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/health` | Readiness check: API running and database reachable (200 or 503). *Implemented in Module 1.* | Public |
| POST | `/auth/login` | Sign in → access token + refresh cookie. *Module 2* | Public, rate limited |
| POST | `/auth/refresh` | Rotate refresh cookie → new access token. *Module 2* | Refresh cookie + `X-Requested-With` |
| POST | `/auth/logout` | Revoke current session, clear cookie. *Module 2* | Refresh cookie + `X-Requested-With` |
| POST | `/auth/logout-all` | Revoke all own sessions. *Module 2* | Authenticated |
| GET | `/auth/me` | Own profile, permissions, branches. *Module 2* | Authenticated |
| POST | `/auth/change-password` | Change own password (revokes sessions). *Module 2* | Authenticated |
| GET/POST | `/users` | List (branch-scoped; managers see own branches' staff)/create users. *Module 2* | users:read / users:write |
| GET/PATCH | `/users/:id` | View; update name/role/branches/active. *Module 2* | users:read / users:write |
| POST | `/users/:id/password` | Admin password reset (unlocks, revokes sessions). *Module 2* | users:write |
| GET | `/roles` | Roles with permission keys. *Module 2* | roles:read |
| GET | `/permissions` | Permission catalogue. *Module 2* | roles:read |
| GET/POST | `/branches` | List (scoped)/create branches. *Module 2* | branches:read/write |
| GET/PATCH | `/branches/:id` | View (403 outside scope)/update or deactivate. *Module 2* | branches:read/write |
| GET/POST | `/categories` | List (`q`, `isActive`)/create categories. *Module 3* | catalogue:read/write |
| GET/PATCH | `/categories/:id` | View/update or deactivate (409 `CATEGORY_IN_USE`). *Module 3* | catalogue:read/write |
| GET/POST | `/brands` | List/create brands. *Module 3* | catalogue:read/write |
| GET/PATCH | `/brands/:id` | View/update or deactivate (409 `BRAND_IN_USE`). *Module 3* | catalogue:read/write |
| GET/POST | `/products` | List (`q`, `sku`, `categoryId`, `brandId`, `trackingMode`, `isActive`, `sort`, `order`)/create with initial prices. *Module 3* | catalogue:read/write |
| GET/PATCH | `/products/:id` | View/update. Price fields need `catalogue:price`; other fields need `catalogue:write`. *Module 3* | catalogue:read; catalogue:write and/or catalogue:price |
| GET/POST | `/products/:id/units` | Serialized units, **moved to Module 5 (Inventory)**; created only by receiving (D2) | inventory:read/write |
| GET | `/inventory/balances` | Balances (`branchId`, `productId`, `q`, `lowStock`); on hand, reserved, available, in transit. *Module 5* | inventory:read |
| GET | `/inventory/movements` | Ledger (`branchId`, `productId`, `type`, `from`, `to`); values need cost_read. *Module 5* | inventory:read |
| GET | `/inventory/units`, `/inventory/units/:id`, `/inventory/units/lookup?identifier=` | Serialized units; lookup outside scope reveals only "exists in another branch" (I15). *Module 5* | inventory:read |
| GET | `/goods-receipts`, `/goods-receipts/:id` | Goods receipts (branch-scoped). *Module 5* | inventory:read |
| GET | `/inventory/valuation` | WAC valuation per branch/product; in transit separate. *Module 5* | reports:inventory + catalogue:cost_read |
| POST | `/inventory/adjustments` | Adjustment with two-step approval. **Stage 5.2, deferred** | inventory:adjust (+ inventory:adjust_approve) |
| POST | `/inventory/transfers` | Two-step transfer. **Stage 5.2, deferred** | inventory:transfer |
| GET/POST | `/suppliers` | Supplier list (`q`, `isActive`)/create. *Module 4* | procurement:read/write |
| GET/PATCH | `/suppliers/:id` | View/update or deactivate (409 `SUPPLIER_IN_USE`). *Module 4* | procurement:read/write |
| GET/POST | `/purchases` | List (branch-scoped; `status`, `branchId`, `supplierId`, `q`, `createdFrom`, `createdTo`, `awaitingMyApproval`)/create draft. *Module 4* | procurement:read/write |
| GET/PATCH | `/purchases/:id` | View/edit (DRAFT only). *Module 4* | procurement:read/write |
| POST | `/purchases/:id/submit` | Submit for approval. *Module 4*. **Corrected: was procurement:approve** | procurement:write |
| POST | `/purchases/:id/approve` | Approve `{ note? }`; creator/submitter forbidden. *Module 4* | procurement:approve |
| POST | `/purchases/:id/reject` | Reject `{ reason }`; creator/submitter forbidden. *Module 4* | procurement:approve |
| POST | `/purchases/:id/reopen` | REJECTED → DRAFT. *Module 4* | procurement:write |
| POST | `/purchases/:id/cancel` | Cancel `{ reason }`; before approval: procurement:write; APPROVED: procurement:approve and nothing received. *Module 4* | procurement:write / approve |
| POST | `/purchases/:id/receive` | Receive goods (partial/complete, idempotent). *Module 5*. The order's creator, submitter or approver can't receive it (BR-14) | inventory:receive |
| GET/POST | `/products/:id/units` | Superseded by `/inventory/units?productId=`; units are created only by receiving | — |
| GET/POST | `/customers` | Customer search (`q` name/phone)/create. *Module 6* | customers:read/write |
| GET/PATCH | `/customers/:id` | View/update. *Module 6* | customers:read/write |
| GET/PUT | `/settings/tax` | Active VAT rate / set a new rate (audited). *Module 6* | authenticated / **settings:write** |
| GET | `/pos/catalogue` | Products with price and available stock at a branch. *Module 6* | sales:create |
| GET | `/pos/units` | IN_STOCK units of a product at a branch. *Module 6* | sales:create |
| POST | `/pos/quote` | Server-priced cart preview, no side effects. *Module 6* | sales:create |
| POST | `/sales` | Checkout (idempotent; 201 new / 200 replay). *Module 6* | sales:create |
| GET | `/sales` | List (`from`, `to`, `branchId`, `cashierId`, `customerId`, `receiptNumber`); branch-scoped. *Module 6* | sales:read |
| GET | `/sales/summary` | Daily summary per payment method and cashier. *Module 6* | reports:sales |
| GET | `/sales/:id`, `/sales/:id/receipt` | Sale detail / receipt DTO for printing. *Module 6* | sales:read |
| POST | `/sales/:id/returns` | Return workflow. **Deferred (after Module 6)** | sales:return |
| GET | `/warranties/lookup` | Lookup by serial/receipt | warranty:read |
| POST | `/warranties/claims` | Register claim | warranty:write |
| GET | `/reports/sales` | Sales report | reports:sales |
| GET | `/reports/inventory` | Inventory report | reports:inventory |
| GET | `/audit-logs` | Audit history (branch-scoped; filters action, entityType, entityId, actorId, branchId, from, to). *Module 2* | audit:read |

## Example checkout request
```json
{
  "branchId": "uuid",
  "customerId": "uuid",
  "items": [
    { "productId": "uuid", "productUnitId": "uuid", "quantity": 1 }
  ],
  "payments": [
    { "method": "CASH", "amount": "1750000", "reference": null }
  ],
  "idempotencyKey": "client-generated-unique-value"
}
```

## Checkout rules
- Backend reloads authoritative prices and stock.
- Client-supplied totals are ignored.
- Validate user branch access and permissions.
- Validate serialized unit is IN_STOCK at the sale branch.
- For quantity stock, use atomic conditional decrement and check affected row count.
- Create sale, sale items, payments, stock movement, balance updates and audit event in one DB transaction.
- Idempotency key prevents duplicate checkout on network retry.
- Return `201 Created` with receipt DTO only after commit.

## HTTP status conventions
- `200` successful read/update
- `201` created
- `204` successful no-content operation
- `400` invalid input
- `401` unauthenticated
- `403` authenticated but forbidden
- `404` resource not found
- `409` state conflict, duplicate serial, insufficient stock
- `422` semantically invalid business request (if adopted consistently) — not used by any implemented endpoint yet
- `429` rate limited
- `500` unexpected server error
- `503` service unavailable (health check when the database is unreachable)

## Authentication flow (implemented in Module 2; ADR-017)
1. `POST /auth/login` `{ "email", "password" }` → `200 { data: { accessToken, tokenType: "Bearer", expiresIn: 900, user: { id, email, fullName, role, permissions[], branchIds[], allBranches } } }` and
   `Set-Cookie: ebms_refresh=<opaque>; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=<seconds until the token expires: 7 days, or less near the 30-day session limit>`.
2. The SPA keeps `accessToken` **in memory** and sends `Authorization: Bearer <accessToken>`.
3. On a 401 `INVALID_TOKEN` (or before expiry), it calls `POST /auth/refresh` with `credentials: "include"` and the header `X-Requested-With: XMLHttpRequest`. The response has the same body shape and a **new** cookie. The old refresh token is now spent; reusing it revokes the whole session. Refreshing never extends a session beyond **30 days** after login; after that, `/auth/refresh` returns 401 and the user must sign in again.
4. `POST /auth/logout` (same cookie + header requirements) → `204` and the cookie is cleared.

Login is limited to 5 requests per IP per minute (429 `RATE_LIMITED` with `Retry-After`). After 5 consecutive wrong passwords the account locks for 15 minutes, but the response stays the same generic 401.

### Users
`POST /users` `{ email, fullName, password, roleKey, branchIds[] }`. `PATCH /users/:id` `{ fullName?, roleKey?, isActive?, branchIds? }`. `branchIds` replaces all assignments and is validated against the final role. User responses never contain password or token data:
```json
{ "id": "uuid", "email": "cashier@x.tz", "fullName": "…", "isActive": true, "isLocked": false,
  "lastLoginAt": null, "role": { "key": "CASHIER", "name": "Cashier / Salesperson" },
  "branches": [ { "id": "uuid", "code": "DSM01", "name": "…" } ], "createdAt": "…Z", "updatedAt": "…Z" }
```

## Product catalogue (Module 3; proposal `docs/proposals/module-3-catalogue.md`)
- Money fields are decimal strings in TZS. **`sellingPrice` is tax-exclusive** (`priceIncludesTax: false`); the POS adds tax from configurable settings.
- `costPrice` is **omitted** from every product response unless the caller holds `catalogue:cost_read` (not CASHIER or TECHNICIAN).
- `sku` is normalised to upper case; it, `trackingMode`, `identifierType` and `identifiersPerUnit` cannot be changed (400 `IMMUTABLE_FIELD`).
- `PATCH /products/:id` is checked field by field: `costPrice`/`sellingPrice` need `catalogue:price`, every other field needs `catalogue:write`. The whole request fails with 403 if any part is not permitted.

## Procurement (Module 4; proposal `docs/proposals/module-4-procurement.md`)
- Order money: TZS decimal strings, tax-exclusive. `subtotal` and `lineTotal` are always calculated by the server; client-sent totals are rejected.
- Separation of duties: the creator and the submitter of an order can never approve or reject it (403 `SELF_APPROVAL_FORBIDDEN`), including SYSTEM_ADMIN. It is also enforced by a database CHECK.
- **Module 5 hand-off:** `GET /purchases?status=APPROVED&branchId=…` lists orders ready for receiving. Each order exposes `createdBy` and `approvedBy`, so that Module 5 can block receiving by either (BR-14), plus `quantityOrdered` and `quantityReceived` per line. Each line also exposes its `id` (the `purchaseItemId` used by receiving) and the product's `identifierType` and `identifiersPerUnit`, so the receiving screen knows how many IMEIs or serials each unit needs (added 16 Nov 2026 for the frontend; additive).

## Inventory (Module 5, stage 5.1; proposal `docs/proposals/module-5-inventory.md`)
**Receive:** `POST /purchases/:id/receive`
```json
{ "idempotencyKey": "uuid", "supplierDeliveryRef": "DN-88231", "supplierInvoiceRef": "INV-2026-1145", "notes": "…",
  "items": [ { "purchaseItemId": "…", "quantity": 2, "units": [ { "identifiers": ["5CG3301ABC"] }, { "identifiers": ["5CG3301ABD"] } ] },
             { "purchaseItemId": "…", "quantity": 30 } ] }
```
- The response is `201` with the receipt (`GRN-…`, PO status, lines, units). A retry with the same key and body returns `200` with the same receipt; the same key with a different body returns 409 `IDEMPOTENCY_KEY_REUSED`.
- Costs (`unitCost`, values, averages) are omitted without `catalogue:cost_read`.
