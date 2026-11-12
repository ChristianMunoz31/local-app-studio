// Settings > Data & storage: back up now, change data, restore that backup, the change is gone.
import { test, expect, useApp } from '../support/fixtures.js';
import { backups } from '../pages/backups.js';
import { createBlankApp, expectLanding } from '../pages/apps.js';

useApp({ seed: true, ollama: 'dead' });

test('restoring a backup rolls the data back', async ({ page }) => {
  const b = backups(page);
  await b.open();
  await b.backUpNow();

  await page.goto('/apps');
  await createBlankApp(page, 'Added after the backup');
  await expectLanding(page);
  await page.goto('/apps');
  await expect(page.getByRole('link', { name: 'Added after the backup' })).toBeVisible();

  await b.open();
  await b.restoreNewest();

  await page.goto('/apps');
  await expect(page.getByRole('link', { name: 'Added after the backup' })).toHaveCount(0);
});
