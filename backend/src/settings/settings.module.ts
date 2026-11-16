import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { TaxSettingsService } from './tax-settings.service';

/** Module 6 — organisation settings (VAT rate, S1). */
@Module({
  controllers: [SettingsController],
  providers: [TaxSettingsService],
  exports: [TaxSettingsService],
})
export class SettingsModule {}
