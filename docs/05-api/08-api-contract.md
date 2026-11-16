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
| GET/POST | `/categories` | List/create categories | catalogue:read/write |
| GET/POST | `/brands` | List/create brands | catalogue:read/write |
| GET/POST | `/products` | List/create products | catalogue:read/write |
| GET/PATCH | `/products/:id` | View/update product | catalogue:read/write |
| GET/POST | `/products/:id/units` | List/register serialized units | inventory:read/write |
| GET | `/inventory/balances` | Branch stock balances | inventory:read |
| GET | `/inventory/movements` | Stock ledger | inventory:read |
| POST | `/inventory/adjustments` | Approved adjustment | inventory:adjust |
| POST | `/inventory/transfers` | Create transfer | inventory:transfer |
| GET/POST | `/suppliers` | Supplier list/create | procurement:read/write |
| GET/POST | `/purchases` | Purchase list/create | procurement:read/write |
| POST | `/purchases/:id/submit` | Submit purchase | procurement:approve |
| POST | `/purchases/:id/receive` | Receive goods | inventory:receive |
| GET/POST | `/customers` | Customer list/create | customers:read/write |
| POST | `/sales` | Checkout | sales:create |
| GET | `/sales/:id` | Sale detail/receipt | sales:read |
| POST | `/sales/:id/returns` | Return workflow | sales:return |
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
