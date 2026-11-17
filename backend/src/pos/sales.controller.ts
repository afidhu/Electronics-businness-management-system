import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '../access/permissions';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../common/request-context/request-context';
import {
  CheckoutDto,
  SalesQueryDto,
  SalesSummaryQueryDto,
} from './dto/sales.dto';
import { SalesService } from './sales.service';

@ApiTags('sales')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED / BRANCH_ACCESS_DENIED',
})
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  @ApiOperation({
    summary:
      'Checkout: one transaction (sale, payments, stock, units, ledger, audit). 201 new; 200 when replayed with the same idempotency key. Client prices/totals are rejected.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'TAX_NOT_CONFIGURED / INSUFFICIENT_STOCK / UNIT_NOT_AVAILABLE / IDEMPOTENCY_KEY_REUSED',
  })
  async checkout(
    @Body() dto: CheckoutDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { replayed, sale } = await this.sales.checkout(dto, user, ctx);
    res.status(replayed ? 200 : 201);
    return sale;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_READ)
  @ApiOperation({ summary: 'Sales list (branch-scoped, newest first)' })
  list(@Query() query: SalesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sales.list(query, user);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.REPORTS_SALES)
  @ApiOperation({
    summary: 'Daily sales summary for one business day (branch-scoped)',
  })
  summary(
    @Query() query: SalesSummaryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sales.summary(query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_READ)
  @ApiOperation({
    summary: 'Sale detail (costAtSale only with catalogue:cost_read)',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sales.getSale(id, user);
  }

  @Get(':id/receipt')
  @RequirePermissions(PERMISSIONS.SALES_READ)
  @ApiOperation({ summary: 'Receipt data for printing (never costs)' })
  receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sales.getReceipt(id, user);
  }
}
