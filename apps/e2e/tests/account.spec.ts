import { expect, nextClientIp, test } from './fixtures.js';
import { ACCOUNT_OWNER } from './settings.js';
import { signIn } from './sign-in.js';

const NEW_PASSWORD = 'a brand new passphrase';

test('changing the password signs out the other browsers', async ({ browser }) => {
  // Two browsers of the same person, on two computers.
  const mine = await browser.newContext({
    extraHTTPHeaders: { 'X-Forwarded-For': nextClientIp() },
  });
  const theirs = await browser.newContext({
    extraHTTPHeaders: { 'X-Forwarded-For': nextClientIp() },
  });
  const page = await mine.newPage();
  const elsewhere = await theirs.newPage();
  await signIn(page, ACCOUNT_OWNER);
  await signIn(elsewhere, ACCOUNT_OWNER);

  await page.goto('/settings');
  await expect(page.locator('.session')).toHaveCount(2);
  await expect(page.locator('.session', { hasText: 'This browser' })).toHaveCount(1);

  await page.getByLabel('Current password').fill(ACCOUNT_OWNER.password);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('New password again').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Other browsers were signed out.')).toBeVisible();
  await expect(page.locator('.session')).toHaveCount(1);

  // The other browser finds out at its next request and goes to the login page.
  await elsewhere.reload();
  await expect(elsewhere).toHaveURL(/\/login/);
  await signIn(elsewhere, { email: ACCOUNT_OWNER.email, password: NEW_PASSWORD });

  await mine.close();
  await theirs.close();
});
