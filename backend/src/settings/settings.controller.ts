import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '../access/permissions';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AuthenticatedOnly,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../common/request-context/request-context';
import { SetTaxRateDto } from './dto/tax-setting.dto';
import { TaxSettingsService } from './tax-settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly tax: TaxSettingsService) {}

  @Get('tax')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Active VAT rate ({ configured: false } until an admin sets it)',
  })
  getTax() {
    return this.tax.current();
  }

  @Put('tax')
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({
    summary:
      'Set the organisation VAT rate (SYSTEM_ADMIN; 0 allowed; audited; history kept)',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'PERMISSION_DENIED',
  })
  setTax(
    @Body() dto: SetTaxRateDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.tax.setRate(dto.ratePercent, user, ctx);
  }
}
