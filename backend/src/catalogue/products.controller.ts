import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('catalogue: products')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED',
})
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOGUE_READ)
  @ApiOperation({
    summary:
      'List/search products. costPrice is omitted without catalogue:cost_read.',
  })
  list(
    @Query() query: ProductQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.list(query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATALOGUE_READ)
  @ApiOperation({
    summary: 'Product detail (costPrice only with catalogue:cost_read)',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @ApiOperation({
    summary: 'Create a product with its initial (tax-exclusive) prices',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE (sku)',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR / REFERENCE_INACTIVE',
  })
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.products.create(dto, user, ctx);
  }

  @Patch(':id')
  // Route admits either permission; the service enforces them per field (D5).
  @RequireAnyPermission(
    PERMISSIONS.CATALOGUE_WRITE,
    PERMISSIONS.CATALOGUE_PRICE,
  )
  @ApiOperation({
    summary:
      'Update a product. costPrice/sellingPrice need catalogue:price; other fields need catalogue:write. sku and tracking policy are immutable.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'IMMUTABLE_FIELD / REFERENCE_INACTIVE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.products.update(id, dto, user, ctx);
  }
}
