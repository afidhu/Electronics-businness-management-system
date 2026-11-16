import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppConfigService } from '../../config/app-config.service';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

/**
 * Defence in depth for the cookie-authenticated endpoints (refresh, logout),
 * on top of SameSite=Strict (ADR-017):
 * 1. A custom header is required. Browsers cannot send it cross-origin
 *    without a CORS preflight, which the CORS allow-list rejects.
 * 2. If an Origin header is present it must be an allowed origin.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[CSRF_HEADER];
    const origin = req.headers.origin;
    const originAllowed =
      origin === undefined || this.config.corsOrigins.includes(origin);

    if (header !== CSRF_HEADER_VALUE || !originAllowed) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.CSRF_CHECK_FAILED,
        'Request failed the CSRF check',
      );
    }
    return true;
  }
}
