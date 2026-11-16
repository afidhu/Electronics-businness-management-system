# Module 4 — Procurement & Purchasing: Approved Proposal

**Status:** Approved by the project owner on 16 Nov 2026 (decisions P1–P16). Implementation authorised for Module 4 only.
**Excluded:** receiving, goods receipts, stock movements, serial capture and product cost updates (all Module 5).
**Related:** ADR-019 (branch isolation), ADR-020/026 (audit), ADR-023 (separation of duties), ADR-027 (procurement design), ADR-028 (receiving separation of duties, Module 5).

## 1. Objectives and scope
Manage suppliers and purchase orders from draft to approval, with strict separation of duties, and hand approved orders to Module 5 for receiving.
Requirements covered: FR-PUR-01, FR-PUR-02, FR-PUR-05 (extended), FR-PUR-06 (supplier reference), BR-11, US-12, PB-07.

| In scope | Out of scope |
|---|---|
| Suppliers: create, view, update, deactivate | Receiving, goods receipts, received quantities, stock, serials (Module 5) |
| Purchase orders: create, edit draft, submit, approve, reject, reopen, cancel | Product cost updates (P14, decided in Module 5) |
| Separation of duties in the service **and** the database | Purchase requisitions (P1), value-based approval limits (P10) |
| Branch scoping, audit, PO numbering | Supplier payment terms and bank details (P11), invoices and payments |

## 2. Lifecycle (P2, P5)
```
DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─(Module 5)→ PARTIALLY_RECEIVED → RECEIVED
  ▲               └─reject→ REJECTED ─reopen─┐
  └──────────────────────────────────────────┘
DRAFT | SUBMITTED | REJECTED ─cancel (procurement:write, reason)→ CANCELLED
APPROVED, nothing received ─cancel (procurement:approve, reason)→ CANCELLED
PARTIALLY_RECEIVED → Module 5 "close short" workflow
```
| Transition | Permission | Rules |
|---|---|---|
| create → DRAFT | procurement:write | branch in scope; active branch, supplier and products |
| edit DRAFT | procurement:write | any user with procurement:write and branch access (P4); the creator never changes |
| DRAFT → SUBMITTED | procurement:write | ≥ 1 line; supplier and products still active; lines become frozen |
| SUBMITTED → APPROVED | procurement:approve | **actor ≠ creator and ≠ submitter** (P3), including SYSTEM_ADMIN; branch in scope; optional note |
| SUBMITTED → REJECTED | procurement:approve | same separation rule; reason required |
| REJECTED → DRAFT | procurement:write | reopen for revision; history kept |
| → CANCELLED | see diagram | reason required; audited |

All transitions are conditional (`WHERE status = expected`) inside a locked transaction; the losing side of a race gets 409 `INVALID_STATUS_TRANSITION`.

## 3. Separation of duties (P3, ADR-023)
1. **Permissions:** only MANAGER and SYSTEM_ADMIN hold `procurement:approve`; PROCUREMENT_OFFICER never approves.
2. **Service:** the creator and the submitter can never approve or reject an order (403 `SELF_APPROVAL_FORBIDDEN`). Each blocked attempt is audited as `purchase.approval_blocked`.
3. **Database:** CHECK constraints make it impossible to store an approver or rejecter equal to the creator or submitter.

The approver must also have the order's branch in scope. Every installation therefore needs at least two people in purchasing.

**Receiving (P15, enforced in Module 5, ADR-028):** a user can never receive (partially or finally) an order they created or approved. Receiving is done by another user with `inventory:receive`, and the receiver and all receiving details are audited. `inventory:receive` is **not** removed from PROCUREMENT_OFFICER.

## 4. Permissions (no new permissions; no grant changes)
| Action | ADMIN | MANAGER | INVENTORY | PROCUREMENT | CASHIER | TECHNICIAN | AUDITOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| View suppliers (organisation-wide) | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| Manage suppliers | ✓ | – | – | ✓ | – | – | – |
| View purchase orders | all | own branches | own branches | own branches | – | – | own branches |
| Create/edit/submit/reopen/cancel (before approval) | ✓ | – | – | own branches | – | – | – |
| Approve/reject/cancel approved | ✓ (not own) | own branches (not own) | – | – | – | – | – |

Everyone with `procurement:read` also holds `catalogue:cost_read`, so unit costs need no masking (an invariant test protects this).

## 5. Data model
| Model | Fields | Rules |
|---|---|---|
| Supplier | id, name, nameKey (UNIQUE), contactPerson?, phone?, email?, address?, tin? (UNIQUE when set), notes?, isActive, timestamps | organisation-wide; deactivation blocked with 409 while open orders exist (P12) |
| Purchase | id, reference (UNIQUE), supplierId, branchId, status, currency (TZS), subtotal, supplierReference?, expectedDeliveryDate? (date, P16), notes?, createdBy/At, updatedBy/At, submittedBy/At, approvedBy/At, approvalNote?, rejectedBy/At, rejectionReason?, cancelledBy/At, cancellationReason? | open = DRAFT, SUBMITTED, REJECTED, APPROVED, PARTIALLY_RECEIVED |
| PurchaseItem | id, purchaseId, lineNumber, productId, productName (snapshot), quantityOrdered (Int > 0, P7), quantityReceived (Int, default 0, **written only by Module 5**), unitCost (Decimal(14,2) > 0, TZS, tax-exclusive, P8), lineTotal | UNIQUE (purchaseId, productId) (P9) and (purchaseId, lineNumber) |
| DocumentSequence | scope (PK, e.g. `PO:DSM01:2026`), lastValue | atomic increment inside the order transaction; reusable for later documents |

**Reference (P6):** `PO-{BRANCHCODE}-{YYYY}-{NNNNNN}`, one independent sequence per branch and year (year in the business timezone), assigned when the draft is created. A rolled-back transaction may leave a gap, which is acceptable.

**Database rules:**
- CHECK constraints: quantities; received quantity ≤ ordered; unit cost > 0; reference format; separation of duties; status consistency (who/when columns required per status); reasons required.
- A trigger allows changes to order lines only while the order is DRAFT, except `quantity_received` while APPROVED or PARTIALLY_RECEIVED, which is Module 5's hook.

## 6. API (`/api/v1`)
| Method | Path | Permission |
|---|---|---|
| GET/POST | `/suppliers` | procurement:read / procurement:write |
| GET/PATCH | `/suppliers/:id` | procurement:read / procurement:write |
| GET | `/purchases` (`status`, `branchId`, `supplierId`, `q`, `createdFrom`, `createdTo`, `awaitingMyApproval`) | procurement:read, branch-scoped |
| POST | `/purchases` | procurement:write, branch in scope |
| GET/PATCH | `/purchases/:id` (PATCH: drafts only; header fields and full line replacement) | procurement:read / procurement:write |
| POST | `/purchases/:id/submit` | **procurement:write** (contract corrected) |
| POST | `/purchases/:id/approve` `{ note? }` / `/reject` `{ reason }` | procurement:approve + separation of duties |
| POST | `/purchases/:id/reopen` | procurement:write |
| POST | `/purchases/:id/cancel` `{ reason }` | procurement:write before approval; procurement:approve once approved |
| POST | `/purchases/:id/receive` | **Module 5** |

**Module 5 hand-off:** `GET /purchases?status=APPROVED&branchId=…` (readable by inventory officers through `procurement:read`). Each order exposes `createdBy` and `approvedBy` (needed for P15). `quantityReceived` and the PARTIALLY_RECEIVED/RECEIVED statuses already exist.

New error codes: `INVALID_STATUS_TRANSITION` (409), `SELF_APPROVAL_FORBIDDEN` (403), `SUPPLIER_IN_USE` (409), `PURCHASE_NOT_EDITABLE` (409), `DUPLICATE_PRODUCT_LINE` (400); `REFERENCE_INACTIVE` (400) reused.

## 7. Validation
- References must exist and be active (supplier, branch, products), checked at creation, on edit and at submission.
- 1–100 lines; whole-number quantity from 1 to 1,000,000; unit cost > 0 with at most 2 decimals; one line per product.
- Totals are calculated by the server and must fit Decimal(14,2); client-sent totals are rejected.
- `expectedDeliveryDate` is optional and must not be in the past (Africa/Dar_es_Salaam).
- Reasons: 5–500 characters. Approval note: up to 500 characters.
- Supplier email and phone formats checked; TIN 9 digits (dashes allowed).

## 8. Audit
- Supplier events: `supplier.created|updated|deactivated|reactivated` (organisation-wide, visible to every audit reader, P13).
- Order events: `purchase.created|updated|submitted|approved|rejected|reopened|cancelled|approval_blocked`, carrying the order's branch (visible to managers and auditors of that branch).
- `purchase.updated` records old → new values and line changes; rejections and cancellations include the reason.
- Login events remain SYSTEM_ADMIN-only.

## 9. Tests
- **Unit:** transitions, separation of duties, decimal line maths and overflow, validation, reference format, cost-visibility invariant.
- **Integration:** database separation-of-duties CHECK, line-lock trigger, status consistency, unique constraints, concurrent numbering.
- **E2E:** suppliers; full lifecycle including reject → reopen → resubmit → approve; self-approval and self-rejection blocked for every approver role and audited; every role × every endpoint; branch isolation; illegal transitions; races (approve vs reject, edit vs submit); server-calculated totals; inactive references; audit content and visibility.
- **Mutation check:** removing the service separation-of-duties check must be caught, and the database must still refuse.

## 10. Migration
One additive migration `…_procurement` (enum and 4 tables, foreign keys to existing tables, constraints, trigger). No changes to existing columns or data. Test reset updated. `'Supplier'` added to the organisation-wide audit entity types.

## 11. Approved decisions
| # | Decision |
|---|---|
| P1 | Requisitions deferred (outside the MVP). |
| P2 | APPROVED and REJECTED added; rejected orders can be reopened as drafts with history preserved. |
| P3 | Creator and submitter can never approve or reject, regardless of role (including SYSTEM_ADMIN). |
| P4 | Any procurement:write user with branch access may edit or submit a draft; the creator stays unchanged. |
| P5 | Cancellation: DRAFT/SUBMITTED/REJECTED by procurement:write with a reason; APPROVED only by procurement:approve when nothing has been received, with a reason; partially received → Module 5 close-short; all cancellations audited. |
| P6 | `PO-{BRANCHCODE}-{YYYY}-{NNNNNN}`, independent sequence per branch and year. |
| P7 | Whole-number quantities. |
| P8 | Unit cost > 0, tax-exclusive, TZS. |
| P9 | One line per product per order. |
| P10 | No value-based approval limits in the MVP. |
| P11 | Supplier fields: name (case-insensitive unique), contactPerson, phone, email, address, TIN (unique when set), notes. No payment terms or bank details. |
| P12 | Supplier deactivation blocked with 409 while open orders exist. |
| P13 | Supplier audit events are organisation-wide; login-event restrictions unchanged. |
| P14 | Deferred to Module 5: product cost prices are not updated in Module 4. |
| P15 | Option B (enforced in Module 5): a user cannot receive (partially or finally) an order they created or approved; another user with inventory:receive receives; receiver and details audited; enforced in the backend and tested; inventory:receive stays with PROCUREMENT_OFFICER. |
| P16 | expectedDeliveryDate optional. |
