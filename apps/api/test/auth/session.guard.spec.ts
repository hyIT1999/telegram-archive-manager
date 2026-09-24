import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../src/auth/auth.types.js';
import { Public } from '../../src/auth/public.decorator.js';
import { SessionCookie } from '../../src/auth/session-cookie.js';
import { SessionGuard } from '../../src/auth/session.guard.js';
import type { ActiveSession, SessionService } from '../../src/auth/session.service.js';
import type { Env } from '../../src/config/env.js';

class ProtectedController {
  handler(): void {}
}

class MixedController {
  @Public()
  open(): void {}
}

@Public()
class PublicController {
  handler(): void {}
}

const TOKEN = 'A'.repeat(43);

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

function contextFor(
  controller: new () => object,
  handler: () => void,
  request: Partial<AuthenticatedRequest>,
  response = fakeResponse(),
): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function requestWithCookie(cookie?: string): Partial<AuthenticatedRequest> {
  return { headers: cookie === undefined ? {} : { cookie } };
}

describe('SessionGuard', () => {
  const resolve = vi.fn<(token: string, now: Date) => Promise<ActiveSession | null>>();
  const config = { get: () => false } as unknown as ConfigService<Env, true>;
  let guard: SessionGuard;

  beforeEach(() => {
    resolve.mockReset();
    guard = new SessionGuard(
      new Reflector(),
      { resolve } as unknown as SessionService,
      new SessionCookie(config),
    );
  });

  it('lets @Public() handlers and controllers through without a session lookup', async () => {
    const request = requestWithCookie();
    await expect(
      guard.canActivate(contextFor(MixedController, MixedController.prototype.open, request)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(PublicController, PublicController.prototype.handler, request)),
    ).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a request without the session cookie', async () => {
    const context = contextFor(
      ProtectedController,
      ProtectedController.prototype.handler,
      requestWithCookie('theme=dark'),
    );
    const failure = guard.canActivate(context);
    await expect(failure).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(failure).rejects.toMatchObject({
      response: { message: 'Authentication required', code: 'UNAUTHENTICATED' },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired session and clears its cookie', async () => {
    resolve.mockResolvedValue(null);
    const response = fakeResponse();
    const context = contextFor(
      ProtectedController,
      ProtectedController.prototype.handler,
      requestWithCookie(`tam_sid=${TOKEN}`),
      response,
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolve).toHaveBeenCalledWith(TOKEN, expect.any(Date));
    expect(response.clearCookie).toHaveBeenCalledWith(
      'tam_sid',
      expect.objectContaining({ path: '/api', httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('attaches the user and session to the request', async () => {
    const user = { id: 'u-1', email: 'admin@example.com', lastLoginAt: null };
    resolve.mockResolvedValue({
      id: 's-1',
      user,
      expiresAt: new Date(Date.now() + 60_000),
      refreshed: false,
    });
    const request = requestWithCookie(`other=1; tam_sid=${TOKEN}`);
    const response = fakeResponse();

    await expect(
      guard.canActivate(
        contextFor(ProtectedController, ProtectedController.prototype.handler, request, response),
      ),
    ).resolves.toBe(true);
    expect(request.user).toBe(user);
    expect(request.sessionId).toBe('s-1');
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('re-issues the cookie when the sliding expiry moved', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 3_600_000);
    resolve.mockResolvedValue({
      id: 's-1',
      user: { id: 'u-1', email: 'admin@example.com', lastLoginAt: null },
      expiresAt,
      refreshed: true,
    });
    const response = fakeResponse();
    await guard.canActivate(
      contextFor(
        ProtectedController,
        ProtectedController.prototype.handler,
        requestWithCookie(`tam_sid=${TOKEN}`),
        response,
      ),
    );
    // The cookie lives exactly as long as the session, measured from the same instant.
    const now = resolve.mock.calls[0]?.[1] as Date;
    expect(response.cookie).toHaveBeenCalledWith('tam_sid', TOKEN, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      maxAge: expiresAt.getTime() - now.getTime(),
    });
  });
});
