import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { SettingsModule } from '../settings/settings.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/** Module 6 — POS catalogue, unit selection and pricing (6.3); checkout, sales, receipts, daily summary (6.4). */
@Module({
  imports: [SettingsModule, InventoryModule, ProcurementModule],
  controllers: [PosController, SalesController],
  providers: [PosService, SalesService],
  exports: [PosService, SalesService],
})
export class PosModule {}
