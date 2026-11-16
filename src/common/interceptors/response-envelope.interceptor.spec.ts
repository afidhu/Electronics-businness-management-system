import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PaginatedResult } from '../pagination/pagination';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

const context = {
  switchToHttp: () => ({ getRequest: () => ({ requestId: 'req-envelope-1' }) }),
} as unknown as ExecutionContext;

const run = (body: unknown) =>
  lastValueFrom(
    new ResponseEnvelopeInterceptor().intercept(context, {
      handle: () => of(body),
    } as CallHandler),
  );

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps a plain body as { data, meta: { requestId } }', async () => {
    await expect(run({ id: 1 })).resolves.toEqual({
      data: { id: 1 },
      meta: { requestId: 'req-envelope-1' },
    });
  });

  it('wraps null as data: null', async () => {
    await expect(run(null)).resolves.toEqual({
      data: null,
      meta: { requestId: 'req-envelope-1' },
    });
  });

  it('moves pagination of a PaginatedResult into meta', async () => {
    const result = new PaginatedResult(['a', 'b'], 45, { page: 2, limit: 20 });
    await expect(run(result)).resolves.toEqual({
      data: ['a', 'b'],
      meta: {
        requestId: 'req-envelope-1',
        pagination: { page: 2, limit: 20, total: 45, totalPages: 3 },
      },
    });
  });

  it('passes file downloads and empty (204) responses through untouched', async () => {
    const file = new StreamableFile(Buffer.from('a,b\n'));
    await expect(run(file)).resolves.toBe(file);
    await expect(run(undefined)).resolves.toBeUndefined();
  });
});
