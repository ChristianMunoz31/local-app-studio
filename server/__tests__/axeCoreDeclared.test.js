// L31-1 (phase 33): unit tests import `axe-core` directly, so it must be a declared dev dependency at the version the lockfile
// already installs (it was only present through @axe-core/playwright). A dev dependency adds nothing to any bundle.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

function testFilesImporting(dir, name) {
  const out = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.(js|jsx|ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(`from '${name}'`)) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return out;
}

describe('axe-core is a declared dev dependency (L31-1)', () => {
  it('is in devDependencies at the exact locked version, not in dependencies', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const locked = lock.packages['node_modules/axe-core'];
    expect(locked?.dev).toBe(true);
    expect(pkg.devDependencies['axe-core']).toBe(locked.version);
    expect(pkg.dependencies['axe-core']).toBeUndefined();
    expect(lock.packages[''].devDependencies['axe-core']).toBe(locked.version);
  });

  it('the unit tests that import it are the ones the declaration covers', () => {
    const files = testFilesImporting('src', 'axe-core').map((f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/__tests__\//);
  });
});
