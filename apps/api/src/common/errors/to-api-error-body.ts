import { STATUS_CODES } from 'node:http';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@tam/database';
import { ApiErrorCode, type ApiErrorBody } from '@tam/shared';

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

function body(
  statusCode: number,
  message: string,
  extra: { error?: string; code?: string; details?: unknown } = {},
): ApiErrorBody {
  const result: ApiErrorBody = {
    statusCode,
    error: extra.error ?? STATUS_CODES[statusCode] ?? 'Error',
    message,
  };
  const code =
    extra.code ??
    (statusCode === HttpStatus.TOO_MANY_REQUESTS ? ApiErrorCode.RATE_LIMITED : undefined);
  if (code !== undefined) {
    result.code = code;
  }
  if (extra.details !== undefined) {
    result.details = extra.details;
  }
  return result;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fromHttpException(exception: HttpException): ApiErrorBody {
  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return body(statusCode, response);
  }
  const fields = response as Record<string, unknown>;
  const rawMessage = fields['message'];
  // Nest's built-in pipes report a list of messages; keep the list as details.
  const messages = Array.isArray(rawMessage) ? rawMessage.map(String) : undefined;
  const message =
    messages?.join('; ') || asString(rawMessage) || STATUS_CODES[statusCode] || exception.message;
  return body(statusCode, message, {
    error: asString(fields['error']),
    code: asString(fields['code']),
    details: fields['details'] ?? messages,
  });
}

function fromPrismaError(error: Prisma.PrismaClientKnownRequestError): ApiErrorBody | undefined {
  switch (error.code) {
    case 'P2002':
      return body(HttpStatus.CONFLICT, 'A record with the same unique value already exists', {
        code: ApiErrorCode.CONFLICT,
      });
    case 'P2025':
      return body(HttpStatus.NOT_FOUND, 'The requested record was not found', {
        code: ApiErrorCode.NOT_FOUND,
      });
    default:
      return undefined;
  }
}

/**
 * Errors from Express middleware (body-parser: 413, 415, …) follow the http-errors convention:
 * a 4xx `status` and `expose: true` when the message is safe to show to the client.
 */
function fromExposedClientError(error: unknown): ApiErrorBody | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { status, expose, message } = error as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (expose !== true || typeof status !== 'number' || status < 400 || status >= 500) {
    return undefined;
  }
  return body(status, asString(message) ?? STATUS_CODES[status] ?? 'Error');
}

/**
 * Maps anything thrown while handling a request to the ApiErrorBody contract.
 * Unknown errors become a generic 500 so internals (SQL, stack traces, paths) never leak.
 */
export function toApiErrorBody(exception: unknown): ApiErrorBody {
  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = fromPrismaError(exception);
    if (mapped) {
      return mapped;
    }
  }
  return (
    fromExposedClientError(exception) ??
    body(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_ERROR_MESSAGE)
  );
}
