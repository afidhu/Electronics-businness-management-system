# 4. Product Backlog & Delivery Plan

Priority: P0 = essential prototype; P1 = valuable; P2 = later.

| ID | Work item | Priority | Done when |
|---|---|---:|---|
| PB-01 | Repository, README, lint and env template | P0 | Clean local startup; secrets excluded |
| PB-02 | PostgreSQL and Prisma | P0 | Migration and health check pass |
| PB-03 | Auth and users | P0 | Login and protected endpoint tested |
| PB-04 | RBAC and branch access | P0 | Restricted route returns 403 |
| PB-05 | Categories, brands, products | P0 | Validated CRUD; unique SKU |
| PB-06 | Product units / serial identifiers | P0 | Duplicate serial rejected |
| PB-07 | Suppliers and purchase orders | P0 | Purchase lifecycle works |
| PB-08 | Goods receiving and stock ledger | P0 | Receipt updates stock atomically |
| PB-09 | Customers and POS | P0 | Sale, payment, receipt work |
| PB-10 | Concurrent stock protection | P0 | Concurrent sale test prevents oversell |
| PB-11 | Dashboard and sales reports | P1 | Branch/date filters work |
| PB-12 | Warranty registration/lookup | P1 | Sold unit warranty can be found |
| PB-13 | Returns/refunds | P1 | Controlled reversal and audit |
| PB-14 | Repair workflow | P2 | Job status lifecycle works |
| PB-15 | Docker deployment and backups | P0 | Reproducible deployment and restore drill |
| PB-16 | Advanced analytics / integrations | P2 | Defined after stakeholder discovery |

## Suggested milestones
- M1: Discovery, SRS, diagrams and data model.
- M2: Repository, database, auth and RBAC.
- M3: Catalogue, suppliers, purchases and receiving.
- M4: Inventory and POS end-to-end workflow.
- M5: Reports and basic warranty.
- M6: Test, security review, documentation and deployment.

## Prototype cut line
If time is limited, deliver PB-01 through PB-10 and a minimal dashboard. Explain warranty/repairs as planned modules rather than claiming they are implemented.
