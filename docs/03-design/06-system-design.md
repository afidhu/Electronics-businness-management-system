# 6. System Design Document

## 6.1 Architectural style
Use a **modular monolith**. One NestJS deployable contains independently organised business modules. This is simpler to build, test and operate than microservices for the prototype, while retaining clear boundaries.

## 6.2 Logical layers
- Presentation: React pages, forms, route guards and API client.
- API: NestJS controllers, request DTOs, authentication and authorization.
- Application/domain: services, business rules, state transitions and transaction orchestration.
- Persistence: Prisma repositories/client and PostgreSQL.
- Infrastructure: Docker, reverse proxy, logs, backups and deployment configuration.

## 6.3 Proposed backend modules
`auth`, `users`, `roles`, `branches`, `catalogue`, `suppliers`, `purchases`, `inventory`, `customers`, `sales`, `payments`, `warranties`, `repairs` (later), `reports`, `audit`, `common`.

Controllers should handle HTTP concerns; services own business rules; Prisma access should be kept behind clear service/repository boundaries. Avoid putting business logic in controllers.

## 6.4 Frontend areas
- Login and session handling.
- Main layout/navigation with permission-aware menu.
- Dashboard.
- Catalogue: products, categories, brands.
- Inventory: branch stock, serial units, movements, transfers.
- Procurement: suppliers, purchase orders, receiving.
- POS: product search, cart, customer, payment and receipt.
- Warranty lookup and claims.
- Reports and user administration.

## 6.5 Critical workflows
### Goods receiving
1. Verify user permission and branch access.
2. Validate purchase status and quantities.
3. Validate serial identifiers for serialized products.
4. In a DB transaction, create receipt record, unit records, stock movements and stock balance updates.
5. Update purchase receiving state.
6. Commit; return receipt summary.
7. If any step fails, rollback all writes.

### POS checkout
1. Validate cashier, branch, customer and cart.
2. Load authoritative product prices and stock on server.
3. Validate serialized units or quantity availability.
4. Recalculate discounts, tax and totals according to configured policy.
5. In one transaction, create sale and lines, record payments, decrement stock/update units, write movements and audit event.
6. Commit and return receipt.
7. On conflict/insufficient stock, rollback and return a meaningful error.

## 6.6 Concurrency and consistency
Do not rely on a frontend stock check. Two cashiers can attempt the last unit simultaneously. Use a transaction plus a conditional update/locking strategy appropriate to PostgreSQL isolation and schema. For serialized units, update status only if current status is IN_STOCK and verify exactly one row was updated. For quantity stock, use atomic conditional decrement (`available >= requested`) and check affected row count. Add integration tests for concurrent requests.

## 6.7 Data integrity
- Unique SKU and serial identifier constraints.
- Foreign keys and check constraints where appropriate.
- Decimal monetary columns.
- Immutable movement ledger (correct errors with reversal movements, not silent edits).
- Explicit state transition validation.
- Idempotency key or unique receiving reference for retry-safe operations.

## 6.8 Security design
- Hash passwords using Argon2id or bcrypt with appropriate cost.
- Short-lived access tokens; define refresh-token rotation/revocation.
- Prefer secure, HttpOnly, SameSite cookies if browser-based cookie auth is selected; account for CSRF. If bearer tokens are used, avoid unsafe persistent browser storage.
- Enforce permissions in NestJS guards and services.
- Validate all DTOs and constrain pagination/filter input.
- Rate-limit login and sensitive endpoints.
- Keep secrets in environment/secret manager, never in Git.
- Audit sensitive operations without storing secrets or excessive personal data.

## 6.9 Error handling
Use consistent error response shape, e.g. `{ "statusCode": 400, "code": "INSUFFICIENT_STOCK", "message": "Not enough stock available", "requestId": "..." }`. Do not expose stack traces or database internals to clients.

## 6.10 Design limitations
Tax rules, warranty policies, stock reservation, branch transfers, returns and partial payments require stakeholder decisions before production implementation.
