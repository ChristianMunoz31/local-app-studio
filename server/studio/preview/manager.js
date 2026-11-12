// The preview manager: one child server in runtime mode, started on demand for one app at a time. The child gets a
// built-from-scratch environment, its launch secret on stdin and listens on loopback only; Studio reaches it through
// the allowlisted proxy (proxy.js). The secret and the cookie are never logged or returned.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import { cookieFor, newSecret } from './childAuth.js';
import { buildPreviewEnv } from './childEnv.js';
import { EXIT_PREVIEW_MIGRATION_FAILED } from '../../db/errors.js';
import { previewRoot, scratchDirFor } from './paths.js';
import { prepareScratch, resetScratch } from './scratch.js';
import { hasStamp, seedSample, writeStamp } from './seed.js';
import { readSample } from '../sample.js';

const READY_PREFIX = 'APP_READY ';
const FAILED_START = 'The preview could not start. Try again.';
const FAILED_RUN = 'The preview stopped unexpectedly. Start it again.';
const STOPPED = Object.freeze({ state: 'stopped', appId: null, revision: null, startedAt: null, message: null, data: null });

/** The pro seam hook (scripts/lib/proHook.js) as a file URL, the form `--import` takes on every platform. */
const PRO_HOOK_URL = new URL('../../../scripts/lib/proHook.js', import.meta.url).href;

/**
 * How to start the child: the SEA runs itself with `--role preview` (its build was chosen when it was bundled); a source
 * checkout runs server.js directly and always loads the pro seam hook. The hook reads APP_PRO_DIR, which the child env
 * copies from this server (the hook wrote the decision there when this server started with it, `none` or the folder), so
 * both processes agree on the build. It never depends on how this process was launched (execArgv).
 * @param {{ sea?: boolean, execPath?: string }} [opts]
 * @returns {{ command: string, args: string[] }}
 */
export function defaultPreviewSpawnSpec({ sea = isSea(), execPath = process.execPath } = {}) {
  if (sea) return { command: execPath, args: ['--role', 'preview'] };
  return { command: execPath, args: ['--import', PRO_HOOK_URL, fileURLToPath(new URL('../../../server.js', import.meta.url))] };
}

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/** The app's stored sample records, or null on any failure (a manager test without a database keeps working). */
function safeReadSample(appId) {
  try {
    return readSample(appId);
  } catch {
    return null;
  }
}

/**
 * @param {{ rootDir?: string, spawnSpec?: () => { command: string, args: string[] }, spawn?: typeof nodeSpawn,
 *   startTimeoutMs?: number, stopTimeoutMs?: number, readSample?: (appId: string) => object | null, seed?: typeof seedSample,
 *   now?: () => Date }} [opts]
 */
export function createPreviewManager({
  rootDir = previewRoot(),
  spawnSpec = defaultPreviewSpawnSpec,
  spawn = nodeSpawn,
  startTimeoutMs = 20000,
  stopTimeoutMs = 1500,
  readSample: readSampleFor = safeReadSample,
  seed = seedSample,
  now = () => new Date(),
} = {}) {
  let status = { ...STOPPED };
  /** @type {{ proc: import('node:child_process').ChildProcess, exited: boolean, stopping: boolean, port: number, cookie: string, done: Promise<void> } | null} */
  let current = null;
  let chain = Promise.resolve();
  let inflight = null;
  /** Bumped by stop(): a start queued or running under an older epoch gives up at once. */
  let stopEpoch = 0;
  /** Bumped by start(): a start superseded by a newer one never spawns or writes status. */
  let startGen = 0;
  /** Ends the running start's wait for the ready line (set only while that wait is open). */
  let cancelWait = null;
  /** Every spawned child that has not exited yet, including one being ended by a restart. */
  const live = new Set();

  const setStatus = (patch) => {
    status = { ...status, ...patch };
  };
  const enqueue = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  const killAtExit = () => {
    if (current && !current.exited) current.proc.kill();
  };

  async function endChild(c) {
    if (c.exited) return;
    c.stopping = true;
    try {
      c.proc.stdin.end();
    } catch {
      // stdin already closed
    }
    await Promise.race([c.done, wait(stopTimeoutMs)]);
    if (!c.exited) {
      c.proc.kill();
      await Promise.race([c.done, wait(stopTimeoutMs)]);
    }
  }

  async function stopCurrent() {
    const c = current;
    current = null;
    if (c) await endChild(c);
  }

  async function doStart(app, epoch, gen, opts = {}) {
    if (epoch !== stopEpoch || gen !== startGen) return { ...status };
    await stopCurrent();
    if (epoch !== stopEpoch || gen !== startGen) return { ...status };
    setStatus({ state: 'starting', appId: app.id, revision: app.revision, startedAt: new Date().toISOString(), message: null, data: null });
    // A message the scratch step marked as meant for the user (the database is in use) is kept instead of the generic one.
    const fail = (code, message = FAILED_START) => {
      if (gen !== startGen) return { ...status };
      console.error('Preview failed to start:', code);
      setStatus({ state: 'failed', message });
      return { ...status };
    };
    let secret;
    let proc;
    let prepared;
    try {
      const dir = scratchDirFor(rootDir, app.id);
      prepared = prepareScratch(dir, app.spec, rootDir, { ...opts, deferCommit: true });
      setStatus({ data: prepared.data });
      secret = newSecret();
      const { command, args } = spawnSpec();
      proc = spawn(command, args, {
        cwd: dir,
        env: buildPreviewEnv({ specPath: prepared.specPath, dataDir: prepared.dataDir, appMigrationsDir: prepared.appMigrationsDir }),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      return fail(err?.code ?? err?.name ?? 'unknown', err?.previewUserMessage ? err.message : undefined);
    }
    const c = { proc, exited: false, stopping: false, port: 0, cookie: '', done: null };
    live.add(c);
    c.done = new Promise((resolve) => {
      proc.once('exit', (code) => {
        c.exited = true;
        c.exitCode = code;
        live.delete(c);
        process.removeListener('exit', killAtExit);
        resolve();
      });
    });
    current = c;
    process.on('exit', killAtExit);
    proc.stdin.on('error', () => {});
    proc.stderr.resume();
    proc.stdin.write(`${secret.toString('hex')}\n`);

    let timer;
    const outcome = await new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), startTimeoutMs);
      cancelWait = () => resolve('cancelled');
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (!line.startsWith(READY_PREFIX)) return;
        try {
          const { port } = JSON.parse(line.slice(READY_PREFIX.length));
          if (Number.isInteger(port) && port >= 1 && port <= 65535) {
            c.port = port;
            resolve('ready');
          }
        } catch {
          // not a ready line
        }
      });
      proc.once('error', () => resolve('spawn_error'));
      c.done.then(() => resolve('exited'));
    });
    clearTimeout(timer);
    cancelWait = null;
    if (outcome !== 'ready' || gen !== startGen) {
      if (current === c) current = null;
      await endChild(c);
      // A table update the child reported it could not apply (its migration exit code, not any crash or timeout, so rows
      // are never wiped for another reason): clear the data once and start fresh, then say so.
      if (outcome === 'exited' && c.exitCode === EXIT_PREVIEW_MIGRATION_FAILED && prepared.migrated && gen === startGen && epoch === stopEpoch && !opts.fresh) {
        return doStart(app, epoch, gen, { fresh: true, reason: 'repaired' });
      }
      return outcome === 'cancelled' || gen !== startGen ? { ...status } : fail(outcome);
    }
    try {
      prepared.commit();
    } catch (err) {
      if (current === c) current = null;
      await endChild(c);
      return fail(err?.code ?? 'commit');
    }
    c.cookie = cookieFor(secret);
    c.done.then(() => {
      if (current === c && !c.stopping) {
        current = null;
        setStatus({ state: 'failed', message: FAILED_RUN });
      }
    });
    // An example's sample records go in once per fresh data folder, before the preview is reported as running (the proxy
    // refuses requests while it is starting, so the app mounts only after the rows are there).
    const sample = readSampleFor(app.id);
    if (sample && !hasStamp(prepared.dataDir)) {
      const result = await seed({ port: c.port, cookie: c.cookie, spec: app.spec, sample, today: now(), shouldStop: () => gen !== startGen || epoch !== stopEpoch });
      // A newer start or a stop owns the status now; this folder gets no stamp.
      if (gen !== startGen || epoch !== stopEpoch) return { ...status };
      if (c.exited) return { ...status };
      if (!result.aborted) {
        try {
          writeStamp(prepared.dataDir, result);
        } catch {
          // without the stamp a restart finds rows and skips seeding anyway
        }
      }
      if (result.created > 0) setStatus({ data: { ...prepared.data, seeded: result.created } });
    }
    setStatus({ state: 'running', message: null });
    return { ...status };
  }

  const manager = {
    /** @param {{ id: string, spec: object, revision: number }} app */
    start(app) {
      const key = `${app.id}:${app.revision}`;
      if (inflight && inflight.key === key) return inflight.promise;
      // Visible at once: the old child may take a while to end, and a poll must not see the previous revision as current.
      setStatus({ state: 'starting', appId: app.id, revision: app.revision, startedAt: new Date().toISOString(), message: null });
      const epoch = stopEpoch;
      const gen = (startGen += 1);
      cancelWait?.();
      const entry = { key, promise: enqueue(() => doStart(app, epoch, gen)) };
      inflight = entry;
      const clear = () => {
        if (inflight === entry) inflight = null;
      };
      entry.promise.then(clear, clear);
      return entry.promise;
    },
    stop() {
      const epoch = (stopEpoch += 1);
      inflight = null;
      cancelWait?.();
      // End every child now (by PID) rather than waiting behind an in-flight start.
      for (const c of live) {
        c.stopping = true;
        try {
          c.proc.stdin.end();
        } catch {
          // stdin already closed
        }
        c.proc.kill();
      }
      return enqueue(async () => {
        await stopCurrent();
        if (epoch === stopEpoch) status = { ...STOPPED };
        return { ...status };
      });
    },
    /**
     * Deletes the app's preview data (stops its child first, restarts it fresh when the app has a valid spec). Rejects with
     * code `preview_reset_failed` when the folder cannot be cleared.
     * @param {{ id: string, spec: object | null, revision: number }} app
     */
    resetData(app) {
      const active = status.appId === app.id && (status.state === 'running' || status.state === 'starting');
      let epoch = stopEpoch;
      let gen = startGen;
      if (active) {
        epoch = stopEpoch += 1;
        gen = startGen += 1;
        inflight = null;
        cancelWait?.();
        for (const c of live) {
          c.stopping = true;
          try {
            c.proc.stdin.end();
          } catch {
            // stdin already closed
          }
          c.proc.kill();
        }
        if (app.spec) setStatus({ state: 'starting', appId: app.id, revision: app.revision, startedAt: new Date().toISOString(), message: null, data: null });
      }
      return enqueue(async () => {
        if (active) await stopCurrent();
        try {
          resetScratch(scratchDirFor(rootDir, app.id), rootDir);
        } catch {
          throw Object.assign(new Error('The preview data could not be reset.'), { code: 'preview_reset_failed' });
        }
        if (active && app.spec) return doStart(app, epoch, gen, { fresh: true, reason: 'reset' });
        if (active) status = { ...STOPPED };
        if (status.appId === app.id || active) setStatus({ data: { kept: false, reason: 'reset' } });
        return { ...status };
      });
    },
    status: () => ({ ...status }),
    target: () => (status.state === 'running' && current ? { port: current.port, cookie: current.cookie } : null),
    /** Restarts (not awaited) when the preview is running or starting this app. */
    specSaved(app) {
      if ((status.state === 'running' || status.state === 'starting') && status.appId === app.id) manager.start(app).catch(() => {});
    },
    /** Stops the preview when it runs this app, then removes the app's scratch folder. Never rejects. */
    async appDeleted(appId) {
      try {
        await enqueue(async () => {
          if (status.appId === appId) {
            await stopCurrent();
            status = { ...STOPPED };
          }
          fs.rmSync(scratchDirFor(rootDir, appId), { recursive: true, force: true });
        });
      } catch {
        // the app row is already gone; a leftover scratch folder is harmless
      }
    },
  };
  return manager;
}

let singleton = null;

/** The process-wide manager (lazy, so importing this module spawns nothing). */
export function getPreviewManager() {
  singleton ??= createPreviewManager();
  return singleton;
}
