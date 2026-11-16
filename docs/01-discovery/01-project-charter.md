# 1. Project Charter & Discovery Brief

## 1.1 Purpose
ElectroCore EBMS is a proposed application for an electronics retailer or distributor. It centralises catalogue, serialized device tracking, stock, purchasing, sales, customer records, warranty records and management reporting.

## 1.2 Problem hypothesis
Electronics businesses may experience fragmented records, stock inaccuracies, weak serial-number traceability, slow checkout, unclear warranty status and delayed reporting when processes are manual or disconnected. These are hypotheses—not confirmed facts about any named company.

## 1.3 Objectives
- Maintain a single product catalogue.
- Track individual serialized units (IMEI/serial) when required.
- Track quantities by branch and location.
- Record supplier purchases and goods received.
- Maintain an auditable stock movement ledger.
- Record sales, payment entries and receipts consistently.
- Link sold units to customers and warranty terms.
- Provide role-appropriate operational reports.
- Enforce least-privilege access and audit sensitive actions.

## 1.4 Stakeholders and user roles
| Stakeholder / role | Main responsibility |
|---|---|
| Owner / sponsor | Approves business outcomes, policy and scope |
| System administrator | Users, roles, branches and configuration |
| Manager | Oversight, reports and approvals |
| Inventory officer | Receiving, transfers, counts and adjustments |
| Procurement officer | Suppliers and purchase orders |
| Cashier / salesperson | Customer checkout, sales and receipts |
| Technician | Warranty assessment and repair workflow (later release) |
| Auditor / read-only | Reviews authorised records and audit trail |
| Customer | Receives receipt and warranty service; not necessarily a system login |

## 1.5 Scope
### In scope for MVP
- Single organisation with multiple branches.
- Users, roles and branch-level access.
- Categories, brands, products and product units.
- Serialized and quantity-based inventory.
- Suppliers, purchase orders and receiving.
- Stock ledger and balances.
- Customers, POS sales, payment records and receipts.
- Basic warranty lookup.
- Dashboard, sales/stock reports and audit log.

### Out of scope for MVP
- Full accounting/general ledger and statutory tax filing.
- Direct mobile-money/card gateway integration (record method/reference only).
- E-commerce storefront, delivery fleet and supplier EDI.
- Offline-first POS and sync conflict resolution.
- AI forecasting and multi-company SaaS tenancy.
- Full workshop parts inventory and payroll/HR.

## 1.6 Assumptions requiring validation
1. Business operates one or more branches.
2. Some devices require IMEI/serial tracking; accessories may be quantity-based.
3. Purchases add stock; sales reduce stock.
4. Staff require different access permissions.
5. Stock must never become negative through normal workflows.
6. Warranty eligibility is based on completed sale and product policy.
7. MVP does not process payments directly through a gateway.

## 1.7 Discovery questions
- Which products require serial/IMEI tracking? Can a device have two IMEIs?
- Are there branches, warehouses, shelves or stock locations?
- Is stock reserved for orders or deducted only at checkout?
- What are the current purchase, receiving, sales and returns workflows?
- Are prices tax-inclusive? What tax and rounding rules apply?
- Are partial/split payments allowed? Which payment methods are used?
- Who approves discounts, refunds, voids and stock adjustments?
- How are warranty durations, exclusions and service-centre processes defined?
- Are repairs performed internally or outsourced?
- Which reports are required and who may see them?
- Which existing POS/accounting tools, printers, barcode scanners or integrations must be supported?
- Expected number of users, branches and transactions per day?
- Required uptime, backup retention and recovery objectives?

## 1.8 Proposed success measures
- No duplicate serial/IMEI values within the organisation.
- No serialized unit can be sold twice.
- Sale, payment and stock deduction are atomic.
- Stock balances reconcile to the movement ledger.
- Restricted operations are protected by server-side authorization tests.
- A database backup can be restored successfully in a rehearsal.
- Staff can complete the main receiving-to-sale demo workflow.

## 1.9 Risks and mitigations
| Risk | Mitigation |
|---|---|
| Unvalidated assumptions | Conduct discovery and obtain workflow sign-off |
| Duplicate/poor serial data | Unique constraints, input validation and receiving checks |
| Concurrent sales oversell stock | DB transaction, row-level/conditional updates and concurrency tests |
| Unauthorized discounts/refunds | Permission checks, approval rules and audit log |
| Sensitive data exposure | Least privilege, HTTPS, secure secrets and minimal logs |
| Unusable backups | Scheduled backups plus periodic restore drills |
| Scope too large for prototype | Deliver a narrow end-to-end MVP first |
