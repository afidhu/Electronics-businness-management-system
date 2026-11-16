import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthStatus {
  status: 'ok';
  checks: { database: 'up' };
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Readiness: the API is running AND PostgreSQL answers a query.
   * Throws 503 SERVICE_UNAVAILABLE otherwise (used by Docker/proxy health checks).
   * Reveals no versions, hostnames or connection details.
   */
  async check(): Promise<HealthStatus> {
    if (!(await this.prisma.isHealthy())) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Database unavailable',
      );
    }
    return {
      status: 'ok',
      checks: { database: 'up' },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
