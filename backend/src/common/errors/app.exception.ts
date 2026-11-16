import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** One field-level validation problem. */
export interface FieldErrorDetail {
  field: string;
  messages: string[];
}

/**
 * Application exception carrying a stable error code. Throw this from
 * services for business-rule failures, e.g.
 * `throw new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'Purchase already received')`.
 * `message` is shown to clients: never put secrets or internals in it.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode | string,
    message: string,
    readonly details?: FieldErrorDetail[],
  ) {
    super(message, status);
  }
}
