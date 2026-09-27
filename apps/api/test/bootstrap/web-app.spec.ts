import { describe, expect, it } from 'vitest';
import { isHashedAsset } from '../../src/bootstrap/web-app.js';
import { securityHeaders } from '../../src/bootstrap/security-headers.js';

describe('isHashedAsset', () => {
  // Names from a real Angular 22 build (outputHashing "all").
  it.each([
    'main-CSPAH5C2.js',
    'styles-CA7J3HRZ.css',
    'polyfills-ABCD1234.js',
    'chunk-A--e_s7l.js',
    'chunk-9gIFsLmd2.js',
    'chunk-B_d3pluX.js',
    'media/inter-latin-wght-normal-DkVL2t9O.woff2',
    'media/material-symbols-outlined-BZ4aUBUf.woff2',
  ])('treats %j as immutable', (file) => {
    expect(isHashedAsset(file)).toBe(true);
  });

  it.each([
    'index.html',
    'theme-init.js',
    'favicon.ico',
    '3rdpartylicenses.txt',
    'main.js',
    'chunk-short.js',
    'nested/chunk-A--e_s7l.js',
  ])('revalidates %j', (file) => {
    expect(isHashedAsset(file)).toBe(false);
  });
});

describe('securityHeaders', () => {
  it('keeps plain HTTP working: no HSTS and no upgrade of requests', () => {
    const options = securityHeaders({ COOKIE_SECURE: false });
    expect(options.strictTransportSecurity).toBe(false);
    expect(
      typeof options.contentSecurityPolicy === 'object' &&
        options.contentSecurityPolicy.directives?.['upgradeInsecureRequests'],
    ).toBe(false);
  });

  it('turns both on behind HTTPS', () => {
    const options = securityHeaders({ COOKIE_SECURE: true });
    expect(options.strictTransportSecurity).toBe(true);
    expect(
      typeof options.contentSecurityPolicy === 'object' &&
        options.contentSecurityPolicy.directives?.['upgradeInsecureRequests'],
    ).toBe(true);
  });
});
