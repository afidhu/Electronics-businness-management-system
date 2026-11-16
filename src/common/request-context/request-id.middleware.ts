import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept a caller-supplied ID only if it is short and harmless to log. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Request with the correlation ID attached by `requestIdMiddleware`. */
export type RequestWithId = Request & { requestId?: string };

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
}

/**
 * Assigns a correlation ID to every request (NFR-OBS-01): reuses a safe
 * incoming `X-Request-Id` (e.g. from the reverse proxy) or generates a UUID,
 * and echoes it back in the response header.
 */
export function requestIdMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const id = resolveRequestId(req.headers['x-request-id']);
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

const accessLogger = new Logger('HTTP');

/**
 * Access log: method, path (no query string), status, duration, request ID.
 * Bodies, query strings and headers are never logged (NFR-SEC-04).
 */
export function accessLogMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const path = (req.originalUrl ?? req.url).split('?')[0];
    accessLogger.log(
      `${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms requestId=${req.requestId}`,
    );
  });
  next();
}
