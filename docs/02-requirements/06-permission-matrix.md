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
| `catalogue:read` | View products, categories, brands *(future)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `catalogue:write` | Maintain the catalogue *(future)* | ✓ | | ✓ | | | | |
| `inventory:read` | View stock, units, movements *(future)* | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `inventory:write` | Maintain serialized unit records *(future)* | ✓ | | ✓ | | | | |
| `inventory:receive` | Receive goods against POs *(future)* | ✓ | | ✓ | ✓ | | | |
| `inventory:adjust` | Stock adjustments with reason *(future)* | ✓ | ✓ | ✓ | | | | |
| `inventory:transfer` | Stock transfers *(future)* | ✓ | ✓ | ✓ | | | | |
| `procurement:read` | View suppliers & POs *(future)* | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `procurement:write` | Maintain suppliers & POs *(future)* | ✓ | | | ✓ | | | |
| `procurement:approve` | Submit/approve/cancel POs *(future)* | ✓ | ✓ | | | | | |
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
| `reports:sales` | Sales reports & dashboard *(future)* | ✓ | ✓ | | | | | ✓ |
| `reports:inventory` | Inventory reports *(future)* | ✓ | ✓ | | | | | ✓ |

## 6.4 Approved business decisions (16 Nov 2026)
1. **Purchase approval and separation of duties:** MANAGER and SYSTEM_ADMIN hold `procurement:approve`. PROCUREMENT_OFFICER creates purchase orders and never approves them. **The creator of a purchase order can never approve (or reject) it, whatever their role**, including SYSTEM_ADMIN and MANAGER (decided 16 Nov 2026, ADR-023). Approval and rejection are audited. *To be implemented in Module 3.*
2. **Discounts and returns:** only MANAGER and SYSTEM_ADMIN hold `sales:discount` and `sales:return`. Detailed discount limits and return rules belong to the sales and returns modules.
3. **Staff list:** SYSTEM_ADMIN manages all users (`users:write`). MANAGER has `users:read` and sees only staff assigned to at least one of their branches. Managers cannot create, update, deactivate or reset passwords.
4. **Audit visibility:** SYSTEM_ADMIN sees all audit events. MANAGER and AUDITOR see only events tied to their authorised branches. Global events with no branch (logins, logouts, token reuse, password changes) are visible only to SYSTEM_ADMIN.
5. **Session lifetime:** maximum absolute session of **30 days** from login. Refresh-token rotation never extends it (ADR-021).

## 6.5 Enforcement summary
| Layer | Mechanism |
|---|---|
| Authentication | Global `JwtAuthGuard`: a Bearer access token is required unless the route is `@Public()`. The user is re-loaded from the database on every request. |
| Permission | Global `PermissionsGuard`: `@RequirePermissions(...)` requires all listed keys; undeclared routes are denied. |
| Branch (request) | Global `BranchScopeGuard`: `@BranchScoped('params' \| 'query' \| 'body', field)` checks every branch ID the client sends. |
| Branch (data) | `BranchAccessService.assertCanAccess()` and `scopeFilter()` inside services. Lists show only in-scope rows; a single out-of-scope branch returns 403 `BRANCH_ACCESS_DENIED`. |
