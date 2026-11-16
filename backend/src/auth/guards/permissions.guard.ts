import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AuthenticatedRequest } from '../auth.types';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_ANY_PERMISSION_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../decorators';

export function permissionDenied(): AppException {
  return new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.PERMISSION_DENIED,
    'You do not have permission to perform this action',
  );
}

/**
 * Global authorization guard (FR-AUTH-04, ADR-016). Checks permission KEYS,
 * never role names. Fails closed: a protected route that declares neither
 * @RequirePermissions nor @AuthenticatedOnly is denied.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw permissionDenied();

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      targets,
    );
    if (required && required.length > 0) {
      if (required.every((p) => user.permissions.has(p))) return true;
      throw permissionDenied();
    }

    const anyOf = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_ANY_PERMISSION_KEY,
      targets,
    );
    if (anyOf && anyOf.length > 0) {
      if (anyOf.some((p) => user.permissions.has(p))) return true;
      throw permissionDenied();
    }

    if (
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)
    ) {
      return true;
    }

    this.logger.warn(
      `Route ${context.getClass().name}.${context.getHandler().name} declares no access rule; denied`,
    );
    throw permissionDenied();
  }
}
