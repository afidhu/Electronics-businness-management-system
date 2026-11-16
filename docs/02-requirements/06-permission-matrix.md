# 6. Role & Permission Matrix

**Status:** Approved by the project owner on 16 Nov 2026 (roles, branch access, and the §6.4 decisions); implemented in Module 2.
**Source of truth in code:** `backend/src/access/permissions.ts`. The database is seeded from that file (`npm run db:seed`). If this document and the code ever differ, the code is what runs, and this document must be corrected.

## 6.1 Principles
- **Permission-based, not role-name-based (ADR-016).** Authorization checks permission keys such as `sales:create`, never role names. Roles are bundles of permissions.
- **Fail closed.** Every API route must declare `@Public()`, `@AuthenticatedOnly()` or `@RequirePermissions(...)`. A route without a declaration is denied (403).
- **Backend enforcement.** Hiding something in the UI is not a security control (US-02). Every check happens on the server, and the user's permissions are re-read from the database on every request.
- **Branch scope is separate from permissions (ADR-019).** A permission says *what* a user may do; the branch scope says *where*. Both must pass.
- System roles are managed in code and are read-only through the API (`GET /roles`). Custom roles are not part of the MVP.

## 6.2 Roles and branch access
| Role key | Name | Purpose | Branch access | Max branches |
|---|---|---|---|---|
| `SYSTEM_ADMIN` | System Administrator | Full system access | **All branches** (`branches:access_all`); no assignments | — |
| `MANAGER` | Manager | Management, approvals and reporting | Assigned branches | Unlimited |
| `INVENTORY_OFFICER` | Inventory Officer | Products and inventory operations | Assigned branches | Unlimited |
| `PROCUREMENT_OFFICER` | Procurement Officer | Suppliers, purchasing and stock receiving | Assigned branches | Unlimited |
| `CASHIER` | Cashier / Salesperson | Customers, POS sales, payments and receipts | Assigned branch | **1** |
| `TECHNICIAN` | Technician | Reserved for the future repair and warranty module | Assigned branch | **1** |
| `AUDITOR` | Auditor | Read-only access to authorised records | Assigned branches, read-only | Unlimited |

Branch-scoped roles must have at least one active branch. `SYSTEM_ADMIN` must have none, because it already has access to all branches.

## 6.3 Permission matrix
✓ = granted. Permissions marked *(future)* exist so later modules can be secured from day one; the endpoints that use them are built in those modules.

| Permission | Meaning | ADMIN | MANAGER | INVENTORY | PROCUREMENT | CASHIER | TECHNICIAN | AUDITOR |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `users:read` | View staff accounts (branch-scoped unless all-branch) | ✓ | ✓ | | | | | ✓ |
| `users:write` | Create/update/deactivate users, assign roles & branches, reset passwords | ✓ | | | | | | |
| `roles:read` | View roles & permissions | ✓ | ✓ | | | | | ✓ |
| `branches:read` | View branches (within scope) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `branches:write` | Create/update/deactivate branches | ✓ | | | | | | |
| `branches:access_all` | Access every branch without assignment | ✓ | | | | | | |
| `audit:read` | View audit history (within scope) | ✓ | ✓ | | | | | ✓ |
| `catalogue:read` | View products, categories, brands | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `catalogue:write` | Create categories/brands/products (incl. **initial** prices); update non-price fields | ✓ | | ✓ | | | | |
| `catalogue:price` | Change cost/selling price of an existing product (Module 3, D5) | ✓ | ✓ | | | | | |
| `catalogue:cost_read` | See product cost prices in API responses (Module 3, D4) | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `inventory:read` | View stock, units, movements *(future)* | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `inventory:write` | Maintain serialized unit records *(future)* | ✓ | | ✓ | | | | |
| `inventory:receive` | Receive goods against POs *(Module 5; never by the PO's creator or approver, BR-14)* | ✓ | | ✓ | ✓ | | | |
| `inventory:adjust` | Stock adjustments with reason *(future)* | ✓ | ✓ | ✓ | | | | |
| `inventory:transfer` | Stock transfers *(future)* | ✓ | ✓ | ✓ | | | | |
| `procurement:read` | View suppliers & POs (branch-scoped) | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `procurement:write` | Maintain suppliers; create/edit/submit/reopen/cancel POs before approval | ✓ | | | ✓ | | | |
| `procurement:approve` | Approve/reject POs (never own: creator or submitter); cancel approved POs | ✓ | ✓ | | | | | |
| `customers:read` | View customers *(future)* | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| `customers:write` | Maintain customers *(future)* | ✓ | | | | ✓ | | |
| `sales:read` | View sales & receipts *(future)* | ✓ | ✓ | | | ✓ | | ✓ |
| `sales:create` | POS checkout & payments *(future)* | ✓ | | | | ✓ | | |
| `sales:return` | Returns/refunds *(future)* | ✓ | ✓ | | | | | |
| `sales:discount` | Apply discounts *(future)* | ✓ | ✓ | | | | | |
| `warranty:read` | Warranty lookup *(future)* | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| `warranty:write` | Warranty claims *(future)* | ✓ | | | | | ✓ | |
| `repairs:read` | View repair jobs *(later release)* | ✓ | | | | | ✓ | ✓ |
| `repairs:write` | Manage repair jobs *(later release)* | ✓ | | | | | ✓ | |
| `settings:write` | Change organisation settings, e.g. the VAT rate (Module 6) | ✓ | | | | | | |
| `reports:sales` | Sales reports & dashboard (Module 6: daily summary) | ✓ | ✓ | | | | | ✓ |
| `reports:inventory` | Inventory reports *(future)* | ✓ | ✓ | | | | | ✓ |

## 6.4 Approved business decisions (16 Nov 2026)
1. **Purchase approval and separation of duties:** MANAGER and SYSTEM_ADMIN hold `procurement:approve`. PROCUREMENT_OFFICER creates purchase orders and never approves them. **The creator of a purchase order can never approve (or reject) it, whatever their role**, including SYSTEM_ADMIN and MANAGER (decided 16 Nov 2026, ADR-023). Approval and rejection are audited. *Implemented in Module 4 (Procurement); see §6.4b.*
2. **Discounts and returns:** only MANAGER and SYSTEM_ADMIN hold `sales:discount` and `sales:return`. Detailed discount limits and return rules belong to the sales and returns modules.
3. **Staff list:** SYSTEM_ADMIN manages all users (`users:write`). MANAGER has `users:read` and sees only staff assigned to at least one of their branches. Managers cannot create, update, deactivate or reset passwords.
4. **Audit visibility:** SYSTEM_ADMIN sees all audit events. MANAGER and AUDITOR see only events tied to their authorised branches. Global events with no branch (logins, logouts, token reuse, password changes) are visible only to SYSTEM_ADMIN.
5. **Session lifetime:** maximum absolute session of **30 days** from login. Refresh-token rotation never extends it (ADR-021).

## 6.4a Module 3 catalogue decisions (approved 16 Nov 2026)
- **D4 (cost visibility):** CASHIER and TECHNICIAN never receive `costPrice`. The API omits the field unless the caller holds `catalogue:cost_read`. That permission exists only because checks use permission keys, never role names (ADR-016). It is granted to exactly the roles that may see cost and gives no other access.
- **D5 (price changes):** `catalogue:price` (MANAGER, SYSTEM_ADMIN) is required to change `costPrice`/`sellingPrice` of an existing product. INVENTORY_OFFICER sets initial prices when creating a product (`catalogue:write`) but cannot change them later. A PATCH containing both ordinary and price fields needs both permissions; otherwise the whole request is rejected (403) and nothing changes. Every price change is audited with old and new values per field, the user and the timestamp.
- **D13 (audit visibility):** catalogue events (Category, Brand, Product) are organisation-wide and visible to all `audit:read` holders (SYSTEM_ADMIN, MANAGER, AUDITOR). Global login and identity events stay SYSTEM_ADMIN-only.

## 6.4b Module 4 procurement decisions (approved 16 Nov 2026)
- **No new permissions and no grant changes.** Submitting needs `procurement:write` (the API contract previously said `procurement:approve`, which was corrected).
- **Separation of duties (P3):** the creator and the submitter of an order can never approve or reject it, whatever their role, including SYSTEM_ADMIN. Enforced in the service and by database CHECK constraints.
- **Receiving (P15, Module 5):** the creator and the approver of an order can never receive it. PROCUREMENT_OFFICER keeps `inventory:receive`.
- **Branch scope:** purchase orders are visible and actionable only within the user's branches (SYSTEM_ADMIN: all). Suppliers are organisation-wide and their audit events are visible to every audit reader (P13).
- **Invariant:** every holder of `procurement:read` also holds `catalogue:cost_read`, because order lines show unit costs.

## 6.4c Module 5 inventory decisions (approved 16 Nov 2026)
- **Receiving (BR-14, I4):** `inventory:receive` holders may receive only orders they did not create, submit (in any cycle) or approve. SYSTEM_ADMIN can't bypass this (I22). Enforced in the service and by a DB trigger.
- **Costs:** unit costs, movement values and valuation are returned only with `catalogue:cost_read` (CASHIER sees quantities only). Valuation also requires `reports:inventory`.
- **I9 (deferred to stage 5.2):** a new `inventory:adjust_approve` permission for MANAGER and SYSTEM_ADMIN will be added together with the adjustment workflow. **No new permission exists in stage 5.1.**

## 6.4d Module 6 POS decisions (approved 16 Nov 2026)
- **New permission `settings:write` (SYSTEM_ADMIN only)** to set the VAT rate (S1). Granted to no other role.
- Only CASHIER and SYSTEM_ADMIN ring sales (`sales:create`, S19). SYSTEM_ADMIN must choose a branch (S10).
- Cashiers see sales of their own branch only (S8). Managers and auditors see their branches; admin sees all.
- Cost of goods sold (`costAtSale`) only with `catalogue:cost_read`; never to cashiers (S11).
- Customers are organisation-wide (S6). Customer audit metadata never contains phone or email values.

## 6.5 Enforcement summary
| Layer | Mechanism |
|---|---|
| Authentication | Global `JwtAuthGuard`: a Bearer access token is required unless the route is `@Public()`. The user is re-loaded from the database on every request. |
| Permission | Global `PermissionsGuard`: `@RequirePermissions(...)` requires all listed keys; `@RequireAnyPermission(...)` requires at least one (then the service checks field-level rules, e.g. product PATCH); undeclared routes are denied. |
| Branch (request) | Global `BranchScopeGuard`: `@BranchScoped('params' \| 'query' \| 'body', field)` checks every branch ID the client sends. |
| Branch (data) | `BranchAccessService.assertCanAccess()` and `scopeFilter()` inside services. Lists show only in-scope rows; a single out-of-scope branch returns 403 `BRANCH_ACCESS_DENIED`. |
