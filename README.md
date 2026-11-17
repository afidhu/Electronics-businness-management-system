# ElectroCore EBMS
### Electronics Business Management System

**ElectroCore EBMS** is an independent business management system designed to help electronics shops manage, monitor and streamline their daily operations through one centralized platform.

The system aims to simplify electronics retail management by bringing together inventory management, procurement, point of sale (POS), sales tracking, payment recording, financial reporting and user access control.

Whether managing a single electronics shop or multiple branches, ElectroCore EBMS is being developed to provide better visibility, accountability and control over business operations.

---

## 🎯 Project Objectives

ElectroCore EBMS aims to help electronics retailers:

- Manage electronic products, brands and categories.
- Track inventory and individual devices using IMEI and serial numbers.
- Manage suppliers and purchase orders.
- Control purchasing and approval workflows.
- Record sales and customer payments.
- Support cash, card, mobile money and bank transfer payments.
- Generate sales receipts.
- Monitor stock movements and inventory balances.
- Track business performance through dashboards and reports.
- Manage employees through role-based access control.
- Maintain transaction histories and audit records.
- Support multiple branches from a centralized system.

---

## 🏗️ System Architecture & Technology Stack

| Component | Technology |
|---|---|
| Backend | NestJS 12 |
| Programming Language | TypeScript |
| Frontend | React + TypeScript |
| Frontend Build Tool | Vite |
| Database | PostgreSQL |
| ORM | Prisma 7 |
| API Architecture | REST API |
| Authentication | JWT + Rotating Refresh Tokens |
| Authorization | Role-Based Access Control (RBAC) |
| Testing | Jest + Supertest + Browser E2E |
| Runtime | Node.js 24 |
| API Documentation | Swagger / OpenAPI |

### Repository Structure

```text
.
├── backend/       NestJS REST API
├── frontend/      React + TypeScript application
├── docs/          Requirements, architecture and technical documentation
├── .nvmrc         Node.js version configuration
└── .gitignore     Excludes secrets, dependencies and generated files
```

---

## 👥 System User Roles

The system uses role-based access control to separate responsibilities and protect business information.

| Role | Main Responsibilities |
|---|---|
| System Administrator | System configuration, user management, permissions and branch administration |
| Manager | Business oversight, purchase approvals, sales monitoring and reports |
| Procurement Officer | Supplier management and purchase order preparation |
| Inventory Officer | Goods receiving, stock management and IMEI/serial registration |
| Cashier | POS operations, sales processing, payments and receipts |
| Auditor | Reviewing transactions, stock movements and audit records |
| Technician | Technical operations; repair and warranty workflows are planned for future development |

Access to system functions is controlled by permissions and branch-level restrictions.

---

## 📦 Core Business Modules

| Module | Functionality | Status |
|---|---|---|
| 1. System Foundation | Configuration, database, API conventions and health checks | Completed |
| 2. Authentication & Authorization | Login, sessions, roles, permissions, branches and audit logs | Completed |
| 3. Product Catalogue | Categories, brands, products and pricing permissions | Completed |
| 4. Procurement | Suppliers, purchase orders and approval workflows | Completed |
| 5. Inventory | Goods receiving, IMEI/serial tracking, stock ledger and balances | Stage 5.1 completed; Stage 5.2 deferred |
| 6. POS & Sales | Product selection, price calculation, checkout, payments, receipts and sales reporting | MVP implemented; pending final review and merge |

**Development note:** The current MVP focuses on the essential procurement, inventory receiving and sales workflows. Additional functionality will be introduced incrementally.

---

## 🔄 Example Business Workflow

### Electronics Stock Receiving and Sales

Consider an electronics shop purchasing five Samsung smartphones.

1. The Procurement Officer creates a purchase order for five smartphones.
2. The Manager reviews and approves the purchase order.
3. The Inventory Officer receives the smartphones.
4. Each smartphone's IMEI or serial number is recorded.
5. The system updates the available stock.
6. A customer visits the shop and selects a smartphone.
7. The Cashier searches for the product and selects an available device.
8. The system calculates the selling price and applicable VAT.
9. The Cashier records the customer's payment.
10. The system completes the sale, updates stock and generates a receipt.
11. The Manager reviews sales performance.
12. The Auditor can inspect the transaction and its audit history.

This workflow provides traceability from purchasing and receiving through to the final sale.

---

## 🔐 Security & Data Integrity

Security and transaction consistency are important design considerations.

The system incorporates:

- Password hashing using Argon2id.
- JWT-based authentication.
- Rotating refresh tokens using secure HTTP-only cookies.
- Role-based and branch-level access restrictions.
- Backend validation of incoming requests.
- Audit logging for important business activities.
- Server-side price and VAT calculations.
- Transactional sales and inventory updates.
- Idempotency protection against duplicate checkout requests.
- Protection against selling the same serialized device twice.
- Separation of confidential cost information from unauthorized users.

Secrets and environment-specific configuration are excluded from version control.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 24
- npm
- PostgreSQL
- Git

### 1. Clone the repository

```bash
git clone YOUR_REPOSITORY_URL
cd EBMS
```

### 2. Select the Node.js version

```bash
nvm use
```

### 3. Configure the backend

```bash
cd backend
npm ci
cp .env.example .env
```

Configure your database connection and required environment variables in `.env`.

Never commit `.env` or `.env.test`.

### 4. Run database migrations

```bash
npm run prisma:migrate
```

### 5. Seed initial system data

```bash
npm run db:seed
```

This initializes the required roles, permissions and initial administrator account.

### 6. Start the backend

```bash
npm run start:dev
```

Backend API:

```text
http://localhost:3000/api/v1
```

Swagger documentation:

```text
http://localhost:3000/api/docs
```

For complete setup instructions, see:

- `backend/README.md`
- `frontend/README.md`
- `docs/README.md`

---

## 🧪 Quality Assurance

The project uses automated testing to verify application functionality and business rules.

Current recorded test results:

| Test Area | Result |
|---|---:|
| Frontend unit and render tests | 36/36 passed |
| Frontend type checking | Passed |
| Frontend linting | Passed |
| Frontend production build | Passed |
| Browser end-to-end tests | 53/53 passed |
| Backend unit tests | 249/249 passed |
| Backend E2E tests | 459/459 passed |

Browser E2E tests have also verified the complete sales workflow, including checkout retries and duplicate submission protection.

These are the latest recorded development test results, not a guarantee of production readiness.

---

## 🗺️ Future Development

Planned improvements include:

- Inventory adjustments and stock transfers.
- Physical stocktaking.
- Customer management integrated into POS.
- Warranty and repair management.
- Returns and refunds.
- Enhanced financial and profitability reports.
- More advanced multi-branch operations.
- Additional business analytics.
- Production deployment and operational monitoring.

---

## 📌 Project Status

ElectroCore EBMS is an independently developed software project.

The current MVP includes the core foundation, authentication, catalogue, procurement, inventory receiving and POS sales workflows.

Development is progressing incrementally, with an emphasis on security, maintainability, business rules and reliable transaction processing.

**Project:** ElectroCore Electronics Business Management System  
**Developer:** Afidhu Nurudini  
**Purpose:** Helping electronics retailers manage their business operations through an integrated software platform.