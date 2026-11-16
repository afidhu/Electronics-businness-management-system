# 12. Operations, Security & Maintenance

## 12.1 Daily operations
- Review application health and error logs.
- Check database storage, connection usage and backup status.
- Review failed logins and suspicious access patterns.
- Monitor disk space and container restarts.
- Review pending purchase receiving, stock exceptions and failed jobs.

## 12.2 Monitoring
Recommended signals:
- API availability and latency.
- HTTP 4xx/5xx rates.
- Database connections and slow queries.
- CPU, memory and disk.
- Container health/restarts.
- Backup completion and restore test age.
- Failed login rate and authorization denials.

Use request IDs to correlate UI/API/proxy logs. Do not log passwords, tokens, full payment credentials or unnecessary customer data.

## 12.3 Security checklist
- HTTPS enforced.
- SSH key-based access; disable password SSH where operationally appropriate.
- Firewall exposes only required ports.
- OS and containers patched.
- Secrets kept out of Git and rotated.
- Passwords hashed using Argon2id or bcrypt.
- Access tokens short-lived; refresh strategy rotated/revocable.
- RBAC and branch scope enforced on server.
- Input validation and output encoding applied.
- Rate limiting on login and sensitive routes.
- Database user has minimum required privileges.
- PostgreSQL not exposed publicly.
- Audit log protected from normal user alteration (DB trigger blocks UPDATE/DELETE; ADR-020).
- Dependency and container image scanning performed.
- Backups encrypted and access restricted.

## 12.4 Incident response
1. Detect and record incident with timestamp and request IDs.
2. Assess scope and protect customer/business data.
3. Contain affected account/service; rotate credentials if needed.
4. Preserve relevant logs and evidence.
5. Restore service from known-good state or apply tested fix.
6. Validate data integrity and business workflows.
7. Communicate according to organisation policy.
8. Document root cause, impact and preventive actions.

## 12.5 Recovery concepts
- RPO: maximum acceptable data loss measured in time.
- RTO: target time to restore service.
- Set both with business stakeholders; do not invent production commitments.
- Test restore process periodically in an isolated environment.

## 12.6 Maintenance
- Review dependency updates.
- Review slow queries and indexes.
- Reconcile stock ledger with balances.
- Audit role assignments.
- Test backups and restore.
- Review retention and privacy policy.

## 12.7 Authentication security notes (Module 2; ADR-017/018)
**Cookies.** The refresh token is the only cookie: `ebms_refresh`, with `HttpOnly` (JavaScript cannot read it), `SameSite=Strict`, `Path=/api/v1/auth` (sent only to auth endpoints), `Secure` (the app refuses to start in production without `COOKIE_SECURE=true`) and `Max-Age` 7 days. Only its SHA-256 hash is stored, so a database leak does not expose usable tokens. Access tokens are never put in cookies or localStorage; the SPA keeps them in memory.

**CORS.** Only origins listed in `CORS_ORIGINS` are allowed, with credentials. Never use `*`. In production, serve the SPA and `/api` from the **same origin** through the reverse proxy; then CORS is not needed at all for the app itself.

**CSRF.** Bearer-token endpoints are not exposed to CSRF, because browsers don't add the header automatically. The two cookie endpoints (`/auth/refresh`, `/auth/logout`) require `SameSite=Strict`, the `X-Requested-With: XMLHttpRequest` header (which forces a CORS preflight for cross-site callers) and an allowed `Origin`. Do not add new cookie-authenticated endpoints without the same `CsrfGuard`.

**XSS.** Keeping the access token in memory limits what injected script can steal to a token that expires in 15 minutes. The refresh cookie is unreachable from script. Content-Security-Policy headers (helmet) remain on.

**Proxy.** Behind Nginx/Caddy, set `TRUST_PROXY=1`, so login rate limiting and audit IPs use the client address rather than the proxy's.

**Secrets.** `JWT_ACCESS_SECRET` must be unique per environment and at least 32 characters (`openssl rand -base64 48`). Rotating it immediately invalidates all access tokens; refresh tokens keep working, so users get new access tokens silently.

**Operations.**
- Review `auth.login.failed`, `auth.account.locked` and `auth.refresh.reuse_detected` audit events daily (§12.1).
- To unlock a user, an administrator resets their password.
- Revoked and expired refresh tokens accumulate in `refresh_tokens`. A periodic clean-up job (delete rows expired more than 30 days ago) is a planned maintenance task.
- Create the first administrator with `npm run db:seed`, using `SEED_ADMIN_*`, then remove `SEED_ADMIN_PASSWORD` from the environment.

## 12.8 Initial administrator and first login
- The first administrator (`admin@gmail.com`, SYSTEM_ADMIN) is created by `npm run db:seed` from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in the git-ignored `backend/.env` (file mode 600). Seeding never prints the password and does nothing if the account already exists.
- **Retrieve the temporary password** on the server, in your own terminal (not in shared chat or tickets): `grep '^SEED_ADMIN_PASSWORD' backend/.env`.
- **First login:** sign in, then immediately call `POST /api/v1/auth/change-password` with the temporary password as `currentPassword` and a new passphrase (≥ 12 characters; ideally from a password manager). This revokes all sessions; sign in again with the new password.
- **Then remove the temporary password** from `.env` (delete the value of `SEED_ADMIN_PASSWORD`). It is only read by the seed command.
- **Lost or compromised password:** another SYSTEM_ADMIN can reset it (`POST /users/:id/password`). If no other admin exists, set a new strong `SEED_ADMIN_PASSWORD`, set the admin's password hash with a one-off script (or recreate the account under a new email with `db:seed`), and record the incident (§12.4).
- Never use weak defaults such as `admin123`. The policy rejects passwords under 12 characters or containing the email name.
