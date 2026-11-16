import type { PrismaClient } from '../generated/prisma/client';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_DEFINITIONS,
} from './permissions';

/**
 * Idempotently synchronise permissions, system roles and their grants with
 * `permissions.ts`. Safe to run repeatedly (deploys, tests). Users are not touched.
 */
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const key of ALL_PERMISSIONS) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description: PERMISSION_DESCRIPTIONS[key] },
        update: { description: PERMISSION_DESCRIPTIONS[key] },
      });
    }
    // Permissions removed from the catalogue lose all grants (cascade).
    await tx.permission.deleteMany({
      where: { key: { notIn: ALL_PERMISSIONS } },
    });

    const permissionIds = new Map(
      (await tx.permission.findMany()).map((p) => [p.key, p.id]),
    );

    for (const def of ROLE_DEFINITIONS) {
      const role = await tx.role.upsert({
        where: { key: def.key },
        create: {
          key: def.key,
          name: def.name,
          description: def.description,
          maxBranches: def.maxBranches,
          isSystem: true,
        },
        update: {
          name: def.name,
          description: def.description,
          maxBranches: def.maxBranches,
          isSystem: true,
        },
      });

      const wanted = def.permissions.map((k) => permissionIds.get(k)!);
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  });
}
