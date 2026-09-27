import { expect, test } from './fixtures.js';
import { openMessage } from './navigation.js';
import { signIn } from './sign-in.js';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('from the dashboard to a forum topic and a stored image, which survives a reload', async ({
  page,
}) => {
  await page.getByRole('navigation').getByRole('link', { name: 'Channels' }).click();
  await page
    .getByRole('link', { name: /Physics Forum/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Physics Forum' })).toBeVisible();

  await page
    .getByRole('link', { name: /Optics/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/topics\/3$/);
  await openMessage(page, 'Diagram 3.png');

  const image = page.locator('img.image');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(96);

  await page.reload();
  await expect(page.locator('img.image')).toBeVisible();
  await expect(page.getByText('Ray diagram for the lens exercise')).toBeVisible();
});

test('a stored PDF shows inside the message page', async ({ page }) => {
  await page.goto('/messages?types=DOCUMENT');
  await openMessage(page, 'Chapter 2 notes.pdf');
  await expect(page.locator('iframe')).toHaveAttribute('src', /\/api\/media\/[0-9a-f-]+\/content$/);
});
