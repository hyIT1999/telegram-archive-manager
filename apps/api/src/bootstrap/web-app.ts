import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';

/** Files named after their content hash never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else is revalidated (ETag), so a new deployment is picked up at once. */
const REVALIDATE = 'no-cache';
/** What the web app never needs from the browser. */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/**
 * Angular's build outputs (outputHashing "all"): main-XXXXXXXX.js, chunk-XXXXXXXX.js with a
 * mixed-case hash that may contain "-" or "_", styles-XXXXXXXX.css, and fonts or images copied
 * to media/ with a hash suffix.
 */
const HASHED_FILE = /^(?:chunk|main|polyfills|styles|worker)-[\w-]{8,}\.(?:js|mjs|css)$/;
const HASHED_MEDIA = /^media\/[^/]+-[\w-]{8,}\.[A-Za-z0-9]+$/;

/** True for a build output whose name changes whenever its content does. */
export function isHashedAsset(relativePath: string): boolean {
  return HASHED_FILE.test(relativePath) || HASHED_MEDIA.test(relativePath);
}

/**
 * Serves the built web app (production without nginx, e.g. pm2 on Windows):
 * - files of the build, the hashed ones cached for a year;
 * - index.html for every page of the app (/dashboard, /channels/…), so a reload or a bookmark
 *   opens the right page;
 * - nothing under /api: those requests go on to the routes and their 404.
 * Registered after the security hook, so these responses carry the security headers too.
 */
export function serveWebApp(app: NestExpressApplication, dir: string, apiPrefix: string): void {
  const indexFile = path.join(dir, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(
      `WEB_DIST_DIR has no index.html (${dir}). Build the web app first: npm run build`,
    );
  }
  const staticFiles = express.static(dir, {
    index: false,
    redirect: false,
    setHeaders: (response, filePath) => {
      const relative = path.relative(dir, filePath).split(path.sep).join('/');
      response.setHeader('Cache-Control', isHashedAsset(relative) ? IMMUTABLE : REVALIDATE);
      response.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    },
  });
  const apiPath = `/${apiPrefix}`;

  app.use((request: Request, response: Response, next: NextFunction) => {
    const isApi = request.path === apiPath || request.path.startsWith(`${apiPath}/`);
    if (isApi || (request.method !== 'GET' && request.method !== 'HEAD')) {
      next();
      return;
    }
    staticFiles(request, response, (error?: unknown) => {
      if (error !== undefined) {
        next(error);
        return;
      }
      if (!opensAppPage(request)) {
        next();
        return;
      }
      response.setHeader('Cache-Control', REVALIDATE);
      response.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      response.sendFile(indexFile, (sendError?: Error) => {
        if (sendError) {
          next(sendError);
        }
      });
    });
  });
}

/** A page of the app (no file extension) asked for by something that takes HTML. */
function opensAppPage(request: Request): boolean {
  return path.posix.extname(request.path) === '' && request.accepts('html') === 'html';
}
