import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types.js';

/** The id of the session SessionGuard found for this request. Only meaningful on non-public routes. */
export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.sessionId) {
      throw new UnauthorizedException();
    }
    return request.sessionId;
  },
);
