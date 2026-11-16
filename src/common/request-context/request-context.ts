import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithId } from './request-id.middleware';

/** Request metadata recorded with audit events. */
export interface RequestContext {
  requestId?: string;
  /** Client IP (honours TRUST_PROXY hops; see app.setup.ts). */
  ipAddress?: string;
}

export function toRequestContext(req: RequestWithId): RequestContext {
  return { requestId: req.requestId, ipAddress: req.ip?.slice(0, 45) };
}

export const ReqContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestContext =>
    toRequestContext(ctx.switchToHttp().getRequest<RequestWithId>()),
);
