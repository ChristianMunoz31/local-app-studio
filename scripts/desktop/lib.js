// Shared helpers for the desktop build scripts.
import { execFileSync, spawnSync } from 'node:child_process';
import nodeFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as channelMarkerMain } from '../checks/channelMarker.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAURI_CLI = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/**
 * Rust host target triple from `rustc -vV`, e.g. aarch64-pc-windows-msvc.
 * @returns {string}
 */
export function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const m = /^host:\s*(\S+)$/m.exec(out);
  if (!m) throw new Error('Could not read the host target triple from `rustc -vV`');
  return m[1];
}

/**
 * The value of `--target <triple>` / `--target=<triple>` in `argv`, if any.
 * @param {string[]} argv
 * @returns {string | null}
 */
export function targetFromArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') return argv[i + 1] ?? null;
    if (argv[i].startsWith('--target=')) return argv[i].slice('--target='.length);
  }
  return null;
}

/**
 * Fails clearly when asked for a target other than the host: the sidecar embeds this machine's
 * node.exe, so a cross-target needs a matching node binary, which CI builds natively instead.
 * @param {string | null} target
 */
export function assertHostTarget(target) {
  if (!target) return;
  const host = hostTriple();
  if (target !== host) {
    throw new Error(
      `Cannot build for ${target} on a ${host} host: the sidecar is a Node SEA built from the local node.exe, ` +
        `so each target must be built natively (CI builds one runner per target). Run this on a ${target} machine.`,
    );
  }
}

export const CONFIG_REFUSED_MESSAGE =
  'The desktop build scripts choose the Tauri config themselves: --config and -c are not accepted. ' +
  'For a Local App Studio Dev build run npm run desktop:build:dev; for a stable build run npm run desktop:build.';

/**
 * True when an argument passes a Tauri config: `--config`, `--config=...`, `-c`, `-c<value>` or `c` inside
 * a short-flag cluster such as `-dc`. A short flag that takes a value (t, b, r, f) ends the cluster.
 * @param {string} arg
 * @returns {boolean}
 */
export function isConfigFlag(arg) {
  if (arg === '--config' || arg.startsWith('--config=')) return true;
  if (!/^-[A-Za-z]/.test(arg)) return false;
  for (const ch of arg.slice(1)) {
    if (ch === 'c') return true;
    if ('tbrf'.includes(ch)) return false;
  }
  return false;
}

/**
 * A passthrough must not carry its own Tauri config: it could swap the identifier, the sidecar or the
 * channel the script just verified.
 * @param {string[]} argv
 * @throws {Error} CONFIG_REFUSED_MESSAGE
 */
export function assertNoConfigFlag(argv) {
  if (argv.some(isConfigFlag)) throw new Error(CONFIG_REFUSED_MESSAGE);
}

/**
 * Path of the sidecar executable `buildSidecar.js` copies for `channel` and the host (or given) triple.
 * @param {'stable' | 'dev'} channel
 * @param {string} [triple]
 * @returns {string}
 */
export function sidecarBinaryPath(channel, triple = hostTriple()) {
  const base = channel === 'dev' ? 'local-app-studio-dev-server' : 'local-app-studio-server';
  return path.join(ROOT, 'src-tauri', 'binaries', `${base}-${triple}${triple.includes('windows') ? '.exe' : ''}`);
}

export const STAND_IN_TEXT = 'Stand-in for tauri dev. Run npm run desktop:sidecar to build the real sidecar.\n';

/**
 * `tauri dev` compiles build.rs, and tauri-build fails when an externalBin or resource path is missing, even though
 * a dev run starts `node server.js` and never uses them. On a fresh checkout nothing has built them yet, so create
 * stand-ins (the same ones desktop-check.yml uses). Existing files are never touched. A stand-in can never ship:
 * desktop:build rebuilds the sidecar first, and assertSidecarChannel refuses a binary without a channel marker.
 * @param {{ root?: string, triple?: string, fsImpl?: typeof import('node:fs') }} [opts]
 * @returns {string[]} the paths created
 */
export function ensureDevStandIns({ root = ROOT, triple, fsImpl } = {}) {
  const fs = fsImpl ?? nodeFs;
  const t = triple ?? hostTriple();
  const created = [];
  const bin = path.join(root, 'src-tauri', 'binaries', `local-app-studio-server-${t}${t.includes('windows') ? '.exe' : ''}`);
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, STAND_IN_TEXT);
    created.push(bin);
  }
  const index = path.join(root, 'src-tauri', 'resources', 'dist', 'index.html');
  if (!fs.existsSync(index)) {
    fs.mkdirSync(path.dirname(index), { recursive: true });
    fs.writeFileSync(index, '<!doctype html><title>stand-in</title>\n');
    created.push(index);
  }
  const migrations = path.join(root, 'src-tauri', 'resources', 'migrations');
  if (!fs.existsSync(migrations)) {
    fs.cpSync(path.join(root, 'server', 'db', 'migrations'), migrations, { recursive: true });
    created.push(migrations);
  }
  return created;
}

/**
 * Last gate before `tauri build`: the bundle and the sidecar executable that will be packaged must both carry
 * the channel marker of `channel`. Throws when either is missing, stale or of the other channel.
 * @param {'stable' | 'dev'} channel
 * @param {{ binary?: string, bundle?: string, run?: typeof channelMarkerMain }} [opts]
 */
export function assertSidecarChannel(
  channel,
  { binary = sidecarBinaryPath(channel), bundle = path.join(ROOT, '.sidecar-build', 'server.cjs'), run = channelMarkerMain } = {},
) {
  const code = run(['--expect', channel, '--bundle', bundle, '--binary', binary]);
  if (code !== 0) throw new Error(`The sidecar is not a ${channel} build; run the sidecar build for the ${channel} channel again.`);
}

/**
 * Runs the project-local Tauri CLI through node (no shell). Exits non-zero on failure.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [env]
 * @returns {void}
 */
export function runTauri(args, env = process.env) {
  const res = spawnSync(process.execPath, [TAURI_CLI, ...args], { cwd: ROOT, env, stdio: 'inherit', shell: false });
  if (res.status !== 0) throw new Error(`tauri ${args.join(' ')} failed (exit ${res.status ?? 'signal'})`);
}
