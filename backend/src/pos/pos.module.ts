import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** Module 6 — POS catalogue, unit selection and pricing (stage 6.3). */
@Module({
  imports: [SettingsModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
