import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { BranchScoped } from '../access/branch-scope.guard';
import { PERMISSIONS } from '../access/permissions';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/decorators';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../common/request-context/request-context';
import {
  ApprovePurchaseDto,
  CreatePurchaseDto,
  PurchaseQueryDto,
  ReasonDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';

@ApiTags('procurement: suppliers')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED',
})
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROCUREMENT_READ)
  @ApiOperation({ summary: 'List suppliers (organisation-wide)' })
  list(@Query() query: SupplierQueryDto) {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROCUREMENT_WRITE)
  @ApiOperation({
    summary: 'Create a supplier (name case-insensitive unique; TIN unique)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE',
  })
  create(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.suppliers.create(dto, user, ctx);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_WRITE)
  @ApiOperation({ summary: 'Update or (de)activate a supplier' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE / SUPPLIER_IN_USE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.suppliers.update(id, dto, user, ctx);
  }
}

@ApiTags('procurement: purchase orders')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description:
    'PERMISSION_DENIED / BRANCH_ACCESS_DENIED / SELF_APPROVAL_FORBIDDEN',
})
@ApiConflictResponse({
  type: ErrorResponseDto,
  description: 'INVALID_STATUS_TRANSITION / PURCHASE_NOT_EDITABLE',
})
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROCUREMENT_READ)
  @ApiOperation({ summary: 'List purchase orders within your branch scope' })
  list(
    @Query() query: PurchaseQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.purchases.list(query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_READ)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.purchases.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROCUREMENT_WRITE)
  @BranchScoped('body', 'branchId')
  @ApiOperation({
    summary: 'Create a DRAFT purchase order (totals computed by the server)',
  })
  create(
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.create(dto, user, ctx);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_WRITE)
  @ApiOperation({
    summary: 'Edit a DRAFT (items, when given, replace all lines)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.update(id, dto, user, ctx);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROCUREMENT_WRITE)
  @ApiOperation({ summary: 'Submit a DRAFT for approval (procurement:write)' })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.submit(id, user, ctx);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROCUREMENT_APPROVE)
  @ApiOperation({
    summary: 'Approve a SUBMITTED order (never by its creator or submitter)',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.approve(id, dto, user, ctx);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROCUREMENT_APPROVE)
  @ApiOperation({
    summary:
      'Reject a SUBMITTED order with a reason (never by its creator or submitter)',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.reject(id, dto, user, ctx);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROCUREMENT_WRITE)
  @ApiOperation({ summary: 'Reopen a REJECTED order as DRAFT' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.reopen(id, user, ctx);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  // Before approval: procurement:write; APPROVED: procurement:approve (checked in the service).
  @RequireAnyPermission(
    PERMISSIONS.PROCUREMENT_WRITE,
    PERMISSIONS.PROCUREMENT_APPROVE,
  )
  @ApiOperation({
    summary:
      'Cancel with a reason (approved orders: approvers only, nothing received)',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.purchases.cancel(id, dto, user, ctx);
  }
}
