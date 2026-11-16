import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

const serviceWith = (healthy: boolean) =>
  new HealthService({
    isHealthy: () => Promise.resolve(healthy),
  } as unknown as PrismaService);

describe('HealthService', () => {
  it('reports ok when the database answers', async () => {
    await expect(serviceWith(true).check()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('throws 503 SERVICE_UNAVAILABLE when the database is down', async () => {
    const err = (await serviceWith(false)
      .check()
      .catch((e: unknown) => e)) as AppException;
    expect(err).toBeInstanceOf(AppException);
    expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(err.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  });
});
