// The runtime-mode UI plugin refuses Studio-only code by path, without a build: all of src/vendor/ and the drag and drop
// library, besides the Studio, server/studio and feature library paths (modeBuild.test.js covers the real bundles).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { studioServerPlugin, studioUiPlugin } from '../../../scripts/desktop/modeBuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (mode, rel) =>
  studioUiPlugin(mode, { root: ROOT }).load.call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    path.join(ROOT, ...rel.split('/')),
  );

describe('studioUiPlugin forbidden paths', () => {
  it.each([
    ['any file under src/vendor/', 'src/vendor/ui-builder/lib/utils.ts'],
    ['a file directly under src/vendor/', 'src/vendor/anything.ts'],
    ['the drag and drop library', 'node_modules/@dnd-kit/core/dist/core.esm.js'],
    ['Studio code', 'src/studio/pages/PreviewTab.tsx'],
    ['the feature library', 'src/catalog/features/index.ts'],
  ])('runtime mode refuses %s', (_name, rel) => {
    expect(() => load('runtime', rel)).toThrow(/must not be in a runtime build/);
  });

  it('runtime mode allows ordinary UI files, and studio mode allows all of them', () => {
    expect(load('runtime', 'src/modules/runtime.jsx')).toBeNull();
    expect(load('studio', 'src/vendor/ui-builder/lib/utils.ts')).toBeNull();
    expect(load('studio', 'node_modules/@dnd-kit/core/dist/core.esm.js')).toBeNull();
  });
});

describe('the pro twins of Studio paths (docs/ARCHITECTURE.md, "The pro seam")', () => {
  const PRO_DIR = path.join(ROOT, 'pro');
  const OTHER_PRO = path.join(path.dirname(ROOT), 'las-other-pro');
  const uiLoad = (mode, file, proDirs) =>
    studioUiPlugin(mode, { root: ROOT, proDirs }).load.call(
      {
        error: (message) => {
          throw new Error(message);
        },
      },
      file,
    );
  /** The onLoad handler the server plugin registers, called with a path. */
  const serverLoad = (mode, file, proDirs) => {
    let handler = null;
    studioServerPlugin(mode, { root: ROOT, proDirs }).setup({ onResolve: () => {}, onLoad: (_opts, fn) => (handler = fn) });
    return handler ? handler({ path: file }) : undefined;
  };

  it.each([
    ['the pro helper pipeline', path.join(PRO_DIR, 'server', 'studio', 'describe', 'pipeline.js')],
    ['the pro build service', path.join(PRO_DIR, 'server', 'studio', 'build', 'service.js')],
    ['pro Studio UI code', path.join(PRO_DIR, 'src', 'studio', 'x.tsx')],
  ])('runtime mode refuses %s', (_name, file) => {
    expect(() => uiLoad('runtime', file, [PRO_DIR])).toThrow(/must not be in a runtime build/);
    expect(serverLoad('runtime', file, [PRO_DIR])?.errors?.[0].text).toMatch(/must not be in a runtime build/);
  });

  it('follows a pro folder outside the repo (APP_PRO_DIR) as well as pro/', () => {
    const file = path.join(OTHER_PRO, 'server', 'studio', 'describe', 'pipeline.js');
    expect(() => uiLoad('runtime', file, [PRO_DIR, OTHER_PRO])).toThrow(/must not be in a runtime build/);
    expect(serverLoad('runtime', file, [PRO_DIR, OTHER_PRO])?.errors).toHaveLength(1);
    expect(serverLoad('runtime', file, [PRO_DIR])).toBeUndefined();
  });

  it('allows the pro files a built app ships, and studio mode allows all', () => {
    const license = path.join(PRO_DIR, 'server', 'license', 'index.js');
    expect(uiLoad('runtime', license, [PRO_DIR])).toBeNull();
    expect(serverLoad('runtime', license, [PRO_DIR])).toBeUndefined();
    const helper = path.join(PRO_DIR, 'server', 'studio', 'describe', 'pipeline.js');
    expect(uiLoad('studio', helper, [PRO_DIR])).toBeNull();
    expect(serverLoad('studio', helper, [PRO_DIR])).toBeUndefined();
  });
});
