import { expect, test } from './fixtures.js';
import { BASE_URL } from './settings.js';
import { signIn } from './sign-in.js';

test('the app loads everything from the archive itself, under a strict policy', async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));

  const response = await page.goto('/login');
  const policy = response?.headers()['content-security-policy'] ?? '';
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("font-src 'self'");
  // Plain HTTP must keep working: no upgrade of requests, no HSTS.
  expect(policy).not.toContain('upgrade-insecure-requests');
  expect(response?.headers()['strict-transport-security']).toBeUndefined();

  await signIn(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/messages');
  await expect(page.locator('app-message-card').first()).toBeVisible();

  // The fonts are part of the build: text and icons render without any other site.
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('16px "Inter Variable"')))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('24px "Material Symbols Outlined"')))
    .toBe(true);
  expect([...hosts]).toEqual([new URL(BASE_URL).host]);
  expect(errors).toEqual([]);
});

test('an unknown host name gets nothing (DNS rebinding)', async ({ request }) => {
  const response = await request.get('/api/health/live', {
    headers: { Host: 'rebind.evil.example' },
  });
  expect(response.status()).toBe(421);
});
