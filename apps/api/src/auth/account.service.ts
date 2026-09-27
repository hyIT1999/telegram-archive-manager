import {
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { ApiErrorCode, type ChangePasswordRequest, type SessionDto } from '@tam/shared';
import type { SessionUser } from './auth.types.js';
import { LoginAttempts } from './login-attempts.js';
import { hashPassword, verifyPassword } from './password.js';
import { SessionService } from './session.service.js';

/** The signed-in user's own account: password and signed-in browsers. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttempts,
  ) {}

  /**
   * Replaces the password and signs out every other browser (whoever knew the old password may
   * be signed in elsewhere). A wrong current password counts as a failed sign-in, so a stolen
   * session cannot be used to guess it faster than the sign-in page allows.
   */
  async changePassword(
    user: SessionUser,
    currentSessionId: string,
    request: ChangePasswordRequest,
  ): Promise<void> {
    await this.attempts.assertNotLocked(user.email);
    const stored = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!stored) {
      throw new UnauthorizedException({
        message: 'Authentication required',
        code: ApiErrorCode.UNAUTHENTICATED,
      });
    }
    if (!(await verifyPassword(stored.passwordHash, request.currentPassword))) {
      await this.attempts.recordFailure(user.email);
      throw new UnprocessableEntityException({
        message: 'The current password is not correct.',
        code: ApiErrorCode.CURRENT_PASSWORD_WRONG,
      });
    }
    if (request.newPassword === request.currentPassword) {
      throw new UnprocessableEntityException({
        message: 'Choose a new password that differs from the current one.',
        code: ApiErrorCode.PASSWORD_UNCHANGED,
      });
    }
    const passwordHash = await hashPassword(request.newPassword);
    const [, signedOut] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId: user.id, id: { not: currentSessionId } } }),
    ]);
    await this.attempts.clear(user.email);
    this.logger.log(
      `Password changed for user ${user.id}; ${signedOut.count} other session(s) signed out`,
    );
  }

  async listSessions(user: SessionUser, currentSessionId: string): Promise<SessionDto[]> {
    const records = await this.sessions.listForUser(user.id);
    return records.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      ip: session.ip,
      userAgent: session.userAgent,
    }));
  }

  revokeSession(user: SessionUser, sessionId: string): Promise<boolean> {
    return this.sessions.revokeById(user.id, sessionId);
  }

  async revokeOtherSessions(user: SessionUser, currentSessionId: string): Promise<number> {
    const revoked = await this.sessions.revokeOthers(user.id, currentSessionId);
    this.logger.log(`User ${user.id} signed out ${revoked} other session(s)`);
    return revoked;
  }
}
