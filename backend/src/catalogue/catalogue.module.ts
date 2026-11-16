import { Module } from '@nestjs/common';
import {
  BrandsController,
  CategoriesController,
} from './classification.controllers';
import { ClassificationService } from './classification.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/** Module 3 — organisation-wide product catalogue (ADR-025). */
@Module({
  controllers: [CategoriesController, BrandsController, ProductsController],
  providers: [ClassificationService, ProductsService],
  exports: [ProductsService],
})
export class CatalogueModule {}
