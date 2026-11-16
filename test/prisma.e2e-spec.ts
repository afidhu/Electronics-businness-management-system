import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../src/config/app-config.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService (integration, test database only)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
    }).compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('is connected to the dedicated test database, never the development DB', async () => {
    const [row] = await prisma.$queryRaw<
      { db: string }[]
    >`SELECT current_database() AS db`;
    expect(row.db).toBe('electrocore_test_db');
    expect(row.db).not.toBe('electrocore_db');
  });

  it('pins the session timezone to UTC', async () => {
    const [row] = await prisma.$queryRaw<
      { tz: string }[]
    >`SELECT current_setting('TimeZone') AS tz`;
    expect(row.tz).toBe('UTC');
  });

  it('has the committed migrations applied to the test database', async () => {
    const rows = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null }[]
    >`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`;
    expect(rows.map((r) => r.migration_name)).toContain('20261116112022_init');
    expect(rows.every((r) => r.finished_at !== null)).toBe(true);
  });

  it('reports healthy', async () => {
    await expect(prisma.isHealthy()).resolves.toBe(true);
  });
});
