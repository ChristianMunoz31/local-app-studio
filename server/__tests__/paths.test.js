// getDataDir: per-OS defaults and the APP_DATA_DIR override, with platform/env injected.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { dataFolderName, getDataDir, resolveDataDir, resolveStableDataDir } from '../paths.js';

describe('resolveDataDir', () => {
  it('uses %APPDATA%\\Local App Studio on win32', () => {
    expect(
      resolveDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\sam\\AppData\\Roaming' }, home: 'C:\\Users\\sam' }),
    ).toBe('C:\\Users\\sam\\AppData\\Roaming\\Local App Studio');
  });

  it('falls back to ~\\AppData\\Roaming on win32 without APPDATA', () => {
    expect(resolveDataDir({ platform: 'win32', env: {}, home: 'C:\\Users\\sam' })).toBe(
      'C:\\Users\\sam\\AppData\\Roaming\\Local App Studio',
    );
  });

  it('uses $XDG_DATA_HOME/local-app-studio on linux when set', () => {
    expect(resolveDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/xdg' }, home: '/home/sam' })).toBe(
      '/data/xdg/local-app-studio',
    );
  });

  it('uses ~/.local/share/local-app-studio on linux otherwise', () => {
    expect(resolveDataDir({ platform: 'linux', env: {}, home: '/home/sam' })).toBe('/home/sam/.local/share/local-app-studio');
  });

  it('uses ~/Library/Application Support/Local App Studio on darwin', () => {
    expect(resolveDataDir({ platform: 'darwin', env: {}, home: '/Users/sam' })).toBe(
      '/Users/sam/Library/Application Support/Local App Studio',
    );
  });

  it('lets APP_DATA_DIR win on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
      expect(resolveDataDir({ platform, env: { APP_DATA_DIR: 'custom-dir', APPDATA: 'x' }, home: '/h' })).toBe(
        path.resolve('custom-dir'),
      );
    }
  });
});

describe('getDataDir', () => {
  it('creates the directory recursively and returns it', () => {
    const mkdir = vi.fn();
    const dir = getDataDir({ platform: 'linux', env: {}, home: '/home/sam', mkdir });
    expect(dir).toBe('/home/sam/.local/share/local-app-studio');
    expect(mkdir).toHaveBeenCalledWith('/home/sam/.local/share/local-app-studio', { recursive: true, mode: 0o700 });
  });
});

describe('dev channel data dir', () => {
  it('uses Local App Studio Dev on win32 and darwin, local-app-studio-dev on linux', () => {
    expect(resolveDataDir({ platform: 'win32', env: { APPDATA: 'C:\\A' }, home: 'C:\\h', channel: 'dev' })).toBe(
      'C:\\A\\Local App Studio Dev',
    );
    expect(resolveDataDir({ platform: 'darwin', env: {}, home: '/Users/sam', channel: 'dev' })).toBe(
      '/Users/sam/Library/Application Support/Local App Studio Dev',
    );
    expect(resolveDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/x' }, home: '/h', channel: 'dev' })).toBe(
      '/x/local-app-studio-dev',
    );
    expect(resolveDataDir({ platform: 'linux', env: {}, home: '/h', channel: 'dev' })).toBe(
      '/h/.local/share/local-app-studio-dev',
    );
  });

  it('takes the channel from APP_CHANNEL when not passed, and stable otherwise', () => {
    expect(resolveDataDir({ platform: 'linux', env: { APP_CHANNEL: 'dev' }, home: '/h' })).toBe(
      '/h/.local/share/local-app-studio-dev',
    );
    expect(resolveDataDir({ platform: 'linux', env: { APP_CHANNEL: 'nope' }, home: '/h' })).toBe(
      '/h/.local/share/local-app-studio',
    );
  });

  it('still lets APP_DATA_DIR win in the dev channel', () => {
    expect(
      resolveDataDir({ platform: 'win32', env: { APP_DATA_DIR: 'custom-dir' }, home: '/h', channel: 'dev' }),
    ).toBe(path.resolve('custom-dir'));
  });

  it('dataFolderName per platform', () => {
    expect(dataFolderName('stable', 'win32')).toBe('Local App Studio');
    expect(dataFolderName('dev', 'darwin')).toBe('Local App Studio Dev');
    expect(dataFolderName('stable', 'linux')).toBe('local-app-studio');
    expect(dataFolderName('dev', 'linux')).toBe('local-app-studio-dev');
  });
});

describe('resolveStableDataDir', () => {
  it('ignores APP_DATA_DIR and the channel: it is always the stable default', () => {
    expect(
      resolveStableDataDir({
        platform: 'win32',
        env: { APPDATA: 'C:\\A', APP_DATA_DIR: 'elsewhere', APP_CHANNEL: 'dev' },
        home: 'C:\\h',
      }),
    ).toEqual({ dir: 'C:\\A\\Local App Studio', overridden: false });
    expect(resolveStableDataDir({ platform: 'linux', env: {}, home: '/h' })).toEqual({
      dir: '/h/.local/share/local-app-studio',
      overridden: false,
    });
  });

  it('honours APP_STABLE_DATA_DIR (trimmed, resolved) and flags it', () => {
    expect(
      resolveStableDataDir({ platform: 'linux', env: { APP_STABLE_DATA_DIR: '  fake-stable  ' }, home: '/h' }),
    ).toEqual({ dir: path.resolve('fake-stable'), overridden: true });
    expect(
      resolveStableDataDir({ platform: 'linux', env: { APP_STABLE_DATA_DIR: '   ' }, home: '/h' }).overridden,
    ).toBe(false);
  });
});
