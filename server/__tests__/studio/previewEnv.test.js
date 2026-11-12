import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieValue, initDesktopAuth, resetDesktopAuth } from '../../desktop/auth.js';
import { cookieFor, newSecret } from '../../studio/preview/childAuth.js';
import { buildPreviewEnv } from '../../studio/preview/childEnv.js';
import { defaultPreviewSpawnSpec } from '../../studio/preview/manager.js';
import { previewRoot, scratchDirFor } from '../../studio/preview/paths.js';

afterEach(() => resetDesktopAuth());

const HOSTILE = {
  OLLAMA_HOST: 'http://evil',
  AUTH_SECRET: 's',
  APP_PASSWORD: 'p',
  GITHUB_TOKEN: 't',
  NODE_OPTIONS: '--inspect',
  APP_NETWORK_OPTIN: 'cloudAi',
  APP_CLOUD_AI: 'on',
};
const WIN = { SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', TMP: 'C:\\t', USERPROFILE: 'C:\\u', APPDATA: 'C:\\a', LOCALAPPDATA: 'C:\\l', Path: 'x', ...HOSTILE };
const POSIX = { PATH: '/bin', HOME: '/var/empty', TMPDIR: '/tmp', ...HOSTILE };
const BASE = ['APP_MODE', 'APP_SPEC_PATH', 'APP_DATA_DIR', 'APP_DESKTOP', 'APP_PREVIEW_CHILD', 'APP_HOST', 'APP_PORT', 'APP_NO_DOTENV', 'APP_SCHEDULER', 'APP_AI', 'APP_SHELL_CHANNEL'];

describe('buildPreviewEnv', () => {
  it('has exactly the win32 key set', () => {
    const env = buildPreviewEnv({ specPath: 'C:\\p\\spec.json', dataDir: 'C:\\p\\data', parentEnv: WIN, platform: 'win32' });
    expect(Object.keys(env).sort()).toEqual(['SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', ...BASE].sort());
    expect(env.PATH).toBe('C:\\Windows\\System32');
    expect(env).toMatchObject({ APP_MODE: 'runtime', APP_DESKTOP: '1', APP_HOST: '127.0.0.1', APP_PORT: '0', APP_AI: '0', APP_SHELL_CHANNEL: 'stable' });
  });

  it('has exactly the posix key set', () => {
    const env = buildPreviewEnv({ specPath: '/p/spec.json', dataDir: '/p/data', parentEnv: POSIX, platform: 'linux' });
    expect(Object.keys(env).sort()).toEqual(['PATH', 'HOME', 'TMPDIR', ...BASE].sort());
  });

  it('never copies secrets, hosts or other APP settings', () => {
    for (const platform of ['win32', 'linux']) {
      const env = buildPreviewEnv({ specPath: '/s', dataDir: '/d', parentEnv: platform === 'win32' ? WIN : POSIX, platform });
      for (const key of Object.keys(HOSTILE)) expect(env).not.toHaveProperty(key);
      expect(JSON.stringify(env)).not.toMatch(/evil|inspect/);
    }
  });

  it('copies the two allowed app keys, the migrations dir and the dev channel', () => {
    const env = buildPreviewEnv({
      specPath: '/s',
      dataDir: '/d',
      appMigrationsDir: '/m',
      parentEnv: { ...POSIX, APP_MIGRATIONS_DIR: '/mig', APP_DISPLAY_VERSION: '1.0.0-dev', APP_CHANNEL: 'dev' },
      platform: 'linux',
    });
    expect(env).toMatchObject({ APP_MIGRATIONS_DIR: '/mig', APP_DISPLAY_VERSION: '1.0.0-dev', APP_SPEC_MIGRATIONS_DIR: '/m', APP_SHELL_CHANNEL: 'dev', APP_CHANNEL: 'dev' });
  });
});

describe('previewRoot and scratchDirFor', () => {
  const uuid = '123e4567-e89b-42d3-a456-426614174000';

  it('follows the documented order', () => {
    const abs = path.resolve('/x/preview-root');
    expect(previewRoot({ APP_PREVIEW_DIR: abs, APP_DATA_DIR: '/d' }, 'win32')).toBe(abs);
    expect(previewRoot({ APP_PREVIEW_DIR: 'relative', APP_DATA_DIR: '/d' }, 'linux')).toBe(`${path.resolve('/d')}-preview`);
    expect(previewRoot({ VITEST: 'true', APP_TEST_DATA_DIR: '/t', APP_DATA_DIR: '/d' }, 'linux')).toBe(`${path.resolve('/t')}-preview`);
    expect(previewRoot({ APP_DATA_DIR: '/d' }, 'win32')).toBe(`${path.resolve('/d')}-preview`);
    expect(previewRoot({ LOCALAPPDATA: 'C:\\L' }, 'win32')).toBe('C:\\L\\Local App Studio\\preview');
    expect(previewRoot({ LOCALAPPDATA: 'C:\\L', APP_CHANNEL: 'dev' }, 'win32')).toBe('C:\\L\\Local App Studio Dev\\preview');
    expect(previewRoot({ HOME: '/h', XDG_DATA_HOME: '/xdg' }, 'linux')).toMatch(/-preview$/);
  });

  it('only builds a path from a UUID', () => {
    expect(scratchDirFor('/root', uuid)).toBe(path.join('/root', uuid));
    for (const bad of ['..\\x', '../x', 'crew-roster', '', undefined, `${uuid}/..`]) expect(() => scratchDirFor('/root', bad)).toThrow(TypeError);
  });
});

describe('childAuth and spawn spec', () => {
  it('derives the same cookie as the desktop gate', () => {
    const secret = newSecret();
    expect(secret).toHaveLength(32);
    initDesktopAuth(secret);
    expect(cookieFor(secret)).toBe(cookieValue());
  });

  it('picks the sea and dev commands', () => {
    expect(defaultPreviewSpawnSpec({ sea: true, execPath: '/x/app' })).toEqual({ command: '/x/app', args: ['--role', 'preview'] });
    const dev = defaultPreviewSpawnSpec({ sea: false, execPath: '/node' });
    expect(dev.command).toBe('/node');
    expect(dev.args).toHaveLength(3);
    expect(path.basename(dev.args[2])).toBe('server.js');
    expect(path.isAbsolute(dev.args[2])).toBe(true);
  });

  it('a source-checkout child always loads the pro seam hook, whatever flags this process has', () => {
    const dev = defaultPreviewSpawnSpec({ sea: false, execPath: '/node' });
    expect(dev.args[0]).toBe('--import');
    expect(dev.args[1]).toMatch(/^file:\/\/\/.*\/scripts\/lib\/proHook\.js$/);
    expect(fs.existsSync(fileURLToPath(dev.args[1]))).toBe(true);
  });

  it('the sea child never gets the hook', () => {
    expect(defaultPreviewSpawnSpec({ sea: true, execPath: '/x/app' }).args).not.toContain('--import');
  });
});
