import { expect, test } from './fixtures.js';
import { openMessage } from './navigation.js';
import { signIn } from './sign-in.js';

test('a message marked as favorite joins Favorites', async ({ page }) => {
  await signIn(page);
  await page.goto('/favorites');
  const cards = page.locator('app-message-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Homework 5');

  await page.goto('/search?q=homework%207');
  await openMessage(page, 'Homework 7');
  const heart = page.locator('app-favorite-button button');
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(heart).toContainText('Favorited');

  await page.goto('/favorites');
  await expect(cards).toHaveCount(2);
});

test('a tag lists the messages that carry it', async ({ page }) => {
  await signIn(page);
  await page.goto('/tags');
  await page.getByRole('link', { name: /Exam/ }).first().click();
  await expect(page.locator('app-message-card', { hasText: 'Chapter 2 notes.pdf' })).toBeVisible();
});
