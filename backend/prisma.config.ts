// Prisma CLI configuration (Prisma ORM 7).
// Prisma 7 does not load .env automatically, so dotenv is imported explicitly.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Dedicated shadow DB for `prisma migrate dev` only: the local server's
    // template1 is not clean, so auto-created shadow DBs would inherit stray
    // tables (see ADR-009). Optional so `migrate deploy` works without it.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
