import { Injectable, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { ApiErrorCode, type AuthUserDto, type LoginRequest } from '@tam/shared';
import { toAuthUserDto, type SessionClientInfo } from './auth.types.js';
import { LoginAttempts } from './login-attempts.js';
import {
  createDummyPasswordHash,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from './password.js';
import { SessionService, type IssuedSession } from './session.service.js';

export interface LoginResult {
  user: AuthUserDto;
  session: IssuedSession;
}

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttempts,
  ) {}

  /** Prepared at startup so even the first unknown-email login costs a full verification. */
  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await createDummyPasswordHash();
  }

  /**
   * A locked email is refused before any password check (no CPU spent on guessing). Known and
   * unknown emails fail, count and lock the same way.
   */
  async login(credentials: LoginRequest, client: SessionClientInfo): Promise<LoginResult> {
    await this.attempts.assertNotLocked(credentials.email);
    const user = await this.prisma.user.findUnique({ where: { email: credentials.email } });
    if (!user) {
      await verifyPassword(this.dummyPasswordHash, credentials.password);
      await this.attempts.recordFailure(credentials.email);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, credentials.password))) {
      await this.attempts.recordFailure(credentials.email);
      throw invalidCredentials();
    }
    await this.attempts.clear(credentials.email);

    const now = new Date();
    const rehash = passwordNeedsRehash(user.passwordHash)
      ? { passwordHash: await hashPassword(credentials.password) }
      : {};
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, ...rehash },
      select: { id: true, email: true, lastLoginAt: true },
    });
    const session = await this.sessions.create(user.id, client, now);
    return { user: toAuthUserDto(updated), session };
  }

  logout(token: string): Promise<void> {
    return this.sessions.revoke(token);
  }
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    message: INVALID_CREDENTIALS_MESSAGE,
    code: ApiErrorCode.INVALID_CREDENTIALS,
  });
}
