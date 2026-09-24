import {
  BadRequestException,
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';
import { ApiErrorCode, type ValidationIssue } from '@tam/shared';

type SchemaIssues = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0];

export function toValidationIssues(issues: SchemaIssues): ValidationIssue[] {
  return issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.'),
    message: issue.message,
  }));
}

/**
 * Validates `@Body/@Query/@Param({ schema })` parameters with the shared zod schemas
 * (Standard Schema) and returns the parsed (coerced, defaulted) value.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) =>
      new BadRequestException({
        message: 'Request validation failed',
        code: ApiErrorCode.VALIDATION_FAILED,
        details: toValidationIssues(issues),
      }),
  });
}
