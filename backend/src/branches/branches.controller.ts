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
import { BranchesService } from './branches.service';
import {
  BranchQueryDto,
  CreateBranchDto,
  UpdateBranchDto,
} from './dto/branch.dto';

@ApiTags('branches')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED / BRANCH_ACCESS_DENIED',
})
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BRANCHES_READ)
  @ApiOperation({ summary: 'List branches within the caller’s scope' })
  list(@Query() query: BranchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.branches.list(query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_READ)
  @ApiOperation({
    summary: 'Branch detail (403 if outside the caller’s scope)',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branches.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCHES_WRITE)
  @ApiOperation({ summary: 'Create a branch' })
  create(
    @Body() dto: CreateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.branches.create(dto, user, ctx);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_WRITE)
  @ApiOperation({
    summary: 'Update or deactivate a branch (code is immutable)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.branches.update(id, dto, user, ctx);
  }
}
