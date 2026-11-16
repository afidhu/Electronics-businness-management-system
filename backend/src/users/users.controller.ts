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
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'PERMISSION_DENIED / BRANCH_ACCESS_DENIED',
})
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: 'List users (branch-scoped unless branches:access_all)',
  })
  list(@Query() query: UserQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.users.list(query, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: 'User detail (404 if outside the caller’s branch scope)',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @ApiOperation({ summary: 'Create a user with a role and branch assignments' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.users.create(dto, user, ctx);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @ApiOperation({
    summary:
      'Update name, role, branch assignments or active status (deactivate revokes sessions)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.users.update(id, dto, user, ctx);
  }

  @Post(':id/password')
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Set a new password for another user (unlocks; revokes their sessions)',
  })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.users.resetPassword(id, dto, user, ctx);
  }
}
