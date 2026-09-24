import { HttpErrorResponse } from '@angular/common/http';
import {
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  UNAVAILABLE_ERROR_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  isNotFoundError,
  retryAfterSeconds,
  toApiError,
  validationMessage,
} from './api-error';

function httpError(status: number, error: unknown = null): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, url: '/api/test' });
}

describe('toApiError', () => {
  it('uses the message of 4xx API bodies', () => {
    const error = httpError(409, {
      statusCode: 409,
      error: 'Conflict',
      message: 'Already running',
      code: 'IMPORT_ACTIVE',
    });
    expect(toApiError(error)).toEqual({
      status: 409,
      code: 'IMPORT_ACTIVE',
      message: 'Already running',
    });
  });

  it('joins validation message lists', () => {
    const error = httpError(400, {
      statusCode: 400,
      message: ['email is invalid', 'password is required'],
    });
    expect(toApiError(error).message).toBe('email is invalid password is required');
  });

  it('hides uncoded server error details behind a generic message', () => {
    const error = httpError(500, { statusCode: 500, message: 'TypeError: x is undefined' });
    expect(toApiError(error)).toEqual({ status: 500, code: null, message: SERVER_ERROR_MESSAGE });
  });

  it('shows deliberate, coded server errors', () => {
    const error = httpError(503, {
      statusCode: 503,
      message: 'The worker is not running.',
      code: 'WORKER_UNAVAILABLE',
    });
    expect(toApiError(error).message).toBe('The worker is not running.');
  });

  it('explains network failures', () => {
    expect(toApiError(httpError(0)).message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it.each([502, 503, 504])('reports an uncoded %i from a proxy as the server being down', (status) => {
    expect(toApiError(httpError(status, 'Bad Gateway')).message).toBe(UNAVAILABLE_ERROR_MESSAGE);
  });

  it('unwraps errors wrapped by resources (Error.cause)', () => {
    const wrapped = new Error('wrapped', {
      cause: httpError(404, { message: 'Channel not found' }),
    });
    expect(toApiError(wrapped)).toMatchObject({ status: 404, message: 'Channel not found' });
    expect(isNotFoundError(wrapped)).toBe(true);
  });

  it('handles errors that are not HTTP errors', () => {
    expect(toApiError(new TypeError('boom'))).toEqual({
      status: null,
      code: null,
      message: UNKNOWN_ERROR_MESSAGE,
    });
    expect(toApiError(undefined).status).toBeNull();
    expect(isNotFoundError(undefined)).toBe(false);
  });

  it('falls back to the status when the body has no message', () => {
    expect(toApiError(httpError(418, 'teapot')).message).toBe('Request failed (418).');
  });
});

describe('retryAfterSeconds', () => {
  it('reads the wait Telegram asked for', () => {
    const error = httpError(429, {
      message: 'Telegram asks to wait 90 s before trying again',
      code: 'FLOOD_WAIT',
      details: { retryAfterSeconds: 90 },
    });
    expect(retryAfterSeconds(error)).toBe(90);
  });

  it.each([
    ['no details', { message: 'Too many requests', code: 'RATE_LIMITED' }],
    ['a list of issues', { details: [{ path: 'code', message: 'x' }] }],
    ['a malformed value', { details: { retryAfterSeconds: '90' } }],
  ])('is null for %s', (_label, body) => {
    expect(retryAfterSeconds(httpError(429, body))).toBeNull();
  });

  it('is null for errors that are not HTTP errors', () => {
    expect(retryAfterSeconds(new Error('boom'))).toBeNull();
  });
});

describe('validationMessage', () => {
  it('returns the first field message of a validation failure', () => {
    const error = httpError(400, {
      message: 'Request validation failed',
      code: 'VALIDATION_FAILED',
      details: [
        { path: 'phoneNumber', message: 'Enter the phone number in international format' },
        { path: 'step', message: 'Invalid input' },
      ],
    });
    expect(validationMessage(error)).toBe('Enter the phone number in international format');
  });

  it('is null without field messages', () => {
    expect(validationMessage(httpError(400, { message: 'Bad request' }))).toBeNull();
    expect(validationMessage(httpError(400, { details: [{ path: 'x' }] }))).toBeNull();
  });
});
