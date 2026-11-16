# 9. Data Dictionary (Conceptual)

This is a logical model, not a final Prisma schema. Field types, nullability and constraints must be confirmed during implementation.

| Entity | Key fields | Purpose / rules |
|---|---|---|
| User *(implemented)* | id, email, fullName, passwordHash, roleId, isActive, failedLoginAttempts, lockedUntil, lastLoginAt, passwordChangedAt | Staff identity. Email is unique and stored normalised (DB check). passwordHash is Argon2id and is never returned or logged. Never hard-deleted (deactivate instead). |
| Role *(implemented)* | id, key, name, description, maxBranches, isSystem | Seven system roles seeded from code; `maxBranches` 1 for CASHIER/TECHNICIAN, null = unlimited |
| Permission *(implemented)* | id, key, description | Fine-grained capability such as `sales:create` (29 keys; see doc 06) |
| RolePermission *(implemented)* | roleId, permissionId (composite PK) | Many-to-many role permissions |
| Branch *(implemented)* | id, code, name, address, phone, isActive | Business stock/sales location. Code is unique, upper-case and immutable. Deactivate, never delete. |
| UserBranch *(implemented)* | userId, branchId (composite PK), assignedById, assignedAt | Limits a user to assigned branches |
| RefreshToken *(implemented)* | id, userId, tokenHash, familyId, expiresAt, sessionExpiresAt, revokedAt, revokedReason, replacedById | Login session. Only the SHA-256 hash is stored; rotation links tokens; `familyId` groups one login. `sessionExpiresAt` = login + 30 days, copied on rotation. DB check: `expiresAt <= sessionExpiresAt`. |
| Category | id, name | Product classification |
| Brand | id, name | Manufacturer/brand |
| Product | id, sku, name, categoryId, brandId, trackingMode, costPrice, sellingPrice, reorderLevel | Product model; SKU unique |
| ProductUnit | id, productId, branchId, status | One physical serialized device |
| UnitIdentifier | id, productUnitId, type, value, isPrimary | IMEI/serial identifiers; value unique globally or per policy |
| Supplier | id, name, phone, email, address | Supplier master record |
| Purchase | id, reference, supplierId, branchId, status, createdBy | Purchase order lifecycle |
| PurchaseItem | id, purchaseId, productId, orderedQty, receivedQty, unitCost | Products ordered |
| GoodsReceipt | id, reference, purchaseId, receivedBy, receivedAt | Goods receiving event; reference unique |
| StockBalance | id, productId, branchId, onHand, reserved | Query-optimized balance; unique product+branch |
| StockMovement | id, productId, branchId, movementType, quantityDelta, referenceType, referenceId, actorId | Append-only inventory ledger |
| Customer | id, name, phone, email | Customer; collect minimum necessary data |
| Sale | id, receiptNumber, customerId, branchId, cashierId, status, subtotal, discount, tax, total | Completed/voided sale; unique receipt |
| SaleItem | id, saleId, productId, productUnitId, quantity, unitPrice, lineTotal | Sale lines; unit optional for quantity products |
| Payment | id, saleId, method, amount, reference, status | Payment record; external processing not in MVP |
| WarrantyPolicy | id, productId/categoryId, durationDays, terms | Warranty rules; avoid ambiguous overlapping policies |
| Warranty | id, saleId, productUnitId, customerId, startDate, endDate, status | Warranty instance linked to sale/unit |
| WarrantyClaim | id, warrantyId, issue, status, resolution | Claim lifecycle |
| RepairJob | id, productUnitId, customerId, technicianId, status, diagnosis, notes | Later-release repair workflow |
| AuditLog *(implemented)* | id, actorId, action, entityType, entityId, branchId, metadata, ipAddress, requestId, createdAt | Sensitive action history; append-only (DB trigger); metadata sanitised of secrets; branchId enables branch-scoped reading |

## Important constraints
- Unique: normalized user email, branch code, product SKU, purchase reference, receipt number.
- Unique serial/IMEI identifier according to the organisation's identifier policy.
- Unique StockBalance `(productId, branchId)`.
- Positive purchase/sale quantities.
- Non-negative prices and payment amounts.
- Decimal/numeric types for money and quantities; never JavaScript floating point as the source of truth.
- Foreign keys for all relationships.
- Use status enums and explicit state transitions.
- Avoid hard-deleting referenced business records; deactivate/archive instead.
- StockMovement should be append-only for normal application users.

## Physical conventions (approved 16 Nov 2026 — ADR-009, ADR-011)
These apply to every table added to `EBMS/backend/prisma/schema.prisma`.
- **Money:** `Decimal(14,2)` (`@db.Decimal(14, 2)`), in the operating currency (TZS by default). Exchanged in the API as decimal strings.
- **Timestamps:** `DateTime @db.Timestamptz(3)`, stored in UTC. The database session timezone is UTC.
- **Business dates** (e.g. warranty start/end) are derived in the business timezone (Africa/Dar_es_Salaam by default). Whether they are stored as `@db.Date` or derived from timestamps will be decided per module.
- **Identifiers:** UUID primary keys, as in the ERD.
- **Tax:** no tax rate is stored in configuration or code. Tax rules will be data (ADR-012); the rate applied is recorded on each sale.
- **Quantities:** the column type (decimal vs integer) is still an open decision (initial review, item 4), to be settled with the inventory module.

**Implementation status:**
- Module 1: empty baseline migration `20261116112022_init`.
- Module 2: migration `20261116115559_auth_rbac_audit` created `roles`, `permissions`, `role_permissions`, `branches`, `users`, `user_branches`, `refresh_tokens` and `audit_logs`. It also added check constraints (normalised email, upper-case branch code, positive `max_branches`, non-negative failure counter, 64-hex token hash) and the append-only trigger on `audit_logs`.
- Migration `20261116…_session_absolute_expiry` added `refresh_tokens.session_expires_at` (backfilled, NOT NULL) and the check `expires_at <= session_expires_at` (ADR-021).
- Tables use snake_case names (`@@map`). The ERD (`03-design/diagrams/04-erd.mmd`) reflects these models.
