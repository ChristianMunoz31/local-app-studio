// The preview child's environment, built from scratch: never the parent's, so no password, token, Ollama host or
// other APP_* setting reaches it.
import path from 'node:path';
import { getChannel } from '../../channel.js';

const WIN_KEYS = ['SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
const POSIX_KEYS = ['PATH', 'HOME', 'TMPDIR'];
// APP_PRO_DIR picks which build a source-checkout child runs (scripts/lib/proHook.js); a bundled child ignores it.
const COPIED_APP_KEYS = ['APP_MIGRATIONS_DIR', 'APP_DISPLAY_VERSION', 'APP_PRO_DIR'];

/**
 * @param {{ specPath: string, dataDir: string, appMigrationsDir?: string | null,
 *   parentEnv?: Record<string, string | undefined>, platform?: NodeJS.Platform }} opts
 * @returns {Record<string, string>}
 */
export function buildPreviewEnv({ specPath, dataDir, appMigrationsDir = null, parentEnv = process.env, platform = process.platform }) {
  const env = {};
  const win = platform === 'win32';
  const channel = getChannel(parentEnv);
  for (const key of win ? WIN_KEYS : POSIX_KEYS) if (parentEnv[key]) env[key] = parentEnv[key];
  if (win) env.PATH = path.win32.join(parentEnv.SystemRoot || 'C:\\Windows', 'System32');
  Object.assign(env, {
    APP_MODE: 'runtime',
    APP_SPEC_PATH: specPath,
    APP_DATA_DIR: dataDir,
    APP_DESKTOP: '1',
    APP_PREVIEW_CHILD: '1',
    APP_HOST: '127.0.0.1',
    APP_PORT: '0',
    APP_NO_DOTENV: '1',
    APP_SCHEDULER: '0',
    APP_AI: '0',
    APP_SHELL_CHANNEL: channel,
  });
  // A source-checkout child reads its channel from APP_CHANNEL and must agree with APP_SHELL_CHANNEL; a bundled child ignores it.
  if (channel === 'dev') env.APP_CHANNEL = 'dev';
  for (const key of COPIED_APP_KEYS) if (parentEnv[key]) env[key] = parentEnv[key];
  if (appMigrationsDir !== null) env.APP_SPEC_MIGRATIONS_DIR = appMigrationsDir;
  return env;
}
