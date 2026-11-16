import { Module } from '@nestjs/common';
import { ProcurementModule } from '../procurement/procurement.module';
import {
  GoodsReceiptsController,
  InventoryController,
  ReceivingController,
} from './inventory.controllers';
import { InventoryQueryService } from './inventory-query.service';
import { ReceivingService } from './receiving.service';
import { StockLedgerService } from './stock-ledger.service';

/**
 * Module 5, stage 5.1 — receiving, ledger, balances, units, valuation.
 * Stage 5.2 (adjustments, transfers, close short) is deferred (proposal §0).
 */
@Module({
  imports: [ProcurementModule],
  controllers: [
    ReceivingController,
    GoodsReceiptsController,
    InventoryController,
  ],
  providers: [ReceivingService, InventoryQueryService, StockLedgerService],
  exports: [StockLedgerService, InventoryQueryService],
})
export class InventoryModule {}
