import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@tam/database';
import { loginRequestSchema } from '@tam/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from '../../src/common/errors/api-exception.filter.js';
import { toApiErrorBody } from '../../src/common/errors/to-api-error-body.js';
import { createValidationPipe } from '../../src/common/validation/validation.pipe.js';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`Prisma failed with ${code}`, {
    code,
    clientVersion: '7.10.0',
  });
}

describe('toApiErrorBody', () => {
  it('keeps the status, message and code of HTTP exceptions', () => {
    expect(
      toApiErrorBody(
        new UnauthorizedException({
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        }),
      ),
    ).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
    });
    expect(toApiErrorBody(new NotFoundException('Cannot GET /api/nope'))).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/nope',
    });
    expect(toApiErrorBody(new ForbiddenException())).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Forbidden',
    });
  });

  it('keeps intentional 5xx HTTP exceptions (they carry safe messages)', () => {
    const body = toApiErrorBody(
      new ServiceUnavailableException({
        message: 'Worker unavailable',
        code: 'WORKER_UNAVAILABLE',
      }),
    );
    expect(body).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Worker unavailable',
      code: 'WORKER_UNAVAILABLE',
    });
  });

  it('turns message lists of built-in pipes into details', () => {
    expect(
      toApiErrorBody(new BadRequestException(['a must be a number', 'b is required'])),
    ).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'a must be a number; b is required',
      details: ['a must be a number', 'b is required'],
    });
  });

  it('marks rate limiting with RATE_LIMITED', () => {
    expect(
      toApiErrorBody(new ThrottlerException('Too many requests, please try again later')),
    ).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMITED',
    });
  });

  it('maps Prisma unique violations to 409 and missing records to 404', () => {
    expect(toApiErrorBody(prismaError('P2002'))).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'CONFLICT',
    });
    expect(toApiErrorBody(prismaError('P2025'))).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
    });
  });

  it('hides everything else behind a generic 500', () => {
    const internal = {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    };
    expect(toApiErrorBody(prismaError('P2034'))).toEqual(internal);
    expect(
      toApiErrorBody(new Error('relation "users" does not exist at C:\\app\\dist\\x.js')),
    ).toEqual(internal);
    expect(toApiErrorBody('boom')).toEqual(internal);
    expect(
      toApiErrorBody(Object.assign(new Error('secret detail'), { status: 500, expose: false })),
    ).toEqual(internal);
  });

  it('passes through client errors raised by Express middleware', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(toApiErrorBody(tooLarge)).toEqual({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'request entity too large',
    });
  });

  it('reports schema validation failures as 400 VALIDATION_FAILED with per-field details', async () => {
    const pipe = createValidationPipe();
    const failure = await pipe
      .transform({ email: 'not-an-email' }, { type: 'body', schema: loginRequestSchema })
      .catch((error: unknown) => error);
    expect(toApiErrorBody(failure)).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Request validation failed',
      code: 'VALIDATION_FAILED',
      details: [
        { path: 'email', message: expect.any(String) },
        { path: 'password', message: expect.any(String) },
      ],
    });
  });
});

describe('createValidationPipe', () => {
  it('returns the parsed value (trimmed, lower-cased)', async () => {
    const parsed: unknown = await createValidationPipe().transform(
      { email: '  Admin@Example.COM ', password: 'x', extra: true },
      { type: 'body', schema: loginRequestSchema },
    );
    expect(parsed).toEqual({ email: 'admin@example.com', password: 'x' });
  });
});

describe('ApiExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function hostFor(response: object): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', originalUrl: '/api/stats' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
  }

  function fakeResponse(headersSent = false) {
    const response = { headersSent, status: vi.fn(), json: vi.fn(), destroy: vi.fn() };
    response.status.mockReturnValue(response);
    return response;
  }

  it('writes the ApiErrorBody with the matching status', () => {
    const response = fakeResponse();
    new ApiExceptionFilter().catch(new NotFoundException('Channel not found'), hostFor(response));
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      message: 'Channel not found',
    });
  });

  it('logs unexpected errors but responds with a generic body', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const response = fakeResponse();
    new ApiExceptionFilter().catch(
      new TypeError('Cannot read properties of undefined'),
      hostFor(response),
    );
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain('GET /api/stats failed: TypeError');
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });

  it('logs deliberate server errors as a warning without a stack trace', () => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const response = fakeResponse();
    new ApiExceptionFilter().catch(
      new ServiceUnavailableException({
        message: 'The background worker is not running.',
        code: 'WORKER_UNAVAILABLE',
      }),
      hostFor(response),
    );
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledExactlyOnceWith(
      'GET /api/stats failed: ServiceUnavailableException: The background worker is not running.',
    );
    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('drops the connection when the response already started', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const response = fakeResponse(true);
    new ApiExceptionFilter().catch(new Error('stream failed'), hostFor(response));
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(response.json).not.toHaveBeenCalled();
  });
});
