import { HttpException } from '@nestjs/common';

/** An HttpException whose response tells the client when to try again (Retry-After, in seconds). */
export class RetryAfterException extends HttpException {
  constructor(
    response: Record<string, unknown>,
    status: number,
    readonly retryAfterSeconds: number,
  ) {
    super(response, status);
  }
}
