import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '../access/permissions';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  PosCatalogueQueryDto,
  PosUnitsQueryDto,
  QuoteDto,
} from './dto/pos.dto';
import { PosService } from './pos.service';

/** POS endpoints for sellers (sales:create: CASHIER, SYSTEM_ADMIN — S19). */
@ApiTags('pos')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED / BRANCH_ACCESS_DENIED',
})
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('catalogue')
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  @ApiOperation({
    summary:
      'Search active products (name, SKU, brand) with available stock at the selling branch',
  })
  catalogue(
    @Query() query: PosCatalogueQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.catalogue(query, user);
  }

  @Get('units')
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  @ApiOperation({
    summary:
      'Available units of a serialized product at the branch, or resolve a scanned IMEI/serial',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'UNIT_NOT_AVAILABLE',
  })
  units(
    @Query() query: PosUnitsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.units(query, user);
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  @ApiOperation({
    summary:
      'Server-priced cart preview (no side effects). Client prices/totals are rejected.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'TAX_NOT_CONFIGURED / INSUFFICIENT_STOCK / UNIT_NOT_AVAILABLE',
  })
  quote(@Body() dto: QuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.quote(dto, user);
  }
}
