import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from '../common/errors/api-exception.filter.js';
import { noStoreByDefault } from '../common/http/no-store.middleware.js';
import type { Env } from '../config/env.js';
import { hostGuard } from './host-guard.js';
import { securityHeaders } from './security-headers.js';
import { serveWebApp } from './web-app.js';

export const API_PREFIX = 'api';

export type HttpEnv = Pick<
  Env,
  'CSRF_TRUSTED_ORIGINS' | 'TRUST_PROXY' | 'COOKIE_SECURE' | 'ALLOWED_HOSTS' | 'WEB_DIST_DIR'
>;

/**
 * HTTP-level setup shared by main.ts and the e2e tests. Must run before app.init()/listen().
 * CORS stays disabled: the SPA reaches the API on the same origin (dev server proxy, nginx, or
 * the api itself serving the build from WEB_DIST_DIR).
 */
export function configureApp(app: NestExpressApplication, env: HttpEnv): NestExpressApplication {
  // req.ip (throttling, session audit) is the real client address only behind trusted proxies.
  app.set('trust proxy', env.TRUST_PROXY);
  // Registered first so that even responses rejected by the CSRF check are not cached.
  app.use(noStoreByDefault);
  // The security hook is installed here, in this position of the middleware chain.
  app.useSecurityHeaders(securityHeaders(env));
  // Rejects cross-site state-changing requests (Sec-Fetch-Site, falling back to Origin vs Host).
  app.enableCsrfProtection({ trustedOrigins: env.CSRF_TRUSTED_ORIGINS });
  // After the hook, so that a refused host still gets the security headers.
  app.use(hostGuard(env));
  if (env.WEB_DIST_DIR !== undefined) {
    serveWebApp(app, env.WEB_DIST_DIR, API_PREFIX);
  }
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
