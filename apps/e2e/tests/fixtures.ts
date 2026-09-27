import { test as base, expect } from '@playwright/test';

let lastClient = 0;

/**
 * A client address of its own for each test, sent as X-Forwarded-For (the test api trusts its
 * loopback "proxy", see support/serve.mjs). The sign-in limit (5 a minute per address) then
 * counts each test separately, as it would count separate people.
 */
export function nextClientIp(): string {
  lastClient += 1;
  return `198.51.100.${(lastClient % 250) + 1}`;
}

export const test = base.extend({
  // Playwright reads a fixture's dependencies from its first parameter; this one has none.
  // eslint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'X-Forwarded-For': nextClientIp() });
  },
});

export { expect };
