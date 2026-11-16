import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { PaginatedResult, PaginationMeta } from '../pagination/pagination';
import type { RequestWithId } from '../request-context/request-id.middleware';

export interface SuccessEnvelope<T> {
  data: T;
  meta: { requestId: string; pagination?: PaginationMeta };
}

/**
 * Wraps successful JSON responses as `{ data, meta: { requestId } }`
 * (API contract §Response conventions). File downloads (e.g. CSV exports)
 * and 204 responses are passed through untouched.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithId>();
    const requestId = req?.requestId ?? 'unknown';

    return next.handle().pipe(
      map((body: unknown) => {
        if (body instanceof StreamableFile || body === undefined) return body;
        if (body instanceof PaginatedResult) {
          return {
            data: body.items,
            meta: { requestId, pagination: body.pagination },
          } satisfies SuccessEnvelope<unknown[]>;
        }
        return {
          data: body ?? null,
          meta: { requestId },
        } satisfies SuccessEnvelope<unknown>;
      }),
    );
  }
}
