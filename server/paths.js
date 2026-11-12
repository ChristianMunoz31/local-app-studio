// Per-user data directory (Phase 1 keeps app.db here). APP_DATA_DIR wins;
// otherwise an OS-appropriate location is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getChannel } from './channel.js';

/**
 * Data folder name per platform and channel.
 * @param {'stable' | 'dev'} channel
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function dataFolderName(channel, platform = process.platform) {
  const dev = channel === 'dev';
  if (platform === 'win32' || platform === 'darwin') return dev ? 'Local App Studio Dev' : 'Local App Studio';
  return dev ? 'local-app-studio-dev' : 'local-app-studio';
}

/**
 * Resolve (without creating) the data directory.
 * @param {{ platform?: NodeJS.Platform, env?: Record<string, string | undefined>, home?: string,
 *   channel?: 'stable' | 'dev' }} [opts]
 * @returns {string}
 */
export function resolveDataDir({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  channel = getChannel(env),
} = {}) {
  const override = (env.APP_DATA_DIR || '').trim();
  if (override) return path.resolve(override);
  const folder = dataFolderName(channel, platform);
  if (platform === 'win32') {
    const base = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(base, folder);
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', folder);
  }
  const base = env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share');
  return path.posix.join(base, folder);
}

/**
 * Where the stable Local App Studio keeps its data (the source of "Copy my data from Local App Studio"). Read only by
 * server/backup/stableCopy.js, which runs only in the dev channel. APP_STABLE_DATA_DIR overrides.
 * @param {{ platform?: NodeJS.Platform, env?: Record<string, string | undefined>, home?: string }} [opts]
 * @returns {{ dir: string, overridden: boolean }}
 */
export function resolveStableDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const override = (env.APP_STABLE_DATA_DIR || '').trim();
  if (override) return { dir: path.resolve(override), overridden: true };
  return {
    dir: resolveDataDir({ platform, env: { ...env, APP_DATA_DIR: '' }, home, channel: 'stable' }),
    overridden: false,
  };
}

/**
 * Resolve the data directory and create it (mkdir -p).
 * @param {{ platform?: NodeJS.Platform, env?: Record<string, string | undefined>, home?: string,
 *   mkdir?: (dir: string, opts: { recursive: true, mode: number }) => unknown }} [opts]
 * @returns {string} Absolute path of the data directory.
 */
export function getDataDir({ mkdir = fs.mkdirSync, ...rest } = {}) {
  const dir = resolveDataDir(rest);
  mkdir(dir, { recursive: true, mode: 0o700 });
  tightenDirMode(dir, rest.platform ?? process.platform);
  return dir;
}

/**
 * Best-effort chmod of a file (POSIX only; no-op on win32). Never throws.
 * @param {string} file
 * @param {number} mode
 */
export function chmodBestEffort(file, mode) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(file, mode);
  } catch {
    // missing file or not owned by us
  }
}

// mkdir's mode only applies to directories it creates; tighten a pre-existing one we own.
function tightenDirMode(dir, platform) {
  if (platform === 'win32' || process.platform === 'win32') return;
  try {
    const st = fs.statSync(dir);
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return;
    if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
  } catch {
    // best effort (injected mkdir in tests may not create a real directory)
  }
}
