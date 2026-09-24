import type { NextFunction, Request, Response } from 'express';

/**
 * API responses carry per-user data, so by default neither browsers nor proxies may store them.
 * Routes that serve cacheable content (e.g. media later on) set their own Cache-Control.
 */
export function noStoreByDefault(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
