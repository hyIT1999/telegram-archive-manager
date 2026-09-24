import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest, SessionUser } from './auth.types.js';

/** The user SessionGuard attached to the request. Only meaningful on non-public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return request.user;
  },
);
