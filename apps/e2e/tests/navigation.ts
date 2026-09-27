import type { Page } from '@playwright/test';

/** Opens the message of the first card showing `text` (the card's own link, not its channel's). */
export async function openMessage(page: Page, text: string): Promise<void> {
  await page
    .locator('app-message-card', { hasText: text })
    .first()
    .locator('a[href^="/messages/"]')
    .first()
    .click();
  await page.waitForURL(/\/messages\/[0-9a-f-]+$/);
}
