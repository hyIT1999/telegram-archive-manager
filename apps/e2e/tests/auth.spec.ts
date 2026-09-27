import { expect, test } from './fixtures.js';
import { READER } from './settings.js';

test('a page needs a session: wrong password refused, then sign in and out', async ({ page }) => {
  await page.goto('/favorites');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Ffavorites$/);

  await page.getByLabel('Email').fill(READER.email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password.');

  await page.getByLabel('Password', { exact: true }).fill(READER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/favorites$/);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
