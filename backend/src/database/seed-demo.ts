/**
 * Development-only demo catalogue (run: `npm run db:seed:demo`, D15).
 * Refuses unless NODE_ENV=development. Requires `npm run db:seed` first
 * (roles) only for logins; the catalogue itself has no dependencies.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { assertDemoSeedAllowed, seedDemoCatalogue } from './demo-catalogue';

async function main(): Promise<void> {
  assertDemoSeedAllowed(process.env.NODE_ENV);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: '-c TimeZone=UTC' }),
  });
  try {
    const r = await seedDemoCatalogue(prisma);
    console.log(
      `Demo catalogue: ${r.categoriesCreated} categories, ${r.brandsCreated} brands, ${r.productsCreated} products created (existing records left unchanged)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo seed failed');
  process.exit(1);
});
