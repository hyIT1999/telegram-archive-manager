import { isIP } from 'node:net';
import { HttpException } from '@nestjs/common';
import { ApiErrorCode } from '@tam/shared';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';

/** 421 Misdirected Request: this server does not answer for the requested host name. */
const MISDIRECTED_REQUEST = 421;

export type HostEnv = Pick<Env, 'ALLOWED_HOSTS' | 'CSRF_TRUSTED_ORIGINS'>;

/** The host names allowed besides IP addresses and localhost: ALLOWED_HOSTS and the trusted origins. */
export function allowedHostNames(env: HostEnv): string[] {
  const fromOrigins = env.CSRF_TRUSTED_ORIGINS.map((origin) => new URL(origin).hostname);
  return [...new Set([...env.ALLOWED_HOSTS, ...fromOrigins].map(normalize))];
}

function normalize(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * The host name of a Host header (`name`, `name:port`, `1.2.3.4:port`, `[::1]:port`), lower-cased
 * and without port or brackets. Null when the header is missing or anything else (a user part,
 * a path, spaces), so that nothing can smuggle an allowed name past the check.
 */
export function hostNameOf(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/.exec(header);
  if (bracketed) {
    const address = bracketed[1] ?? '';
    return isIP(address) === 6 ? address.toLowerCase() : null;
  }
  const plain = /^([A-Za-z0-9.-]+)(?::\d{1,5})?$/.exec(header);
  return plain ? normalize(plain[1] ?? '') : null;
}

function matches(host: string, allowed: string): boolean {
  if (allowed.startsWith('*.')) {
    return host.endsWith(allowed.slice(1));
  }
  return host === allowed;
}

/**
 * IP addresses and localhost always pass: a page can only reach them under their own origin.
 * A DNS name must be one the server is meant to be reached by; otherwise a page on some other
 * domain could point its name at this server (DNS rebinding) and read its answers.
 */
export function isAllowedHost(
  header: string | undefined,
  allowedNames: readonly string[],
): boolean {
  const host = hostNameOf(header);
  if (host === null || host === '') {
    return false;
  }
  if (isIP(host) !== 0 || host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  return allowedNames.some((allowed) => matches(host, allowed));
}

/** Express middleware answering 421 HOST_NOT_ALLOWED for any other Host header. */
export function hostGuard(env: HostEnv) {
  const allowedNames = allowedHostNames(env);
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (isAllowedHost(request.headers.host, allowedNames)) {
      next();
      return;
    }
    next(
      new HttpException(
        {
          message:
            'This server does not answer for that host name. Add it to ALLOWED_HOSTS (or CSRF_TRUSTED_ORIGINS) if it is yours.',
          code: ApiErrorCode.HOST_NOT_ALLOWED,
        },
        MISDIRECTED_REQUEST,
      ),
    );
  };
}
