import { expect, test } from './fixtures.js';
import { signIn } from './sign-in.js';

test('the header search finds a file by a word of its name and marks it', async ({ page }) => {
  await signIn(page);
  const search = page.getByLabel('Search the archive');
  await search.fill('chapter');
  await search.press('Enter');

  await expect(page).toHaveURL(/q=chapter/);
  const card = page.locator('app-message-card', { hasText: 'Chapter 2 notes.pdf' });
  await expect(card).toBeVisible();
  await expect(card.locator('mark').first()).toHaveText(/^chapter$/i);
});

test('searching without accents finds the words', async ({ page }) => {
  await signIn(page);
  await page.goto('/search?q=homework%2012');
  await expect(page.locator('app-message-card', { hasText: 'Homework 12' }).first()).toBeVisible();
});
