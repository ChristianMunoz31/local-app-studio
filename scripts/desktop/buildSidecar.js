// Builds the Local App Studio server as a Node Single Executable Application (SEA) sidecar for the desktop
// shell. The bundle entry is server/entry.js (role switch: the same exe is also the document parser child,
// docs/INGEST.md). Flow: esbuild (ESM -> one CJS file) -> SEA blob -> inject into a copy of node.exe ->
// copy to src-tauri/binaries/local-app-studio-server-<target-triple>.exe, plus dist/ and migrations as plain
// resource files (the exe is told where via APP_DIST_DIR / APP_MIGRATIONS_DIR).
//
// Usage: node scripts/desktop/buildSidecar.js [--minify] [--bundle-only] [--no-copy] [--target <host triple>]
//        [--sourcemap] [--node-binary <path>] [--out-triple <name>] [--channel <stable|dev>] [--display-version <v>] [--cloud-ai <on|off>]
// Channel: stable (default; env APP_CHANNEL) or dev. A dev bundle (which accepts store test purchases)
// needs --display-version (env APP_DISPLAY_VERSION, like 0.2.0-dev.20261005.abc1234); a stable bundle
// refuses both. Every bundle starts with a `/*! APP_CHANNEL=<channel> */` marker line.
// Cloud AI: on (default; env APP_CLOUD_AI) or off. An off bundle swaps the cloud provider for a stub
// (scripts/desktop/cloudBuild.js) and is scanned for it before this exits (scripts/checks/cloudMarker.js).
// App mode (ADR-001): runtime when config/app-spec.json exists (or APP_MODE=runtime), else studio. A runtime bundle swaps the
// Studio server seams for stubs (scripts/desktop/modeBuild.js) and carries the baked spec; the build fails if Studio code is still in it.
// The SEA embeds the local node binary, so only the host target works; any other --target fails clearly.
// CI-only escape hatch for macOS universal builds: --node-binary injects the (host-independent) blob into
// another arch's official node binary, and --out-triple names the copied file (for example x86_64-apple-darwin).
// On Windows the exe is `local-app-studio-server-<triple>.exe`; on macOS and Linux it has no extension. The dev channel
// gets its own name, `local-app-studio-dev-server-<triple>`, so Local App Studio and Local App Studio Dev never share a sidecar binary (a Linux
// package installs it next to the app exe). Every copied exe is scanned for its channel marker before this exits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';
import { assertHostTarget, hostTriple, targetFromArgs } from './lib.js';
import { checkBinaryChannel } from '../checks/channelMarker.js';
import { checkDistDir, checkServerArtifact } from '../checks/cloudMarker.js';
import { resolveBuildCloudAi } from '../../server/buildFeatures.js';
import { cloudProviderPlugin } from './cloudBuild.js';
import { dedupePackagesPlugin } from './dedupePackages.js';
import { resolveProDir } from '../lib/proDir.js';
import { proSeamEsbuildPlugin } from '../lib/proSeam.js';
import { readBakedSpecJson, resolveBuildAppMode, studioServerPlugin } from './modeBuild.js';
import { BUNDLE_BANNER, buildBackupWorkerSource, bundleDefine, channelBanner, readBundledBuildDate, resolveChannelBuild } from './workerBundle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, '.sidecar-build');
const BUNDLE = path.join(OUT_DIR, 'server.cjs');
const BLOB = path.join(OUT_DIR, 'sea-prep.blob');
const SEA_CONFIG = path.join(OUT_DIR, 'sea-config.json');
const IS_WIN = process.platform === 'win32';
const EXE = path.join(OUT_DIR, IS_WIN ? 'local-app-studio-server.exe' : 'local-app-studio-server');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const TAURI_DIR = path.join(ROOT, 'src-tauri');

const args = new Set(process.argv.slice(2));
const minify = args.has('--minify');
// Dev builds only (buildDev.js): inline source maps so stack traces name real files. Never in the shipped installer or the budget build.
const sourcemap = args.has('--sourcemap');

/** Value following `--flag <value>` in argv, or null. */
function flagValue(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}
const nodeBinary = flagValue('--node-binary') ?? process.execPath;
const outTriple = flagValue('--out-triple');
assertHostTarget(targetFromArgs(process.argv.slice(2)));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const channelBuild = resolveChannelBuild({
  channel: flagValue('--channel') ?? process.env.APP_CHANNEL ?? null,
  displayVersion: flagValue('--display-version') ?? process.env.APP_DISPLAY_VERSION ?? null,
  packageVersion: pkg.version,
});

// APP_PRO_DIR (scripts/lib/proDir.js): a pro build swaps each seam stub for its twin under pro/; a public build keeps the stubs.
const proDir = resolveProDir(process.env);
const cloudFlag = flagValue('--cloud-ai');
const cloudAi = cloudFlag === null ? resolveBuildCloudAi(process.env, 'APP_CLOUD_AI', proDir) : resolveBuildCloudAi({ APP_CLOUD_AI: cloudFlag }, '--cloud-ai', proDir);
const cloudExpect = cloudAi === 'on' ? 'present' : 'absent';

const appMode = resolveBuildAppMode(process.env, ROOT);
const appSpecJson = appMode === 'runtime' ? readBakedSpecJson(ROOT) : null;

/** @param {string} label @param {string[]} problems */
function assertNoCloudProblems(label, problems) {
  if (problems.length > 0) throw new Error(`${label}: ${problems.join('; ')}`);
}

/** True when this Node has the one-step `--build-sea` flag (Node 25.5+). */
function supportsBuildSea() {
  try {
    return /--build-sea/.test(execFileSync(process.execPath, ['--help'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

async function bundle() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Second esbuild pass: the backup worker as a source string, embedded in the main bundle because a
  // SEA has no worker file on disk (see server/backup/worker/client.js).
  // Fails the bundle when dist/local-app-studio-build-info.json is missing or invalid (run npm run build first).
  const buildDate = readBundledBuildDate(path.join(ROOT, 'dist'));
  const workerSource = await buildBackupWorkerSource({ minify, channel: channelBuild.channel, version: channelBuild.version, buildDate, cloudAi, appMode, appSpecJson, proDir });
  return build({
    entryPoints: [path.join(ROOT, 'server', 'entry.js')],
    outfile: BUNDLE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    minify,
    metafile: true,
    legalComments: 'none',
    logLevel: 'warning',
    ...(sourcemap ? { sourcemap: 'inline' } : {}),
    define: {
      __APP_SOURCEMAPS__: sourcemap ? 'true' : 'false',
      ...bundleDefine(channelBuild.version, { channel: channelBuild.channel, buildDate, cloudAi, appMode, appSpecJson }),
      __APP_BACKUP_WORKER_SRC__: JSON.stringify(workerSource),
    },
    banner: { js: channelBanner(channelBuild.channel) + BUNDLE_BANNER },
    plugins: [cloudProviderPlugin(cloudAi), proSeamEsbuildPlugin(proDir), studioServerPlugin(appMode), dedupePackagesPlugin()],
  });
}

function buildSea() {
  const config = {
    main: BUNDLE,
    output: BLOB,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
  fs.writeFileSync(SEA_CONFIG, JSON.stringify(config, null, 2));
  if (nodeBinary === process.execPath && supportsBuildSea()) {
    fs.writeFileSync(SEA_CONFIG, JSON.stringify({ ...config, output: EXE }, null, 2));
    execFileSync(process.execPath, ['--build-sea', SEA_CONFIG], { stdio: 'inherit' });
    return Promise.resolve();
  }
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], { stdio: 'inherit' });
  fs.copyFileSync(nodeBinary, EXE);
  fs.chmodSync(EXE, 0o755);
  const isMac = process.platform === 'darwin';
  // The official macOS node binary is signed; injecting invalidates that, so strip it and ad-hoc sign again.
  if (isMac) execFileSync('codesign', ['--remove-signature', EXE], { stdio: 'inherit' });
  return inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(BLOB), {
    sentinelFuse: SENTINEL,
    ...(isMac ? { machoSegmentName: 'NODE_SEA' } : {}),
  }).then(() => {
    if (isMac) execFileSync('codesign', ['--sign', '-', EXE], { stdio: 'inherit' });
  });
}

function copyTree(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function copyToTauri() {
  const triple = outTriple ?? hostTriple();
  const binDir = path.join(TAURI_DIR, 'binaries');
  fs.mkdirSync(binDir, { recursive: true });
  const base = channelBuild.channel === 'dev' ? 'local-app-studio-dev-server' : 'local-app-studio-server';
  const target = path.join(binDir, `${base}-${triple}${triple.includes('windows') ? '.exe' : ''}`);
  fs.copyFileSync(EXE, target);
  const problems = checkBinaryChannel(fs.readFileSync(target), channelBuild.channel);
  if (problems.length > 0) throw new Error(`${path.basename(target)}: ${problems.join('; ')}`);
  assertNoCloudProblems(path.basename(target), checkServerArtifact(fs.readFileSync(target), cloudExpect));
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('dist/index.html is missing: run `npm run build` first');
  }
  assertNoCloudProblems('dist/', checkDistDir(distDir, cloudExpect));
  copyTree(distDir, path.join(TAURI_DIR, 'resources', 'dist'));
  copyTree(path.join(ROOT, 'server', 'db', 'migrations'), path.join(TAURI_DIR, 'resources', 'migrations'));
  return target;
}

const kb = (file) => `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;

const bundleResult = await bundle();
// The esbuild metafile, for the per-module size table check:sidecar prints (scripts/checks/sidecarBudget.js).
fs.writeFileSync(path.join(OUT_DIR, 'metafile.json'), JSON.stringify(bundleResult.metafile));
// The mode this bundle bakes in, for check:sidecar (scripts/checks/sidecarBudget.js) to compare with the mode it is asked to check.
fs.writeFileSync(path.join(OUT_DIR, 'bundle-meta.json'), `${JSON.stringify({ appMode })}\n`);
assertNoCloudProblems(path.basename(BUNDLE), checkServerArtifact(fs.readFileSync(BUNDLE), cloudExpect));
console.log(`channel: ${channelBuild.channel}, version ${channelBuild.version}`);
console.log(`cloud AI: ${cloudAi}`);
console.log(`app mode: ${appMode}`);
console.log(`bundle: ${BUNDLE} (${kb(BUNDLE)})`);
if (!args.has('--bundle-only')) {
  await buildSea();
  assertNoCloudProblems(path.basename(EXE), checkServerArtifact(fs.readFileSync(EXE), cloudExpect));
  console.log(`sea exe: ${EXE} (${kb(EXE)})`);
  if (!args.has('--no-copy')) console.log(`copied: ${copyToTauri()}`);
}
