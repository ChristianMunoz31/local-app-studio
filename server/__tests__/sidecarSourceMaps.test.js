// Sidecar source maps (DESIGN phase 15, section 9): Dev builds only. buildSidecar.js runs a build when imported, so the
// wiring is checked from its text, like the other pipeline pins.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRIVATE_WORKFLOWS } from './helpers/workflowSet.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

describe('sidecar source maps', () => {
  const sidecar = read('scripts', 'desktop', 'buildSidecar.js');

  it('maps --sourcemap to inline maps and the baked flag, and nothing else', () => {
    expect(sidecar).toContain("const sourcemap = args.has('--sourcemap');");
    expect(sidecar).toContain("...(sourcemap ? { sourcemap: 'inline' } : {})");
    expect(sidecar).toContain("__APP_SOURCEMAPS__: sourcemap ? 'true' : 'false'");
  });

  it('is passed by the Dev build only', () => {
    expect(read('scripts', 'desktop', 'buildDev.js')).toContain("'--minify', '--sourcemap', '--channel', 'dev'");
    expect(read('scripts', 'desktop', 'build.js')).not.toContain('--sourcemap');
  });

  it('turns source maps on in the entry for the baked flag or APP_SOURCE_MAPS=1', () => {
    const entry = read('server', 'entry.js');
    expect(entry).toContain('__APP_SOURCEMAPS__');
    expect(entry).toContain("process.env.APP_SOURCE_MAPS === '1'");
    expect(entry).toContain('process.setSourceMapsEnabled(true)');
  });

  it('never reaches the budget build, the gate or the release workflows', () => {
    const budgetLine = /buildSidecar\.js[^\n]*--bundle-only/g;
    // The private ci.yml runs the budget build itself; the public set (the export) builds the sidecar bundles through
    // npm run check:public (scripts/checks/publicBuild.js), which must never ask for source maps either.
    const budgetSources = PRIVATE_WORKFLOWS
      ? [read('scripts', 'ci', 'gate.js'), read('.github', 'workflows', 'ci.yml')]
      : [read('scripts', 'ci', 'gate.js'), read('scripts', 'checks', 'publicBuild.js')];
    for (const text of budgetSources) {
      const lines = text.match(budgetLine) ?? [];
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => !l.includes('--sourcemap'))).toBe(true);
    }
    if (!PRIVATE_WORKFLOWS) {
      expect(read('.github', 'workflows', 'ci.yml')).toContain('npm run check:public');
      expect(read('scripts', 'checks', 'publicBuild.js')).not.toContain('--sourcemap');
    }
    for (const wf of fs.readdirSync(path.join(ROOT, '.github', 'workflows'))) {
      expect(read('.github', 'workflows', wf)).not.toContain('--sourcemap');
    }
  });
});
