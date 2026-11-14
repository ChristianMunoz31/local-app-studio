// Settings > Data & storage > Backups: a second folder receives each new backup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, useApp } from '../support/fixtures.js';
import { backups } from '../pages/backups.js';

useApp({ seed: true, ollama: 'dead' });

test('a new backup is also copied to the second folder', async ({ page }) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'las-e2e-copyto-'));
  try {
    const b = backups(page);
    await b.open();
    await b.setCopyTo(folder);
    await b.backUpNow();
    await b.expectCopied();

    // The copy is the backup Back up now just made: the newest one the server lists.
    const listed = await (await page.request.get('/api/backups')).json();
    const [newest] = listed.data.backups;
    const names = fs.readdirSync(folder);
    expect(names).toContain(`local-app-studio-${newest.id}.db`);
    expect(names).toContain(`local-app-studio-${newest.id}.meta.json`);
    expect(names).toContain(`local-app-studio-${newest.id}.export.zip`);
    expect(names.filter((n) => /^local-app-studio-.+\.db$/.test(n))).toHaveLength(1);
    expect(names.filter((n) => n.endsWith('.copy-tmp'))).toEqual([]);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
