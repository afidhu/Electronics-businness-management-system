import { Module } from '@nestjs/common';
import { DocumentSequenceService } from './document-sequence.service';
import {
  PurchasesController,
  SuppliersController,
} from './procurement.controllers';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';

/** Module 4 — suppliers and purchase orders (ADR-027). No receiving here. */
@Module({
  controllers: [SuppliersController, PurchasesController],
  providers: [SuppliersService, PurchasesService, DocumentSequenceService],
  exports: [PurchasesService, DocumentSequenceService],
})
export class ProcurementModule {}
