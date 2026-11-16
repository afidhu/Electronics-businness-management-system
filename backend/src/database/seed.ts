/**
 * Database seed (run: `npm run db:seed`).
 * 1. Synchronises permissions and system roles with src/access/permissions.ts.
 * 2. Creates the initial SYSTEM_ADMIN from SEED_ADMIN_* variables if no user
 *    with that email exists. The password is never logged.
 * Safe to run repeatedly.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedRbac } from '../access/rbac.seed';
import { normaliseEmail } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { PrismaClient } from '../generated/prisma/client';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: '-c TimeZone=UTC' }),
  });

  try {
    await seedRbac(prisma);
    console.log('RBAC: permissions and system roles synchronised');

    const email = process.env.SEED_ADMIN_EMAIL?.trim();
    const password = process.env.SEED_ADMIN_PASSWORD ?? '';
    if (!email || !password) {
      console.log(
        'Admin: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set — skipped',
      );
      return;
    }
    const normalised = normaliseEmail(email);
    if (await prisma.user.findUnique({ where: { email: normalised } })) {
      console.log(
        'Admin: a user with SEED_ADMIN_EMAIL already exists — unchanged',
      );
      return;
    }
    const passwords = new PasswordService();
    passwords.assertAcceptable(password, { email: normalised });
    const role = await prisma.role.findUniqueOrThrow({
      where: { key: 'SYSTEM_ADMIN' },
    });
    const user = await prisma.user.create({
      data: {
        email: normalised,
        fullName: process.env.SEED_ADMIN_NAME?.trim() || 'System Administrator',
        passwordHash: await passwords.hash(password),
        roleId: role.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'user.created',
        entityType: 'User',
        entityId: user.id,
        metadata: {
          email: user.email,
          roleKey: 'SYSTEM_ADMIN',
          source: 'seed',
        },
      },
    });
    console.log(
      'Admin: initial SYSTEM_ADMIN created. Remove SEED_ADMIN_PASSWORD from .env now.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Seed failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exit(1);
});
