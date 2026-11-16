import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, FieldErrorDetail } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/** Flatten nested class-validator errors into `field.path` + messages. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): FieldErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own: FieldErrorDetail[] = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/**
 * Global input validation (NFR-SEC-03): strips nothing silently — unknown
 * properties are rejected — and converts payloads to DTO class instances.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    exceptionFactory: (errors) =>
      new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        flattenValidationErrors(errors),
      ),
  });
}
