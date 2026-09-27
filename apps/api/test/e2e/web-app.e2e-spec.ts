import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectApiError } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const INDEX_HTML = '<!doctype html><html><body><app-root></app-root></body></html>';

/** A build folder shaped like apps/web/dist/web/browser. */
function writeBuild(dir: string): void {
  mkdirSync(path.join(dir, 'media'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  writeFileSync(path.join(dir, 'main-CSPAH5C2.js'), 'console.log("main");');
  writeFileSync(path.join(dir, 'chunk-A--e_s7l.js'), 'export const a = 1;');
  writeFileSync(path.join(dir, 'styles-CA7J3HRZ.css'), 'body{margin:0}');
  writeFileSync(path.join(dir, 'theme-init.js'), 'document.documentElement.dataset.theme="light";');
  writeFileSync(path.join(dir, 'media', 'inter-latin-DkVL2t9O.woff2'), 'font');
}

describe('The web app served by the api (e2e)', () => {
  let buildDir: string;
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    buildDir = mkdtempSync(path.join(tmpdir(), 'tam-web-dist-'));
    writeBuild(buildDir);
    app = await createTestApp(undefined, {
      WEB_DIST_DIR: buildDir,
      ALLOWED_HOSTS: ['archive.lan'],
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(buildDir, { recursive: true, force: true });
  });

  it('serves index.html for pages of the app, revalidated on every visit', async () => {
    for (const page of ['/', '/dashboard', '/channels/0197aa00-0000-7000-8000-000000000001']) {
      const response = await http().get(page).set('Accept', 'text/html').expect(200);
      expect(response.text).toBe(INDEX_HTML);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['etag']).toBeDefined();
      expect(response.headers['permissions-policy']).toContain('camera=()');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('sends a policy that works over plain HTTP and loads nothing from elsewhere', async () => {
    const response = await http().get('/').set('Accept', 'text/html').expect(200);
    const policy = String(response.headers['content-security-policy']);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("font-src 'self'");
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(policy).not.toContain('googleapis');
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('caches hashed build outputs for a year and revalidates the rest', async () => {
    for (const file of ['/main-CSPAH5C2.js', '/chunk-A--e_s7l.js', '/styles-CA7J3HRZ.css']) {
      const response = await http().get(file).expect(200);
      expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
    const font = await http().get('/media/inter-latin-DkVL2t9O.woff2').expect(200);
    expect(font.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const themeInit = await http().get('/theme-init.js').expect(200);
    expect(themeInit.headers['cache-control']).toBe('no-cache');
    expect(themeInit.headers['content-type']).toMatch(/javascript/);
  });

  it('answers a revalidation with 304', async () => {
    const first = await http().get('/theme-init.js').expect(200);
    await http()
      .get('/theme-init.js')
      .set('If-None-Match', String(first.headers['etag']))
      .expect(304);
  });

  it('answers HEAD without a body', async () => {
    const response = await http().head('/dashboard').set('Accept', 'text/html').expect(200);
    expect(response.text).toBeUndefined();
    expect(response.headers['content-type']).toMatch(/^text\/html/);
  });

  it('leaves /api to the api, missing files to a 404, and non-HTML requests alone', async () => {
    expectApiError(await http().get('/api/does-not-exist').set('Accept', 'text/html'), 404);
    await http().get('/api/health/live').expect(200);
    // Outside /api, Express answers what the web app does not serve.
    const notServed = [
      http().get('/missing-ABCDEFGH.js'),
      http().get('/dashboard').set('Accept', 'application/json'),
      http().post('/dashboard').set('Accept', 'text/html'),
    ];
    for (const response of await Promise.all(notServed)) {
      expect(response.status).toBe(404);
      expect(response.text).not.toContain('<app-root>');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('never serves files outside the build folder', async () => {
    const response = await http().get('/..%2f..%2fpackage.json').set('Accept', 'text/html');
    expect(response.status).not.toBe(200);
    expect(response.text ?? '').not.toContain('"name"');
  });

  describe('host names', () => {
    it('answers IP addresses, localhost and the allowed names', async () => {
      for (const host of ['127.0.0.1:8080', 'localhost:4300', 'archive.lan:8080']) {
        await http().get('/api/health/live').set('Host', host).expect(200);
      }
    });

    it('refuses any other name with 421, before serving anything', async () => {
      for (const target of ['/api/health/live', '/', '/main-CSPAH5C2.js']) {
        const response = await http()
          .get(target)
          .set('Host', 'rebind.evil.example:8080')
          .set('Accept', 'text/html');
        expectApiError(response, 421, 'HOST_NOT_ALLOWED');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['cache-control']).toBe('no-store');
      }
    });
  });
});

describe('The api without WEB_DIST_DIR (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves no web app', async () => {
    const response = await request(app.getHttpServer())
      .get('/dashboard')
      .set('Accept', 'text/html');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('<app-root>');
  });
});
