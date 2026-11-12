// Starts the built Local App Studio server for one Playwright spec file, in a sandbox that cannot reach the
// real data dir, the real Ollama or the internet.
//
//   const server = await startApp({ seed, ollama, fixedNow, scheduler, firstRun });
//   server.url / dataDir / expectedDataDir / previewDir / previewDbFile(appId) / fake / netlog() / outbound() / envKeys / stop()
//
// Safety, in order of enforcement:
//  1. Every path lives under one fresh temp root (`local-app-studio-e2e-*`), the fake home included, so a
//     server that ignores APP_DATA_DIR still lands in temp (HOME, USERPROFILE, APPDATA,
//     LOCALAPPDATA and XDG_DATA_HOME all point into the fake home).
//  2. The data dir the server will use is computed BEFORE spawn (with the same resolver the server
//     uses) and must pass assertSafeDataDir (inside temp, unrelated to the real data dir).
//  3. After start, the `Data:` line the server prints must be that exact file, else the process is
//     killed and the start fails.
//  4. The child env is a scrubbed allowlist (buildChildEnv): no tokens, no OLLAMA_HOST unless the
//     mode sets it, and a fake Ollama can never be on 11434 (assertAiEnvSafe).
//  5. The serverNetRecorder preload fails every non-loopback connection and every connection to
//     the reserved loopback ports 11434, 4321 and 5174, and logs them.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDataDir } from '../../server/paths.js';
import { previewRoot } from '../../server/studio/preview/paths.js';
import { startFakeOllama } from '../../scripts/lib/fakeOllamaServer.js';
import {
  SandboxSafetyError,
  assertAiEnvSafe,
  assertSafeDataDir,
  assertSafePort,
  assertUnderTmp,
  buildAiEnv,
  buildChildEnv,
  freePort,
  samePath,
} from '../../scripts/lib/sandboxSafety.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPPORT = path.dirname(fileURLToPath(import.meta.url));
const START_TIMEOUT_MS = 30_000;
const OLLAMA_MODES = ['dead', 'fake', 'default'];

const preload = (file) => pathToFileURL(path.join(SUPPORT, file)).href;
// The pro seam hook (scripts/lib/proHook.js): the unbundled server runs the pro twins, or the stubs under APP_PRO_DIR=none.
const PRO_HOOK = pathToFileURL(path.join(REPO_ROOT, 'scripts', 'lib', 'proHook.js')).href;

const REMOVE_DEADLINE_MS = 10_000;
const REMOVE_RETRY_MS = 200;
const REMOVE_RETRY_CODES = ['EPERM', 'EBUSY', 'ENOTEMPTY'];

// Node 24 rmSync ignores maxRetries/retryDelay for EPERM (it fails at once against a short-lived holder, such as
// the preview child's cwd or an indexer), so the retry is done by hand. On final failure the error names what is
// still under the root, because the EPERM message alone names only the temp root.
async function removeTempRoot(target) {
  const deadline = Date.now() + REMOVE_DEADLINE_MS;
  for (;;) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (REMOVE_RETRY_CODES.includes(err?.code) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, REMOVE_RETRY_MS));
        continue;
      }
      if (err instanceof Error && fs.existsSync(target)) {
        try {
          const left = fs.readdirSync(target, { recursive: true }).slice(0, 20);
          err.message += `
Still present under ${target} (first ${left.length}): ${left.join(', ')}`;
        } catch {
          // The listing is a hint only.
        }
      }
      throw err;
    }
  }
}

/**
 * @param {{
 *   seed?: boolean,
 *   ollama?: 'dead' | 'fake' | 'default',
 *   fixedNow?: string | null,
 *   scheduler?: boolean,
 *   firstRun?: boolean,
 *   fakeChat?: (body: object) => unknown,
 * }} [opts] `firstRun` sets no product config at all (no APP_DATA_DIR, APP_HOST,
 *   APP_SCHEDULER or opt-ins; only APP_PORT), so the server uses its per-OS default data dir,
 *   which the fake home turns into a folder inside temp.
 */
export async function startApp({ seed = false, ollama = 'dead', fixedNow = null, scheduler = false, firstRun = false, fakeChat } = {}) {
  if (!OLLAMA_MODES.includes(ollama)) throw new Error(`Unknown ollama mode: ${String(ollama)}`);
  if (firstRun && (seed || fixedNow)) throw new Error('firstRun means an empty data dir and the real clock: no seed, no fixedNow.');
  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ is missing. Run `npm run build` before the e2e tests.');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-e2e-'));
  assertUnderTmp(root);
  const homeDir = path.join(root, 'home');
  const netlogFile = path.join(root, 'netlog.jsonl');
  fs.writeFileSync(netlogFile, '');
  const port = assertSafePort(await freePort());

  /** @type {Awaited<ReturnType<typeof startFakeOllama>> | null} */
  let fake = null;
  let child = null;
  const cleanupAll = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      // On Windows child.kill() ends only the server, never its preview child, which then keeps the scratch
      // data folder locked and the rmSync below fails with EPERM. Ending the whole process tree avoids that.
      if (process.platform === 'win32') {
        spawnSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    await fake?.close();
    await removeTempRoot(assertUnderTmp(root));
  };

  try {
    const extra = { APP_NO_DOTENV: '1', APP_PORT: String(port), APP_E2E_NETLOG: netlogFile };
    let dataDir;
    if (firstRun) {
      // Nothing else: no APP_DATA_DIR, no APP_HOST, no APP_SCHEDULER, no opt-ins.
    } else {
      dataDir = assertSafeDataDir(path.join(root, 'data'));
      fs.mkdirSync(dataDir, { recursive: true });
      extra.APP_DATA_DIR = dataDir;
      extra.APP_HOST = '127.0.0.1';
      if (!scheduler) extra.APP_SCHEDULER = '0';
    }
    if (fixedNow) extra.APP_E2E_FIXED_NOW = fixedNow;

    if (ollama === 'fake') {
      fake = await startFakeOllama({ chat: fakeChat });
      Object.assign(extra, buildAiEnv({ mode: 'fake', fakeUrl: fake.url }));
    } else if (ollama === 'dead') {
      Object.assign(extra, buildAiEnv({ mode: 'none', deadPort: await freePort() }));
    }

    const env = buildChildEnv({ homeDir, extra });
    if (ollama !== 'default') assertAiEnvSafe(ollama === 'fake' ? 'fake' : 'none', env);
    else if (env.OLLAMA_HOST) throw new SandboxSafetyError('The default-Ollama mode must not set OLLAMA_HOST.');

    // The data dir the server will use, computed with the server's own resolver and the child env.
    const expectedDataDir = assertSafeDataDir(resolveDataDir({ env, platform: process.platform, home: homeDir }));
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_DATA_HOME']) {
      assertUnderTmp(env[key]);
    }
    const dbFile = path.join(expectedDataDir, 'app.db');

    if (seed) {
      const args = [path.join(REPO_ROOT, 'scripts', 'seedDemo.js'), '--data-dir', expectedDataDir];
      if (fixedNow) args.push('--now', fixedNow);
      const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, env, stdio: 'pipe', shell: false, encoding: 'utf8' });
      if (res.status !== 0) throw new Error(`Seeding failed (exit ${res.status ?? 'signal'}): ${res.stderr || res.stdout}`);
    }

    const nodeArgs = ['--import', PRO_HOOK, '--import', preload('serverNetRecorder.mjs')];
    if (fixedNow) nodeArgs.push('--import', preload('fixedClock.mjs'));
    nodeArgs.push(path.join(REPO_ROOT, 'server.js'));
    child = spawn(process.execPath, nodeArgs, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });

    const log = [];
    let reportedDb = null;
    await new Promise((resolve, reject) => {
      let gotAddress = false;
      const timer = setTimeout(() => reject(new Error(`The server did not start in ${START_TIMEOUT_MS} ms.\n${log.join('\n')}`)), START_TIMEOUT_MS);
      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        log.push(line);
        if (line.startsWith('Local App Studio running at ')) {
          let reported = null;
          try {
            reported = new URL(line.slice('Local App Studio running at '.length).trim());
          } catch {
            // Falls through to the mismatch error.
          }
          if (!reported || Number(reported.port) !== port) return fail(new SandboxSafetyError(`The server reported a different address: ${line}`));
          gotAddress = true;
        } else if (line.startsWith('Data: ')) {
          reportedDb = line.slice('Data: '.length).trim();
          if (!samePath(reportedDb, dbFile)) return fail(new SandboxSafetyError(`The server reported a different data file than expected (${reportedDb}, expected ${dbFile}).`));
          if (!gotAddress) return fail(new Error('The server printed its data file before its address.'));
          clearTimeout(timer);
          resolve();
        }
        return undefined;
      });
      readline.createInterface({ input: child.stderr }).on('line', (line) => log.push(`stderr: ${line}`));
      child.once('error', (err) => fail(err));
      child.once('exit', (code) => fail(new Error(`The server exited early (code ${code}).\n${log.join('\n')}`)));
    });
    child.removeAllListeners('exit');

    const readNetlog = () =>
      fs
        .readFileSync(netlogFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));

    return {
      url: `http://127.0.0.1:${port}`,
      port,
      dataDir: expectedDataDir,
      reportedDbFile: reportedDb,
      expectedDataDir,
      /** Root of the Preview scratch folders (the same resolver the server uses, with this server's env). */
      previewDir: previewRoot(env, process.platform),
      /** The Preview app.db of one app, to read rows from disk: `<previewDir>/<appId>/data/app.db`. */
      previewDbFile: (appId) => path.join(previewRoot(env, process.platform), appId, 'data', 'app.db'),
      /** Names of the env vars the server was started with (values are never exposed). */
      envKeys: Object.keys(env).sort(),
      fake,
      netlog: readNetlog,
      /** Outbound attempts: everything except the simulated "no Ollama" loopback refusals. */
      outbound: () => readNetlog().filter((e) => e.kind !== 'loopback-reserved'),
      stop: cleanupAll,
    };
  } catch (err) {
    await cleanupAll().catch(() => {});
    throw err;
  }
}
