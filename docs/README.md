# ElectroCore EBMS — Complete System Documentation

**Product:** ElectroCore EBMS (Electronics Business Management System)  
**Version:** 0.1 (proposed baseline)  
**Prepared:** 16 November 2026  
**Status:** Independent interview-preparation prototype / proposed solution.

> **Important:** This is a proposed system for a representative electronics retailer/distributor. It is not a statement of Raddy Electronics' actual systems, internal processes, requirements, or approval. Validate all assumptions with real stakeholders. In an interview, present it as an independent prototype/case study.

## Product vision
A central application to manage electronics products, individual serialized devices, inventory by branch, suppliers, purchasing, sales/POS, customers, warranties, repairs and operational reporting.

## Proposed MVP
1. Authentication, users, roles and branch access.
2. Categories, brands and product catalogue.
3. Serialized product units (IMEI/serial) and quantity-based stock.
4. Suppliers, purchase orders and goods receiving.
5. Inventory ledger and stock balances.
6. Customers, POS sales, payment recording and receipts.
7. Basic warranty registration and lookup.
8. Dashboard, reports and audit history.

**Later release:** repair workflow, advanced analytics, barcode hardware, direct payment integrations, accounting, e-commerce, offline POS, multi-company tenancy and AI forecasting.

## Technology baseline
- Frontend: React + TypeScript + Vite
- Backend: Node.js + NestJS (modular monolith, REST)
- ORM: Prisma
- Database: PostgreSQL
- Validation: class-validator/class-transformer with NestJS DTOs (use one consistent validation approach)
- Auth: JWT-based authentication; secure refresh strategy to be selected during implementation
- Authorization: role-based permissions
- API documentation: OpenAPI / Swagger
- Testing: Jest + Supertest; frontend testing selected during implementation
- Runtime/deployment: Docker on Ubuntu Linux behind HTTPS reverse proxy
- Version control: Git

## Documentation index
| Document | Location |
|---|---|
| Project charter & discovery | `01-discovery/01-project-charter.md` |
| Software requirements specification | `02-requirements/02-srs.md` |
| User stories & acceptance criteria | `02-requirements/03-user-stories.md` |
| Product backlog | `02-requirements/04-product-backlog.md` |
| Requirements traceability | `02-requirements/05-traceability-matrix.md` |
| Role & permission matrix | `02-requirements/06-permission-matrix.md` |
| System design | `03-design/06-system-design.md` |
| UML / ERD / deployment diagrams | `03-design/diagrams/` |
| Architecture decisions | `04-architecture/07-architecture-decisions.md` |
| API contract | `05-api/08-api-contract.md` |
| Data dictionary | `06-data/09-data-dictionary.md` |
| Test strategy | `07-quality/10-test-strategy.md` |
| Deployment guide | `08-deployment/11-deployment-guide.md` |
| Operations & security | `09-operations/12-operations-security.md` |
| User guide | `10-user-guides/13-user-guide.md` |

## Build sequence
Discovery → SRS → diagrams/data model → repository/environment → authentication/RBAC → catalogue → suppliers/purchases/receiving → inventory → POS/sales → reporting → warranty → tests/security hardening → deployment → operational handover.

## Implementation status
- **Module 1 (Foundation) — implemented 16 Nov 2026:** configuration, Prisma/PostgreSQL, API conventions, health check, Swagger, security baseline, error handling, pagination, money/time conventions and the test infrastructure. Decisions: ADR-008 to ADR-015 (`04-architecture/07-architecture-decisions.md`).

- **Module 2 (Authentication & Authorization) — implemented 16 Nov 2026:** users, roles, permissions, branches, branch assignments, JWT + rotating refresh tokens, logout/revocation, brute-force protection, guards and an append-only audit log. Decisions: ADR-016 to ADR-020. Backend only; the frontend is not started.

## Document control
Treat this pack as a living baseline. Record changes with date, author, reason and approval. Keep diagram sources in Git and update them whenever the design changes.

### Change log
| Date | Change | Reason | Approval |
|---|---|---|---|
| 16 Nov 2026 | Added ADR-008–015; updated API contract (conventions, health, error codes), data dictionary (physical conventions), SRS §2.8, test strategy §10.5, deployment guide env vars, traceability evidence | Module 1 implementation decisions | Project owner |
| 16 Nov 2026 | Module 2: added doc 06 permission matrix and ADR-016–020; updated ERD, class diagram, data dictionary, API contract, user stories (US-01/02, new US-09–11), SRS §2.8, test strategy §10.6, traceability, deployment guide, operations §12.7 | Module 2 implementation decisions | Project owner |
| 16 Nov 2026 | Module 2 amendments: 30-day absolute session (ADR-021), access decisions (ADR-022), MANAGER `users:read`, doc 06 §6.4 approved, initial admin procedure (ops §12.8); ERD, data dictionary, SRS, API contract, user stories updated | Owner decisions after Module 2 review | Project owner |
