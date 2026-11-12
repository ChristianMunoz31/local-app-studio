// esbuild settings shared by the sidecar bundle and the backup worker bundle, and the second esbuild
// pass that turns server/backup/worker/backupWorker.js into one CJS source string. The sidecar embeds
// that string (define __APP_BACKUP_WORKER_SRC__) and server/backup/worker/client.js starts it with
// new Worker(src, { eval: true }), because inside a Node SEA there is no worker file on disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { CHANNELS, DEV_VERSION_RE, resolveBuildChannel } from '../../server/channel.js';
import { BUILD_INFO_FILE } from '../../server/license/constants.js';
import { loadBuildInfo } from '../../server/license/buildInfo.js';
import { resolveBuildCloudAi } from '../../server/buildFeatures.js';
import { APP_MODES } from '../../server/appMode.js';
import { cloudProviderPlugin } from './cloudBuild.js';
import { resolveProDir } from '../lib/proDir.js';
import { proSeamEsbuildPlugin } from '../lib/proSeam.js';
import { studioServerPlugin } from './modeBuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKER_ENTRY = path.join(ROOT, 'server', 'backup', 'worker', 'backupWorker.js');

/** App version from package.json (the bundle bakes it in). */
export function readAppVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

/**
 * The build date the build-info writer produced (dist/local-app-studio-build-info.json), baked into the bundle so a
 * user-editable dist file cannot move the desktop build date.
 * @param {string} [distDir]
 * @returns {string} ISO build date
 * @throws {Error} when the file is missing or invalid
 */
export function readBundledBuildDate(distDir = path.join(ROOT, 'dist')) {
  const info = loadBuildInfo({ distDir, bundled: undefined });
  if (info.buildDateIso === null) {
    throw new Error(`${BUILD_INFO_FILE} is missing or invalid in ${distDir}: run npm run build first`);
  }
  return info.buildDateIso;
}

/** First characters of the channel marker comment at the top of every sidecar bundle. */
export const CHANNEL_MARKER_PREFIX = '/*! APP_CHANNEL=';

/**
 * The marker line scripts/checks/channelMarker.js reads back from a bundle.
 * @param {'stable' | 'dev'} channel
 * @returns {string}
 */
export function channelBanner(channel) {
  assertChannel(channel);
  return `${CHANNEL_MARKER_PREFIX}${channel} */\n`;
}

function assertChannel(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel "${String(channel)}": expected one of ${CHANNELS.join(', ')}`);
}

/**
 * esbuild defines. import.meta does not exist in CJS: it is pointed at the bundle (or exe) location so
 * the few fileURLToPath(new URL(..., import.meta.url)) call sites still resolve (env overrides win).
 * The channel is always baked in, so the shell environment cannot switch a stable sidecar to dev.
 * @param {string} version display version baked into the bundle
 * @param {{ channel?: 'stable' | 'dev', buildDate?: string, cloudAi?: 'on' | 'off', appMode?: 'studio' | 'runtime', appSpecJson?: string | null }} [opts]
 *   `buildDate` (ISO) is baked in as `__APP_BUILD_DATE__`; `cloudAi` as `__APP_CLOUD_AI__` (server/buildFeatures.js);
 *   `appMode` as `__APP_MODE__` and `appSpecJson` (the baked spec as JSON text, `null` in studio mode) as
 *   `__APP_SPEC_JSON__`, a string literal holding JSON text (`"null"` when there is no spec), see server/appMode.js
 * @returns {Record<string, string>}
 * @throws {Error} on an unknown channel, cloud AI mode or app mode
 */
export const bundleDefine = (version, { channel = 'stable', buildDate, cloudAi = 'on', appMode = 'studio', appSpecJson = null } = {}) => {
  assertChannel(channel);
  if (!APP_MODES.includes(appMode)) throw new Error(`Unknown app mode "${String(appMode)}": expected one of ${APP_MODES.join(', ')}`);
  const cloud = resolveBuildCloudAi({ APP_CLOUD_AI: cloudAi }, 'cloudAi');
  return {
    ...(buildDate === undefined ? {} : { __APP_BUILD_DATE__: JSON.stringify(buildDate) }),
    'import.meta.url': '__importMetaUrl',
    __APP_APP_VERSION__: JSON.stringify(version),
    // Consumed by server/license/channelSeam.js (docs/LICENSING.md, 'Test purchases and the Dev channel').
    __APP_RELEASE_BUILD__: 'true',
    __APP_CHANNEL__: JSON.stringify(channel),
    // Consumed by server/buildFeatures.js: the bundle itself decides whether a cloud provider is in it.
    __APP_CLOUD_AI__: JSON.stringify(cloud),
    // Consumed by server/appMode.js and the phase 2 spec modules: the bundle decides its own mode and carries its spec.
    __APP_MODE__: JSON.stringify(appMode),
    __APP_SPEC_JSON__: JSON.stringify(appMode === 'runtime' && appSpecJson ? appSpecJson : 'null'),
  };
};

/**
 * Resolves the channel and the version baked into the bundle.
 * @param {{ channel: string | null, displayVersion: string | null, packageVersion: string }} opts
 * @returns {{ channel: 'stable' | 'dev', version: string }}
 */
export function resolveChannelBuild({ channel, displayVersion, packageVersion }) {
  const resolved = resolveBuildChannel({ APP_CHANNEL: channel ?? '' }, '--channel');
  const display = (displayVersion ?? '').trim();
  if (resolved === 'stable') {
    if (display) throw new Error('--display-version is only for a dev build; a stable build uses the package.json version');
    return { channel: 'stable', version: packageVersion };
  }
  if (!DEV_VERSION_RE.test(display)) {
    throw new Error('A dev build needs --display-version (or APP_DISPLAY_VERSION) like 0.2.0-dev.20261005.abc1234');
  }
  return { channel: 'dev', version: display };
}

export const BUNDLE_BANNER =
  "var __importMetaUrl = require('node:url').pathToFileURL(typeof __filename === 'string' ? __filename : process.execPath).href;\n" +
  // node:sqlite prints an ExperimentalWarning; drop only that one, keep every other warning.
  "process.removeAllListeners('warning');process.on('warning',function(w){if(w&&w.name==='ExperimentalWarning'&&/SQLite/i.test(w.message))return;console.error(w&&w.stack?w.stack:String(w));});";

/**
 * Bundles the backup worker entry to a single CJS source string (nothing is written to disk).
 * @param {{ minify?: boolean, channel?: 'stable' | 'dev', version?: string, buildDate?: string, cloudAi?: 'on' | 'off', appMode?: 'studio' | 'runtime', appSpecJson?: string | null, proDir?: { mode: 'pro' | 'public', dir: string | null } }} [opts]
 *   `proDir` is the resolved pro folder (scripts/lib/proDir.js), read from APP_PRO_DIR when not given
 * @returns {Promise<string>}
 */
export async function buildBackupWorkerSource({ minify = false, channel = 'stable', version = readAppVersion(), buildDate, cloudAi = 'on', appMode = 'studio', appSpecJson = null, proDir = resolveProDir(process.env) } = {}) {
  const result = await build({
    entryPoints: [WORKER_ENTRY],
    write: false,
    outfile: path.join(ROOT, '.sidecar-build', 'backupWorker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    minify,
    legalComments: 'none',
    logLevel: 'warning',
    define: bundleDefine(version, { channel, buildDate, cloudAi, appMode, appSpecJson }),
    plugins: [cloudProviderPlugin(cloudAi), proSeamEsbuildPlugin(proDir), studioServerPlugin(appMode)],
    // fflate's browser build: same zipSync, without the Node entry's bare require('module') and worker setup.
    alias: { fflate: 'fflate/browser' },
    banner: { js: channelBanner(channel) + BUNDLE_BANNER },
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('backup worker bundle produced no output');
  return out.text;
}
