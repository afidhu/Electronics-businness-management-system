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
  BalanceQueryDto,
  MovementQueryDto,
  ReceiptQueryDto,
  UnitLookupDto,
  UnitQueryDto,
  ValuationQueryDto,
} from './dto/inventory-query.dto';
import { ReceiveGoodsDto } from './dto/receive.dto';
import { InventoryQueryService } from './inventory-query.service';
import { ReceivingService } from './receiving.service';

/** POST /purchases/:id/receive lives with inventory (Module 5), not procurement. */
@ApiTags('inventory: receiving')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description:
    'PERMISSION_DENIED / BRANCH_ACCESS_DENIED / SELF_RECEIVING_FORBIDDEN',
})
@ApiConflictResponse({
  type: ErrorResponseDto,
  description:
    'OVER_RECEIVING / DUPLICATE_IDENTIFIER / IDEMPOTENCY_KEY_REUSED / INVALID_STATUS_TRANSITION',
})
@Controller('purchases')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Post(':id/receive')
  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @ApiOperation({
    summary:
      'Receive goods (partial or complete). 201 on first receipt; 200 when replayed with the same idempotency key. Creator/submitter/approver of the PO cannot receive (BR-14).',
  })
  async receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveGoodsDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { replayed, receipt } = await this.receiving.receive(
      id,
      dto,
      user,
      ctx,
    );
    res.status(replayed ? 200 : 201);
    return receipt;
  }
}

@ApiTags('inventory: receiving')
@ApiBearerAuth()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly queries: InventoryQueryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  list(
    @Query() query: ReceiptQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.listReceipts(query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.getReceipt(id, user);
  }
}

@ApiTags('inventory: stock')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED / BRANCH_ACCESS_DENIED',
})
@Controller('inventory')
export class InventoryController {
  constructor(private readonly queries: InventoryQueryService) {}

  @Get('balances')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Stock balances (on hand, reserved, available; lowStock filter)',
  })
  balances(
    @Query() query: BalanceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.balances(query, user);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Append-only stock ledger (costs only with catalogue:cost_read)',
  })
  movements(
    @Query() query: MovementQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.movements(query, user);
  }

  @Get('units')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  units(@Query() query: UnitQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.queries.units(query, user);
  }

  @Get('units/lookup')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary:
      'Find a unit by IMEI/serial; outside your branches only "exists" is disclosed (I15)',
  })
  lookup(
    @Query() query: UnitLookupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.lookup(query.identifier, user);
  }

  @Get('units/:id')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  unit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.unit(id, user);
  }

  @Get('valuation')
  @RequirePermissions(
    PERMISSIONS.REPORTS_INVENTORY,
    PERMISSIONS.CATALOGUE_COST_READ,
  )
  @ApiOperation({
    summary:
      'Moving weighted-average valuation per branch/product (in-transit separate)',
  })
  valuation(
    @Query() query: ValuationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queries.valuation(query, user);
  }
}
