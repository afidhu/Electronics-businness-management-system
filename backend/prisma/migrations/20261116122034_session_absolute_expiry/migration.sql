-- ADR-021: absolute session lifetime (30 days by default).
-- Every refresh token carries the absolute end of its login session; rotation
-- copies it, so a session can never be extended beyond it.

-- 1. Add as nullable so existing rows can be backfilled safely.
ALTER TABLE "refresh_tokens" ADD COLUMN "session_expires_at" TIMESTAMPTZ(3);

-- 2. Backfill existing sessions: 30 days after the token was created
--    (never earlier than the token's own expiry).
UPDATE "refresh_tokens"
SET "session_expires_at" = GREATEST("created_at" + INTERVAL '30 days', "expires_at")
WHERE "session_expires_at" IS NULL;

-- 3. Enforce.
ALTER TABLE "refresh_tokens" ALTER COLUMN "session_expires_at" SET NOT NULL;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_within_session_chk"
  CHECK ("expires_at" <= "session_expires_at");
