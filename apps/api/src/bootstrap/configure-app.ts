import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from '../common/errors/api-exception.filter.js';
import { noStoreByDefault } from '../common/http/no-store.middleware.js';
import type { Env } from '../config/env.js';

export const API_PREFIX = 'api';

export type HttpEnv = Pick<Env, 'CSRF_TRUSTED_ORIGINS' | 'TRUST_PROXY'>;

/**
 * HTTP-level setup shared by main.ts and the e2e tests. Must run before app.init()/listen().
 * CORS stays disabled: the SPA reaches the API through a same-origin proxy (dev server or nginx).
 */
export function configureApp(app: NestExpressApplication, env: HttpEnv): NestExpressApplication {
  // req.ip (throttling, session audit) is the real client address only behind trusted proxies.
  app.set('trust proxy', env.TRUST_PROXY);
  // Registered first so that even responses rejected by the CSRF check are not cached.
  app.use(noStoreByDefault);
  app.useSecurityHeaders();
  // Rejects cross-site state-changing requests (Sec-Fetch-Site, falling back to Origin vs Host).
  app.enableCsrfProtection({ trustedOrigins: env.CSRF_TRUSTED_ORIGINS });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
