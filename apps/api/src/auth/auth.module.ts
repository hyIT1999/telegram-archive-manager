import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, SessionCookie],
  // SessionGuard is registered globally in AppModule and needs these.
  exports: [SessionService, SessionCookie],
})
export class AuthModule {}
