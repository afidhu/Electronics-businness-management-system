import type { CookieOptions, Request, Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';

/** Refresh-token cookie (ADR-017). */
export const REFRESH_COOKIE_NAME = 'ebms_refresh';
/** The cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function refreshCookieOptions(
  config: AppConfigService,
  expiresAt?: Date,
): CookieOptions {
  return {
    httpOnly: true, // not readable by JavaScript (XSS cannot steal it)
    secure: config.cookieSecure, // HTTPS only (required in production)
    sameSite: 'strict', // never sent on cross-site requests (CSRF)
    path: REFRESH_COOKIE_PATH,
    // Cookie lives exactly as long as its token (<= 7 days, never past the
    // 30-day absolute session end).
    maxAge: expiresAt
      ? Math.max(0, expiresAt.getTime() - Date.now())
      : config.refreshTokenTtlDays * 86_400_000,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  config: AppConfigService,
): void {
  res.cookie(
    REFRESH_COOKIE_NAME,
    token,
    refreshCookieOptions(config, expiresAt),
  );
}

export function clearRefreshCookie(
  res: Response,
  config: AppConfigService,
): void {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions(config);
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

/** Minimal cookie reader (avoids a cookie-parser dependency). */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
