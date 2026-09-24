import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { toApiErrorBody } from './to-api-error-body.js';

/** Global filter: every error response has the ApiErrorBody shape. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const errorBody = toApiErrorBody(exception);

    if (errorBody.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const summary = `${request.method} ${request.originalUrl} failed: ${describe(exception)}`;
      if (exception instanceof HttpException) {
        // Raised on purpose (worker offline, Telegram timeout, …): a condition, not a bug.
        this.logger.warn(summary);
      } else {
        this.logger.error(summary, exception instanceof Error ? exception.stack : undefined);
      }
    }
    if (response.headersSent) {
      // Too late for a JSON error; drop the connection so the client sees a failure.
      response.destroy();
      return;
    }
    response.status(errorBody.statusCode).json(errorBody);
  }
}

function describe(exception: unknown): string {
  return exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception);
}
