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
  ReqContext,
  type RequestContext,
} from '../common/request-context/request-context';
import { ClassificationService } from './classification.service';
import {
  ClassificationQueryDto,
  CreateBrandDto,
  CreateCategoryDto,
  UpdateBrandDto,
  UpdateCategoryDto,
} from './dto/classification.dto';

@ApiTags('catalogue: categories')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED',
})
@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: ClassificationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOGUE_READ)
  @ApiOperation({ summary: 'List categories (flat)' })
  list(@Query() query: ClassificationQueryDto) {
    return this.svc.list('category', query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATALOGUE_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get('category', id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @ApiOperation({
    summary: 'Create a category (name unique, case-insensitive)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE',
  })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.svc.create('category', dto, user, ctx);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @ApiOperation({ summary: 'Update or (de)activate a category' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE / CATEGORY_IN_USE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.svc.update('category', id, dto, user, ctx);
  }
}

@ApiTags('catalogue: brands')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED',
})
@Controller('brands')
export class BrandsController {
  constructor(private readonly svc: ClassificationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOGUE_READ)
  @ApiOperation({ summary: 'List brands' })
  list(@Query() query: ClassificationQueryDto) {
    return this.svc.list('brand', query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATALOGUE_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get('brand', id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @ApiOperation({ summary: 'Create a brand (name unique, case-insensitive)' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE',
  })
  create(
    @Body() dto: CreateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.svc.create('brand', dto, user, ctx);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @ApiOperation({ summary: 'Update or (de)activate a brand' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_VALUE / BRAND_IN_USE',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.svc.update('brand', id, dto, user, ctx);
  }
}
