import type { ApiErrorBody } from '@tam/shared';
import type { Response } from 'supertest';
import { expect } from 'vitest';

let lastClientIp = 0;

/**
 * A fresh client address per scenario. TRUST_PROXY=loopback makes the api read the client IP
 * from X-Forwarded-For (supertest connects over loopback), so each scenario gets its own
 * throttling bucket and the 5-logins-per-minute limit is tested in isolation.
 */
export function nextClientIp(): string {
  lastClientIp += 1;
  return `198.51.100.${lastClientIp}`;
}

/** The raw `tam_sid=...; attributes` Set-Cookie header, if the response set one. */
export function sessionSetCookie(response: Response): string | undefined {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header)
    ? (header as string[])
    : typeof header === 'string'
      ? [header]
      : [];
  return cookies.find((cookie) => cookie.startsWith('tam_sid='));
}

/** `tam_sid=<token>`, ready for a Cookie request header. */
export function sessionCookie(response: Response): string {
  const setCookie = sessionSetCookie(response);
  if (!setCookie) {
    throw new Error(`No session cookie in response (status ${response.status})`);
  }
  return setCookie.split(';')[0] ?? '';
}

export function expectApiError(
  response: Response,
  statusCode: number,
  code?: string,
): ApiErrorBody {
  expect(response.status).toBe(statusCode);
  const body = response.body as ApiErrorBody;
  expect(body).toMatchObject({
    statusCode,
    error: expect.any(String),
    message: expect.any(String),
  });
  if (code !== undefined) {
    expect(body.code).toBe(code);
  }
  return body;
}
