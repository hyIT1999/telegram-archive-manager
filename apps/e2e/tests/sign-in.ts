import { expect, type Page } from '@playwright/test';
import { READER } from './settings.js';

/** Signs in through the login page and waits for the dashboard. */
export async function signIn(page: Page, user = READER, returnTo = '/dashboard'): Promise<void> {
  await page.goto(`/login?returnUrl=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${returnTo.replace(/[?]/g, '\\?')}$`));
}
