// The web UI with and without the cloud provider screens. A real Vite build of AiSection.jsx (the only
// importer of the cloud UI), with the cloudUiPlugin the real vite.config.js uses; packages stay external.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { cloudUiPlugin } from '../../scripts/desktop/cloudBuild.js';
import { resolveProDir } from '../../scripts/lib/proDir.js';
import { proSeamVitePlugin } from '../../scripts/lib/proSeam.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import { CLOUD_UI_MARKER } from '../../scripts/checks/cloudMarker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INPUT = path.join(ROOT, 'src', 'components', 'settings', 'AiSection.jsx');
// Same order as vite.config.js: the cloud plugin first, so a cloud-off pro build still gets the disabled stub, then the pro seam.
const PRO = resolveProDir(process.env);
const PRO_BLOCK = path.join(ROOT, 'pro', 'src', 'components', 'settings', 'CloudAiBlock.jsx');

const bundle = async (mode, input = INPUT) => {
  const out = await build({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    plugins: [react(), cloudUiPlugin(mode), proSeamVitePlugin(PRO)],
    build: {
      write: false,
      minify: true,
      // Library mode keeps the entry's exports, so nothing is tree-shaken away.
      lib: { entry: input, formats: ['es'], fileName: 'out' },
      rolldownOptions: {
        external: (id) => !id.startsWith('.') && !id.startsWith('\0') && !path.isAbsolute(id),
      },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
  return outputs.filter((o) => o.type === 'chunk').map((o) => o.code).join('\n');
};

const results = {};
beforeAll(async () => {
  results.off = await bundle('off');
  results.on = await bundle('on');
}, 120_000);

describe('cloud UI build', () => {
  it('cloud off: the marker is not in the output', () => {
    expect(results.off.length).toBeGreaterThan(0);
    expect(results.off).not.toContain(CLOUD_UI_MARKER);
  });

  it.skipIf(PUBLIC_BUILD)('cloud on: the marker is in the output (the cloud screens are pro, which is not in a public build)', () => {
    expect(results.on).toContain(CLOUD_UI_MARKER);
  });

  it.skipIf(!fs.existsSync(PRO_BLOCK))('cloud off: importing the cloud screens (a pro twin) around the seam fails the build', async () => {
    const stray = PRO_BLOCK;
    await expect(bundle('off', stray)).rejects.toThrow(/must not be in a cloud-off build/);
  });

  it('rejects a mode that is not on or off', () => {
    expect(() => cloudUiPlugin('maybe')).toThrow(/must be on or off/);
  });
});
