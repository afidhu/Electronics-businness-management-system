import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { AppException, FieldErrorDetail } from '../errors/app.exception';
import { ErrorCode, errorCodeForStatus } from '../errors/error-codes';
import type { RequestWithId } from '../request-context/request-id.middleware';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  details?: FieldErrorDetail[];
}

const GENERIC_SERVER_MESSAGE = 'An unexpected error occurred';

/**
 * Converts every thrown error into the documented error shape
 * `{ statusCode, code, message, requestId, details? }` (API contract, ADR-013).
 * Stack traces, SQL and database internals are logged server-side only and
 * never sent to clients (system design §6.9).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();
    const requestId = req?.requestId ?? 'unknown';

    const body = this.toErrorBody(exception, requestId);

    if (body.statusCode >= 500) {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`requestId=${requestId} ${body.code}`, stack);
    }

    res.status(body.statusCode).json(body);
  }

  toErrorBody(exception: unknown, requestId: string): ErrorBody {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: errorCodeForStatus(statusCode),
        message:
          statusCode >= 500
            ? GENERIC_SERVER_MESSAGE
            : this.httpMessage(exception),
        requestId,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrismaError(exception);
      if (mapped) return { ...mapped, requestId };
    }

    // Express body-parser errors (malformed JSON, oversized body).
    const parserError = this.fromBodyParserError(exception);
    if (parserError) return { ...parserError, requestId };

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: GENERIC_SERVER_MESSAGE,
      requestId,
    };
  }

  private httpMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
    return exception.message;
  }

  private fromPrismaError(
    e: Prisma.PrismaClientKnownRequestError,
  ): Omit<ErrorBody, 'requestId'> | undefined {
    switch (e.code) {
      case 'P2002': // unique constraint
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.DUPLICATE_VALUE,
          message: 'A record with the same unique value already exists',
        };
      case 'P2003': // foreign key constraint
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.REFERENCE_CONFLICT,
          message: 'The operation conflicts with a related record',
        };
      case 'P2025': // record required but not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found',
        };
      default:
        return undefined; // treated as an unexpected 500
    }
  }

  private fromBodyParserError(
    e: unknown,
  ): Omit<ErrorBody, 'requestId'> | undefined {
    if (typeof e !== 'object' || e === null) return undefined;
    const type = (e as { type?: unknown }).type;
    if (type === 'entity.parse.failed') {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'Malformed JSON request body',
      };
    }
    if (type === 'entity.too.large') {
      return {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: ErrorCode.PAYLOAD_TOO_LARGE,
        message: 'Request body is too large',
      };
    }
    return undefined;
  }
}
