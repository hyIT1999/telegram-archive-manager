import type { SecurityHeadersOptions } from '@nestjs/common';
import type { Env } from '../config/env.js';

/**
 * One policy for the api's JSON, its media and the web app it may serve (WEB_DIST_DIR).
 * Everything comes from this origin: the fonts are part of the build, media and thumbnails are
 * api routes, and live updates use the same host.
 *
 * `upgrade-insecure-requests` and HSTS only make sense behind HTTPS (COOKIE_SECURE=true): over
 * plain HTTP on a LAN address the browser would upgrade every script and style request to https
 * and the page would not load.
 */
export function securityHeaders(env: Pick<Env, 'COOKIE_SECURE'>): SecurityHeadersOptions {
  const https = env.COOKIE_SECURE;
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // Angular adds component styles at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        // PDFs open in a frame of the message page.
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: https,
      },
    },
    strictTransportSecurity: https,
  };
}
