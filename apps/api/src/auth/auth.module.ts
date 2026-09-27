import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LOGIN_LOCKOUT_SETTINGS, LoginAttempts } from './login-attempts.js';
import { DEFAULT_LOGIN_LOCKOUT } from './login-lockout.js';
import { SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    AccountService,
    LoginAttempts,
    SessionService,
    SessionCookie,
    { provide: LOGIN_LOCKOUT_SETTINGS, useValue: DEFAULT_LOGIN_LOCKOUT },
  ],
  // SessionGuard is registered globally in AppModule and needs these.
  exports: [SessionService, SessionCookie],
})
export class AuthModule {}
