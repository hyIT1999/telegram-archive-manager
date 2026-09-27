import { expect, test } from './fixtures.js';
import { sql } from './database.js';
import { signIn } from './sign-in.js';

test('an import job page follows the database live, without polling', async ({ page }) => {
  await signIn(page);
  const [job] = await sql<{ id: string }>(`SELECT id FROM import_jobs WHERE status = 'RUNNING'`);
  await page.goto(`/imports/${job?.id}`);
  await expect(page.getByText('40 of about 200')).toBeVisible();

  const reads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`/api/import-jobs/${job?.id}`)) {
      reads.push(request.url());
    }
  });
  // What the worker writes after a page of messages; the database notifies the api.
  await sql(`UPDATE import_jobs SET processed_messages = 120 WHERE id = $1`, [job?.id]);
  await expect(page.getByText('120 of about 200')).toBeVisible({ timeout: 5_000 });
  expect(reads).toEqual([]);
});
