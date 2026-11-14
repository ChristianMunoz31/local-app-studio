// Settings > Data & storage > Backups (src/components/settings/BackupsControl.jsx).
import { expect } from '../support/fixtures.js';

export function backups(page) {
  const section = page.getByRole('region', { name: 'Backups' });
  return {
    section,
    async open() {
      await page.goto('/settings#data-storage');
      await expect(section).toBeVisible();
      await section.scrollIntoViewIfNeeded();
    },
    async backUpNow() {
      await section.getByRole('button', { name: 'Back up now' }).click();
      // The sentence shows only after POST /api/backups answered, so the new backup is written.
      await expect(section.getByRole('status').filter({ hasText: 'Backup saved.' })).toHaveCount(1);
      await expect(section.getByRole('table', { name: 'Your backups, newest first' })).toBeVisible();
      await expect(section.getByRole('button', { name: /^Restore backup from / }).first()).toBeVisible();
    },
    /** Types a second backup folder and saves it. */
    async setCopyTo(folder) {
      await section.getByLabel('Also copy each new backup to').fill(folder);
      await section.getByRole('button', { name: 'Save folder' }).click();
      await expect(section.getByRole('status').filter({ hasText: 'Second folder saved.' })).toHaveCount(1);
    },
    /** Waits for the second folder's status sentence (the copy runs after the backup answered). */
    async expectCopied() {
      await expect(section.getByRole('status').filter({ hasText: 'Last copied to the second folder' })).toHaveCount(1);
    },
    /** Restores the newest listed backup and waits for the page to reload. */
    async restoreNewest() {
      await section.getByRole('button', { name: /^Restore backup from / }).first().click();
      const confirm = section.getByRole('group', { name: 'Confirm restore' });
      await expect(confirm).toBeVisible();
      // Both listeners exist before the click. A refused restore never reloads: fail on its answer at once instead of
      // waiting out the test budget on a load that cannot come.
      const loaded = page.waitForEvent('load');
      const answered = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/backups/restore');
      await confirm.getByRole('button', { name: 'Restore', exact: true }).click();
      expect((await answered).status(), 'the restore was refused').toBe(200);
      await loaded;
    },
  };
}
