# ElectroCore EBMS — Electronics Business Management System

Independent prototype for practical software-engineering demonstration and interview preparation. It is **not** an officially commissioned Raddy Electronics system.

## Repository layout
```
.
├── backend/    NestJS 12 + Prisma 7 + PostgreSQL REST API (/api/v1)
├── frontend/   React + TypeScript + Vite SPA (scaffold; not started yet)
├── docs/       Requirements, design, ADRs, API contract, data dictionary, ops
├── .nvmrc      Node.js 24 LTS (run `nvm use`)
└── .gitignore  Secrets, dependencies, build output and generated code are excluded
```

## Status
| Module | State |
|---|---|
| 1. Foundation (config, Prisma, API conventions, health, Swagger) | Done |
| 2. Authentication & authorization (RBAC, branches, JWT + rotating refresh, audit) | Done |
| 3. Product catalogue (categories, brands, products, price permissions) | Done |
| 4. Procurement (suppliers, purchase orders, separation of duties) | Done |
| 5. Inventory stage 5.1 (receiving, serialized units, ledger, balances, valuation) | Done (awaiting review) |
| 5. Inventory stage 5.2 (close short, adjustments, opening stock, transfers) | Deferred: design approved |
| 6. POS / sales | Next (proposal required) |

Progress and decisions: `docs/README.md` (change log) and `docs/04-architecture/07-architecture-decisions.md` (ADRs).

## Getting started
```bash
nvm use                      # Node.js 24
cd backend
npm ci
cp .env.example .env         # fill in real values; never commit .env / .env.test
npm run prisma:migrate
npm run db:seed              # roles/permissions + initial administrator
npm run start:dev            # http://localhost:3000/api/v1, Swagger at /api/docs
```
Full backend instructions: `backend/README.md`. First administrator login: `docs/09-operations/12-operations-security.md` §12.8.

## Quality checks (backend)
```bash
npm run lint && npx tsc --noEmit -p tsconfig.json && npm run build
npm test            # unit
npm run test:e2e    # API + PostgreSQL (uses *_test_db only)
```

## Security
Secrets live only in git-ignored `.env` files. Never commit credentials, tokens or generated output. Report suspected exposure immediately and rotate the affected secret (`docs/09-operations/12-operations-security.md`).
