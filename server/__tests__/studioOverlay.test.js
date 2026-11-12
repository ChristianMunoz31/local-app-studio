// The Dev build must get the same Studio overlay and template step as the stable build (it runs with no module hook, so it
// cannot rely on the pro twin of scripts/desktop/build.js). Both modes are checked through explicit resolver answers.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, resolveProDir } from '../../scripts/lib/proDir.js';
import { buildDevConfig } from '../../scripts/desktop/buildDev.js';
import { TEMPLATE_RESOURCE, studioTauriOverlay, templateStepFor } from '../../scripts/desktop/studioOverlay.js';

const PRO = { mode: 'pro', dir: path.join(REPO_ROOT, 'pro') };
const PUBLIC = resolveProDir({ APP_PRO_DIR: 'none' });
const versions = { bundle: '0.2.0-dev.20261005+1008', buildNumber: 1008 };
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const base = JSON.parse(read('src-tauri/tauri.dev.conf.json'));
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'));

describe('the Dev build config in a pro checkout', () => {
  it('a pro build packages the template in studio mode only', () => {
    expect(templateStepFor('studio', PRO)).toBe(true);
    expect(templateStepFor('runtime', PRO)).toBe(false);
  });

  it('studio mode adds the template resource to the generated config', () => {
    const studio = templateStepFor('studio', PRO);
    const config = buildDevConfig(base, versions, { studio, tauriConf });
    expect(config.bundle.resources).toContain(TEMPLATE_RESOURCE);
    expect(config.bundle.resources).toEqual(studioTauriOverlay(tauriConf).bundle.resources);
  });
});

describe('the Dev build config in a public build', () => {
  it('has no template step in any mode, so nothing tries to package', () => {
    expect(templateStepFor('studio', PUBLIC)).toBe(false);
    expect(templateStepFor('runtime', PUBLIC)).toBe(false);
  });

  it('leaves the template resource out of the generated config', () => {
    const studio = templateStepFor('studio', PUBLIC);
    const config = buildDevConfig(base, versions, { studio, tauriConf });
    expect(config.bundle.resources ?? []).not.toContain(TEMPLATE_RESOURCE);
  });
});

describe('the open module is the one source', () => {
  it('buildDev.js reads the overlay from studioOverlay.js, never from the build.js stub', () => {
    expect(read('scripts/desktop/buildDev.js')).toMatch(/from '\.\/studioOverlay\.js'/);
    expect(read('scripts/desktop/buildDev.js')).not.toMatch(/from '\.\/build\.js'/);
  });

  it('the stub build.js re-exports the same functions', async () => {
    const stub = await import('../../scripts/desktop/build.js');
    expect(stub.studioTauriOverlay).toBe(studioTauriOverlay);
    expect(stub.templateStepFor).toBe(templateStepFor);
  });
});
