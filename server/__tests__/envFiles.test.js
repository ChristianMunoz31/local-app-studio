// mergeEnvFiles: the pure env merge shared by loadEnv.js and vite.config.js. Synthetic files in a temp dir only.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envFileAssignments, mergeEnvFiles } from '../envFiles.js';
import { resolveDevProxyPort } from '../config.js';

const dirs = [];
function makeDir(primary, local) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-envfiles-'));
  dirs.push(dir);
  if (primary !== null) fs.writeFileSync(path.join(dir, '.env'), primary);
  if (local !== null) fs.writeFileSync(path.join(dir, '.env.local'), local);
  return dir;
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('mergeEnvFiles', () => {
  it('lets the primary file win over the shell, and the local file only fill gaps', () => {
    const dir = makeDir('APP_PORT=5000\nAPP_X=primary\n', 'APP_PORT=6000\nAPP_X=local\nAPP_Y=local\n');
    const shell = { APP_PORT: '7000', APP_Z: 'shell' };
    const merged = mergeEnvFiles(dir, shell);
    expect(merged).toEqual({ APP_PORT: '5000', APP_X: 'primary', APP_Y: 'local', APP_Z: 'shell' });
    expect(shell).toEqual({ APP_PORT: '7000', APP_Z: 'shell' });
  });

  it('does not let the local file override a shell value, even an empty one', () => {
    const dir = makeDir(null, 'APP_PORT=6000\n');
    expect(mergeEnvFiles(dir, { APP_PORT: '' }).APP_PORT).toBe('');
  });

  it('skips both files for APP_NO_DOTENV=1 and in desktop mode', () => {
    const dir = makeDir('APP_PORT=5000\n', 'APP_Y=local\n');
    expect(mergeEnvFiles(dir, { APP_NO_DOTENV: '1', APP_PORT: '7000' })).toEqual({ APP_NO_DOTENV: '1', APP_PORT: '7000' });
    expect(mergeEnvFiles(dir, { APP_DESKTOP: '1' })).toEqual({ APP_DESKTOP: '1' });
  });

  it('tolerates missing files', () => {
    expect(mergeEnvFiles(makeDir(null, null), { A: '1' })).toEqual({ A: '1' });
  });

  it('feeds the proxy port the way the server would see it', () => {
    const dir = makeDir('APP_PORT= 5000 \n', null);
    expect(resolveDevProxyPort(mergeEnvFiles(dir, { APP_PORT: '7000' }))).toBe(5000);
    const bad = makeDir('APP_PORT=80x\n', null);
    expect(resolveDevProxyPort(mergeEnvFiles(bad, { APP_PORT: '7000' }))).toBe(4321);
  });
});

describe('case-insensitive keys on win32', () => {
  it('does not let the local file add a differently cased key for a set variable', () => {
    const dir = makeDir(null, 'app_port=6000\nAPP_NEW=local\n');
    expect(mergeEnvFiles(dir, { APP_PORT: '7000' }, 'win32')).toEqual({ APP_PORT: '7000', APP_NEW: 'local' });
    expect(envFileAssignments(dir, { APP_PORT: '7000' }, 'win32')).toEqual({ APP_NEW: 'local' });
  });

  it('keeps the case-sensitive behavior elsewhere', () => {
    const dir = makeDir(null, 'app_port=6000\n');
    expect(mergeEnvFiles(dir, { APP_PORT: '7000' }, 'linux')).toEqual({ APP_PORT: '7000', app_port: '6000' });
  });

  it('lets a differently cased primary key replace the shell value under its canonical name', () => {
    const dir = makeDir('app_port=5000\n', null);
    const merged = mergeEnvFiles(dir, { APP_PORT: '7000' }, 'win32');
    expect(merged).toEqual({ APP_PORT: '5000' });
    expect(resolveDevProxyPort(merged)).toBe(5000);
    expect(envFileAssignments(dir, { APP_PORT: '7000' }, 'win32')).toEqual({ APP_PORT: '5000' });
  });

  it('treats a differently cased primary key as a separate key on non-win32', () => {
    const dir = makeDir('app_port=5000\n', null);
    expect(mergeEnvFiles(dir, { APP_PORT: '7000' }, 'linux')).toEqual({ APP_PORT: '7000', app_port: '5000' });
  });

  it('blocks the local file when the primary file set the key in another case', () => {
    const dir = makeDir('app_x=primary\n', 'APP_X=local\n');
    expect(envFileAssignments(dir, {}, 'win32')).toEqual({ app_x: 'primary' });
  });
});

describe('envFileAssignments', () => {
  it('returns only the keys that came from the files', () => {
    const dir = makeDir('APP_A=1\n', 'APP_B=2\nAPP_C=3\n');
    expect(envFileAssignments(dir, { APP_C: 'shell', PATH: 'x' }, 'linux')).toEqual({ APP_A: '1', APP_B: '2' });
  });

  it('is empty when both files are skipped', () => {
    const dir = makeDir('APP_A=1\n', 'APP_B=2\n');
    expect(envFileAssignments(dir, { APP_NO_DOTENV: '1' }, 'win32')).toEqual({});
    expect(envFileAssignments(dir, { APP_DESKTOP: '1' }, 'win32')).toEqual({});
  });
});
