import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUserLoader } from '../auth-user.loader';
import type { AuthenticatedRequest } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators';
import { invalidToken, TokenService } from '../token.service';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Global authentication guard (FR-AUTH-03). Every route requires a valid
 * `Authorization: Bearer <access token>` unless marked @Public().
 * The user is re-loaded from the database, so deactivated users and tokens
 * issued before a password change are rejected immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: AuthUserLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = BEARER.exec(req.headers.authorization ?? '');
    if (!match) throw invalidToken('Authentication required');

    const claims = await this.tokens.verifyAccessToken(match[1]);
    const user = await this.users.load(claims.sub, claims.iat);
    if (!user) throw invalidToken();

    req.user = user;
    return true;
  }
}
