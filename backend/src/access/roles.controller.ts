import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from './permissions';

/** Read-only view of the seeded RBAC model (roles are managed in code, ADR-016). */
@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'List roles with their permission keys' })
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { key: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      maxBranches: r.maxBranches,
      permissions: r.permissions.map((rp) => rp.permission.key).sort(),
    }));
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'List all permission keys' })
  listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, description: true },
    });
  }
}
