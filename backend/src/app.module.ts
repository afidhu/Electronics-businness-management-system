import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CustomersModule } from './customers/customers.module';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { PosModule } from './pos/pos.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProcurementModule } from './procurement/procurement.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuditModule,
    AccessModule,
    AuthModule,
    HealthModule,
    BranchesModule,
    UsersModule,
    CatalogueModule,
    ProcurementModule,
    InventoryModule,
    SettingsModule,
    CustomersModule,
    PosModule,
  ],
})
export class AppModule {}
