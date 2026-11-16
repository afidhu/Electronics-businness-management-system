# 3. User Stories & Acceptance Criteria

## Access control
**US-01 — Sign in:** As a staff member, I want to sign in so I can use authorized functions.
- Valid active account returns authenticated response.
- Invalid credentials return a generic error.
- Deactivated accounts cannot sign in.
- *(Module 2)* The generic error is identical for unknown email, wrong password, inactive and locked accounts.
- *(Module 2)* After 5 consecutive failures the account is locked for 15 minutes; login requests are limited per IP (429).
- *(Module 2)* Email is case- and whitespace-insensitive.

**US-02 — Role permissions:** As an administrator, I want to assign roles so staff only access their duties.
- Cashier cannot access user administration.
- Backend returns 403 when permission is absent.
- UI visibility is not treated as a security control.
- *(Module 2)* Roles grant permission keys (doc 06); routes without a declared access rule are denied.
- *(Module 2)* Role and branch changes apply to the user's next request, without signing in again.
- *(Module 2)* An administrator cannot deactivate or demote themselves, and the last active administrator cannot be removed.

**US-09 — Stay signed in safely:** As a staff member, I want my session to renew without re-entering my password, and to end when I sign out. *(Module 2)*
- The access token expires after 15 minutes; it is renewed with a refresh cookie valid for 7 days.
- Every renewal replaces the refresh token; reusing an old one ends the session everywhere.
- Signing out revokes the session immediately; "sign out everywhere" revokes all sessions.
- Changing my password signs me out of all sessions.
- A session ends at most 30 days after sign-in, however often it is renewed.

**US-10 — Branch assignment:** As an administrator, I want to assign staff to branches so they only see and act on their branches' records. *(Module 2)*
- CASHIER and TECHNICIAN have exactly one branch; MANAGER, INVENTORY_OFFICER, PROCUREMENT_OFFICER and AUDITOR may have several.
- SYSTEM_ADMIN accesses all branches without assignments.
- Requests for another branch return 403 `BRANCH_ACCESS_DENIED`; lists show only assigned branches' records.

**US-11 — Manage staff accounts:** As an administrator, I want to create, update, deactivate and reset passwords of users. *(Module 2)*
- New passwords meet the policy (≥ 12 characters).
- Deactivating a user revokes their sessions and blocks their current access token at once.
- Every change is recorded in the audit log without passwords or tokens.

## Product catalogue
**US-03 — Register product:** As inventory staff, I want to register a product model.
- SKU, name, category, brand and tracking mode are validated.
- Duplicate SKU is rejected.
- Inactive products cannot be used in new purchases/sales.

**US-12 — Approve purchase orders (separation of duties):** As a manager, I want to approve or reject purchase orders created by others, so no one can authorise their own purchase. *(Module 3)*
- Only users with `procurement:approve` (MANAGER, SYSTEM_ADMIN) can approve or reject.
- The creator of a purchase order cannot approve or reject it, whatever their role (403).
- Approval and rejection record who acted, when, and the reason (for rejection) in the audit log.
- Approval is limited to purchase orders of branches within the approver's scope.

## Inventory receiving
**US-04 — Receive stock:** As an inventory officer, I want to receive goods against a purchase.
- User selects branch and purchase.
- Serialized products require a unique identifier for each physical unit.
- Receiving creates movement entries and updates stock in one transaction.
- Duplicate receiving is prevented.

**US-05 — View branch stock:** As a manager, I want to view stock by branch.
- Results show on-hand, reserved and available quantity.
- Serialized units can be inspected individually.

## Sales
**US-06 — Complete sale:** As a cashier, I want to sell available products.
- Backend verifies branch, product status, price and stock.
- Server recalculates totals.
- Serialized units are marked SOLD.
- Payment and stock movement are recorded atomically.
- Receipt number is unique.

**US-07 — Review sales:** As a manager, I want to filter sales.
- Filters include date range, branch and cashier.
- Totals reconcile to completed sales/payment entries.

## Warranty
**US-08 — Check warranty:** As a staff member, I want to check warranty by serial or receipt.
- Warranty is linked to an eligible completed sale.
- Status clearly indicates active, expired or ineligible.
- Changes to warranty dates are permission-controlled and audited.

## End-to-end MVP demo
1. Admin creates inventory officer and cashier accounts.
2. Inventory officer creates a serialized laptop model.
3. A purchase is recorded and two serial-numbered units are received.
4. Cashier sells one unit to a customer.
5. The unit becomes SOLD and stock decreases.
6. Receipt is displayed/printed.
7. Warranty is visible for the sold unit.
8. Manager sees the sale in daily reporting.
9. Second sale attempt for the same unit is rejected.
