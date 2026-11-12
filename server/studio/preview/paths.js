// Where preview scratch folders live. Never inside the repo or the user's real data folder.
import os from 'node:os';
import path from 'node:path';
import { getChannel } from '../../channel.js';
import { dataFolderName, resolveDataDir } from '../../paths.js';
import { UUID_RE } from '../http.js';

/**
 * Root of all preview scratch folders. Order: APP_PREVIEW_DIR (absolute); under Vitest `${APP_TEST_DATA_DIR}-preview`;
 * `${APP_DATA_DIR}-preview` when APP_DATA_DIR is set (a sibling of the data folder); on win32
 * `%LOCALAPPDATA%\<data folder name>\preview`; else `${resolveDataDir()}-preview`.
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function previewRoot(env = process.env, platform = process.platform) {
  const override = (env.APP_PREVIEW_DIR || '').trim();
  if (override && path.isAbsolute(override)) return path.resolve(override);
  const testDir = (env.APP_TEST_DATA_DIR || '').trim();
  if (env.VITEST && testDir) return `${path.resolve(testDir)}-preview`;
  const dataDir = (env.APP_DATA_DIR || '').trim();
  if (dataDir) return `${path.resolve(dataDir)}-preview`;
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local');
    return path.win32.join(base, dataFolderName(getChannel(env), platform), 'preview');
  }
  return `${resolveDataDir({ platform, env })}-preview`;
}

/**
 * `<root>/<appId>`.
 * @param {string} root
 * @param {string} appId
 * @throws {TypeError} unless appId is a UUID (never a slug or user text in a path)
 */
export function scratchDirFor(root, appId) {
  if (typeof appId !== 'string' || !UUID_RE.test(appId)) throw new TypeError('Invalid app id');
  return path.join(root, appId);
}
