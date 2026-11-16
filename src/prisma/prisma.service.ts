import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Single PrismaClient for the application (Prisma ORM 7 + node-postgres
 * driver adapter, ADR-009). The connection string comes from validated
 * configuration (DATABASE_URL); it is never logged.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        // Pin the session timezone so SQL date functions behave identically
        // on every host; timestamps are stored in UTC (BR-10, ADR-011).
        options: '-c TimeZone=UTC',
        // Fail instead of hanging when the database is unreachable.
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Fail fast at startup if the database is unreachable.
    await this.$queryRaw`SELECT 1`;
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight readiness probe used by the health check. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
