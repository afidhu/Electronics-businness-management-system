# 11. Deployment Guide (Ubuntu + Docker)

**Status:** Reference deployment plan. Exact commands and versions must be verified against the chosen release and server.

## 11.1 Target topology
- Ubuntu LTS host.
- Docker Engine and Compose plugin.
- HTTPS reverse proxy (Nginx or Caddy).
- Frontend static build container or static files served by proxy.
- NestJS API container.
- PostgreSQL container with persistent volume (or managed PostgreSQL).
- Off-host encrypted database backups.
- Firewall exposing only SSH (restricted), HTTP and HTTPS.

See `../03-design/diagrams/06-deployment.mmd`.

## 11.2 Prerequisites
- Domain name and DNS A/AAAA records.
- Clean, patched Ubuntu server.
- Non-root deployment account with controlled sudo.
- SSH key authentication.
- Docker Engine and Compose plugin from official Docker installation instructions.
- Firewall policy and TLS certificate process.
- Production `.env` values stored securely, not in Git.

## 11.3 Environment configuration
Create production secrets outside source control:
- `DATABASE_URL`
- `JWT_ACCESS_SECRET` (≥ 32 chars, unique per environment), `JWT_ACCESS_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_DAYS` (7)
- `COOKIE_SECURE=true` (mandatory in production) and `TRUST_PROXY=1` behind the reverse proxy
- `LOGIN_RATE_LIMIT`, `LOGIN_RATE_WINDOW_SECONDS`, `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD` for the first deployment only
- `CORS_ORIGINS`: allowed frontend origin(s), comma-separated
- `NODE_ENV=production` and `PORT`
- `LOG_LEVEL` (`error` | `warn` | `log` | `debug` | `verbose`)
- `BUSINESS_TIMEZONE` (default `Africa/Dar_es_Salaam`), `CURRENCY` (default `TZS`) and `BUSINESS_NAME` (receipt trading name, default `ElectroCore Electronics`)
- `SWAGGER_ENABLED` (default `false` in production)
- any email/SMS credentials if later added

The API checks all of these at startup and refuses to start if any is missing or invalid (ADR-010). `SHADOW_DATABASE_URL` is for development only and is not needed in production. See `backend/.env.example` for the full list.

Never copy development secrets to production. Use strong unique secrets and rotate them if exposed.

## 11.4 Container requirements
- Build frontend and backend images from reviewed Dockerfiles.
- Run API as a non-root user.
- Pin image versions; avoid `latest` in production.
- Keep database data in a named persistent volume.
- Do not publish PostgreSQL port publicly.
- Add health checks and restart policy. Use `GET /api/v1/health` (200 when the API and database are up, 503 otherwise).
- Use a Node.js 24 LTS base image (ADR-008).
- Use internal Docker network for API-to-database traffic.
- Run Prisma migrations as a controlled release step (`prisma migrate deploy`), not on every API replica startup without coordination.

## 11.5 Release procedure
1. Confirm tests, code review and migration review passed.
2. Back up current database and verify backup artifact.
3. Pull/build immutable release images.
4. Deploy updated services.
5. Run database migrations as a controlled step, then `npm run db:seed`. It is idempotent: it syncs roles and permissions, and creates the first administrator only if absent. Remove `SEED_ADMIN_PASSWORD` afterwards.
6. Check container health and application readiness.
7. Verify login, product lookup, inventory and a test checkout in a non-production/test tenant or approved test data.
8. Inspect logs and error rates.
9. Keep rollback image and database recovery plan available.
10. Record release version, migration version and operator.

## 11.6 Reverse proxy and TLS
- Terminate TLS at Nginx/Caddy.
- Redirect HTTP to HTTPS.
- Proxy `/api` to the NestJS service. Serve the SPA from the same origin so the refresh cookie (`Path=/api/v1/auth`, `SameSite=Strict`, `Secure`) works without cross-site CORS.
- Serve frontend static assets.
- Configure request size/timeouts and security headers appropriately.
- Do not expose internal service ports.

## 11.7 Database backup
- Schedule encrypted backups to off-host storage.
- Define retention and access policy.
- Perform regular restore drills.
- Define RPO (maximum acceptable data loss) and RTO (target recovery time) with stakeholders.
- A backup is not considered verified until restoration succeeds.

## 11.8 Rollback
- Roll back application image if health checks fail.
- Do not assume a database migration is reversible. Use backward-compatible migrations where possible and prepare a tested restore/forward-fix plan.
- Record incident and preserve logs.

## Frontend build: public URL for social previews (added 17 Nov 2026)
- Build the frontend with the confirmed public origin:
  ```bash
  VITE_SITE_URL=https://<confirmed-domain> npm run build
  ```
  This makes the canonical URL, `og:url`, `og:image` and `twitter:image` absolute, as WhatsApp, Facebook, LinkedIn, Telegram and X require. The value must be `https://`.
- Caddy must serve `/`, `/og-thumbnail.png`, `/favicon.svg`, `/apple-touch-icon.png` and `/robots.txt` publicly, with no sign-in, redirect or IP restriction. The API stays under `/api`.
- Set the backend `CORS_ORIGINS` to the same origin. The CSRF guard refuses session refresh and logout from any other origin.
- After deploying, refresh the preview caches:
  - **Facebook / WhatsApp:** Sharing Debugger → "Scrape Again";
  - **LinkedIn:** Post Inspector.

## Backend on Vercel / AWS Lambda: `NODE_OPTIONS` (added 17 Nov 2026)

The backend compiles to CommonJS (`module: nodenext`, no `"type": "module"`),
while NestJS 12 packages are ESM-only. CommonJS loads them through Node's
`require(esm)`, which AWS Lambda (and therefore Vercel Functions) disables by
default on its Node 20/22/24 runtimes. The symptom is:

    Error [ERR_REQUIRE_ESM]: require() of ES Module .../@nestjs/common/index.js

Set this environment variable on the backend project (all environments), then
redeploy. This is the remedy given in the NestJS 11→12 migration guide:

    NODE_OPTIONS=--experimental-require-module

If `NODE_OPTIONS` already has flags, append this one. No code change is needed,
and a container/VM deployment (11.1) on Node ≥ 24.9 does not need it.
