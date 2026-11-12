// The cloud-off refusal list follows the resolved pro folder (APP_PRO_DIR), not a hardcoded pro/ (docs/ARCHITECTURE.md, "The pro seam").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT, proFolders } from '../../scripts/lib/proDir.js';
import { cloudProviderPlugin, cloudUiPlugin } from '../../scripts/desktop/cloudBuild.js';

const ROOT = REPO_ROOT;
const OTHER = path.join(path.dirname(ROOT), 'las-other-pro');
const PROVIDER = ['server', 'ai', 'providers', 'openaiCompat.js'];
const CLIENT = ['server', 'ai', 'llmClient.js'];
const BLOCK = ['src', 'components', 'settings', 'CloudAiBlock.jsx'];
const UI_SEAM = ['src', 'components', 'settings', 'cloudUi.js'];

const providerLoad = (proDirs, file) => {
  let handler = null;
  cloudProviderPlugin('off', { root: ROOT, proDirs }).setup({ onResolve: () => {}, onLoad: (_o, fn) => (handler = fn) });
  return handler({ path: file });
};
const uiLoad = (proDirs, file) =>
  cloudUiPlugin('off', { root: ROOT, proDirs }).load.call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    file,
  );

const HAS_PRO = fs.existsSync(path.join(ROOT, 'pro', 'server'));
/** A pro folder outside the repo, as APP_PRO_DIR may name one; removed after each test. */
const temps = [];
const otherPro = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-other-pro-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const norm = (dirs) => dirs.map((d) => path.resolve(d));

describe('proFolders', () => {
  it('is pro/ in the repo in a public build and when APP_PRO_DIR is unset', () => {
    expect(proFolders(ROOT, {})).toEqual([path.join(ROOT, 'pro')]);
    expect(proFolders(ROOT, { APP_PRO_DIR: 'none' })).toEqual([path.join(ROOT, 'pro')]);
  });
  // The repo's own pro/ is named once (a checkout without pro/ has no such folder to point at, so this case is skipped there).
  it.skipIf(!HAS_PRO)('names pro/ once when APP_PRO_DIR points at it', () => {
    expect(proFolders(ROOT, { APP_PRO_DIR: 'pro' })).toEqual([path.join(ROOT, 'pro')]);
  });
  it('adds the folder APP_PRO_DIR names when it is somewhere else', () => {
    const dir = otherPro();
    expect(norm(proFolders(ROOT, { APP_PRO_DIR: dir }))).toEqual([path.join(ROOT, 'pro'), path.resolve(dir)]);
  });
  it('refuses a folder that is not there instead of a quiet public list', () => {
    expect(() => proFolders(ROOT, { APP_PRO_DIR: path.join(os.tmpdir(), 'las-no-such-pro') })).toThrow(/does not exist/);
  });
});

describe('the plugins build their refusal list from APP_PRO_DIR when none is given', () => {
  const withProDir = (dir, fn) => {
    const before = process.env.APP_PRO_DIR;
    process.env.APP_PRO_DIR = dir;
    try {
      return fn();
    } finally {
      if (before === undefined) delete process.env.APP_PRO_DIR;
      else process.env.APP_PRO_DIR = before;
    }
  };
  it('the provider seam refuses the provider twin under a pro folder outside the repo', () => {
    const dir = otherPro();
    const res = withProDir(dir, () => {
      let handler = null;
      cloudProviderPlugin('off', { root: ROOT }).setup({ onResolve: () => {}, onLoad: (_o, fn) => (handler = fn) });
      return handler({ path: path.join(dir, ...PROVIDER) });
    });
    expect(res?.errors?.[0].text).toMatch(/must not be in a cloud-off build/);
  });
  it('the UI seam refuses the cloud block twin under a pro folder outside the repo', () => {
    const dir = otherPro();
    expect(() =>
      withProDir(dir, () =>
        cloudUiPlugin('off', { root: ROOT }).load.call(
          {
            error: (message) => {
              throw new Error(message);
            },
          },
          path.join(dir, ...BLOCK),
        ),
      ),
    ).toThrow(/must not be in a cloud-off build/);
  });
});

describe('the cloud provider seam refuses the twins under every resolved pro folder', () => {
  it.each([
    ['the provider', PROVIDER],
    ['the transport', CLIENT],
  ])('%s under pro/ and under another pro folder', (_name, parts) => {
    for (const dir of [path.join(ROOT, 'pro'), OTHER]) {
      expect(providerLoad([path.join(ROOT, 'pro'), OTHER], path.join(dir, ...parts))?.errors?.[0].text).toMatch(/must not be in a cloud-off build/);
    }
  });

  it('does not refuse another pro folder it was not told about', () => {
    expect(providerLoad([path.join(ROOT, 'pro')], path.join(OTHER, ...PROVIDER))).toBeUndefined();
  });
});

describe('the cloud UI seam refuses the twins under every resolved pro folder', () => {
  it.each([
    ['a cloud screen', BLOCK],
    ['the cloud UI seam', UI_SEAM],
  ])('%s', (_name, parts) => {
    for (const dir of [path.join(ROOT, 'pro'), OTHER]) {
      expect(() => uiLoad([path.join(ROOT, 'pro'), OTHER], path.join(dir, ...parts))).toThrow(/must not be in a cloud-off build/);
    }
  });

  it('does not refuse a pro folder it was not told about', () => {
    expect(uiLoad([path.join(ROOT, 'pro')], path.join(OTHER, ...BLOCK))).toBeNull();
  });
});
