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
| Category *(Module 3)* | id, name, nameKey, description, isActive | Flat product classification. `nameKey` (lower-case) is unique, making names case-insensitive. Deactivate, never delete; deactivation blocked while active products use it. |
| Brand *(Module 3)* | id, name, nameKey, isActive | Manufacturer/brand; same rules as Category |
| Product *(Module 3)* | id, sku, name, description, categoryId, brandId, trackingMode, identifierType, identifiersPerUnit, costPrice, sellingPrice, reorderLevel, specifications, isActive, createdById, updatedById | Product model (SKU). SKU unique, upper-case, immutable. Tracking mode and identifier policy immutable. Prices `Decimal(14,2)` TZS, **tax-exclusive**, organisation-wide; cost hidden from roles without `catalogue:cost_read`. Variants are separate SKUs. |
| ProductUnit *(Module 5)* | id, productId, branchId, status, unitCost, goodsReceiptItemId | One physical serialized device, created at receiving (opening balances in stage 5.2). Statuses IN_STOCK, IN_TRANSIT, RESERVED, SOLD, RETURNED, UNDER_REPAIR, WRITTEN_OFF. Product must be SERIALIZED (trigger); identifier count and type must match the product (deferred trigger) |
| UnitIdentifier *(Module 5)* | id, productUnitId, type, value, isPrimary | IMEI/serial identifiers. Value normalised and **unique across the whole organisation** (D3). Count per unit = product's `identifiersPerUnit` |
| Supplier *(Module 4)* | id, name, nameKey, contactPerson, phone, email, address, tin, notes, isActive | Organisation-wide. Name is case-insensitive unique; TIN unique when set. No payment terms or bank details. Deactivation blocked while open orders exist. |
| Purchase *(Module 4)* | id, reference, supplierId, branchId, status, currency, subtotal, supplierReference, expectedDeliveryDate, notes, createdById/At, updatedById/At, submittedById/At, approvedById/At, approvalNote, rejectedById/At, rejectionReason, cancelledById/At, cancellationReason | Purchase order. Reference `PO-{BRANCH}-{YYYY}-{NNNNNN}`. Separation of duties by DB CHECK: approver and rejecter ≠ creator and submitter. Status consistency enforced. |
| PurchaseItem *(Module 4)* | id, purchaseId, lineNumber, productId, productName, quantityOrdered, quantityReceived, unitCost, lineTotal | One line per product. Whole-number quantities. unitCost > 0, TZS, tax-exclusive. Lines editable only while DRAFT (trigger); `quantityReceived` written only by Module 5. |
| DocumentSequence *(Module 4)* | scope, lastValue | Atomic per-scope counters (PO numbers per branch and year; reusable) |
| GoodsReceipt *(Module 5)* | id, reference, purchaseId, branchId, receivedById, receivedAt, supplierDeliveryRef, supplierInvoiceRef, notes, idempotencyKey, requestHash | `GRN-{BRANCH}-{YYYY}-{NNNNNN}`. Idempotency key unique. BR-14 trigger: receiver ≠ creator, submitter (any cycle), approver. Insert-only |
| GoodsReceiptItem *(Module 5)* | id, goodsReceiptId, purchaseItemId, productId, quantity, unitCost | Quantity > 0; unit cost copied from the PO line (I20) |
| InventoryValuation *(Module 5)* | productId, averageCost (Decimal 18,4) | Moving weighted average, organisation-wide (I1); catalogue prices untouched (I2) |
| StockBalance *(Module 5)* | productId, branchId (unique pair), onHand, reserved | `on_hand >= 0`, `0 <= reserved <= on_hand` (reserved stays 0 until POS, I17); whole units |
| StockMovement *(Module 5)* | id, productId, branchId, movementType, quantityDelta, unitCost, valueDelta, productUnitId, referenceType, referenceId, actorId, createdAt | **Append-only** (trigger). Serialized: one row per unit (±1). Types: OPENING_BALANCE, PURCHASE_RECEIPT, ADJUSTMENT_INCREASE/DECREASE, TRANSFER_OUT/IN |
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
- Positive purchase/sale quantities. **Purchase quantities are whole numbers (P7, resolves the earlier decimal-vs-integer question for purchasing).**
- Non-negative prices and payment amounts.
- Decimal/numeric types for money and quantities; never JavaScript floating point as the source of truth.
- Foreign keys for all relationships.
- Use status enums and explicit state transitions.
- Avoid hard-deleting referenced business records; deactivate/archive instead.
- StockMovement should be append-only for normal application users.

## Physical conventions (approved 16 Nov 2026 — ADR-009, ADR-011)
These apply to every table added to `backend/prisma/schema.prisma`.
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
- Module 3: migration `20261116130111_catalogue` created `categories`, `brands` and `products` (enums `TrackingMode`, `IdentifierType`), with CHECK constraints (SKU format, non-negative prices and reorder level, tracking/identifier consistency, lower-case `name_key`, JSON-object specifications) and a trigger making `sku` and the tracking policy immutable.
- Module 4: migration `20261116133722_procurement` created `suppliers`, `purchases`, `purchase_items` and `document_sequences` (enum `PurchaseStatus`). It adds CHECKs (separation of duties, status consistency, reasons, reference format, TIN, quantities, `line_total = quantity_ordered × unit_cost`), triggers (immutable reference/creator/branch/currency; lines locked outside DRAFT except `quantity_received` for Module 5) and no changes to existing tables.
- Module 5 (stage 5.1): migration `20261116180009_inventory` created `goods_receipts`, `goods_receipt_items`, `product_units`, `unit_identifiers`, `stock_balances`, `stock_movements` and `inventory_valuations` (enums `MovementType`, `UnitStatus`), with CHECKs, append-only triggers, the BR-14 trigger and a deferred identifier trigger. A forward fix `20261116180733_inventory_identifier_trigger_fix` corrected that trigger function. Stage 5.2 tables (adjustments, transfers) are not created yet.
- Tables use snake_case names (`@@map`). The ERD (`03-design/diagrams/04-erd.mmd`) reflects these models.
