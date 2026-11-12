// Parent side of the document parser: runs each parse in a child process (server/ingest/parserChild.js) so a native
// crash (Burrow issue #67) can only cost that child. The child gets the document bytes on stdin and nothing else:
// an empty environment (minimalChildEnv: nothing from the parent except the Windows machine constants libuv keeps
// supplying, SYSTEMROOT among them; docs/INGEST.md), a fixed working directory (the folder of the running executable,
// not derived from the environment), no file handles (stdio is three pipes), no data folder. One parse at a time (single slot, FIFO, bounded queue), a wall-clock
// timeout, a V8 heap cap, size caps on stdin, stdout and stderr, and an AbortSignal that kills the child.
//
// Every outcome is a plain object, this module never rejects:
//   { ok: true, kind, pages, meta }                      the contract in docs/INGEST.md
//   { ok: false, code, message }  code: unsupported | encrypted | empty | parse_failed   (from the child)
//                                       too_large | doc_busy | doc_timeout | doc_crashed | doc_unavailable | aborted
// `message` is always the fixed text from limits.js. Library and OS error text, and the child's stderr, never
// leave this module (stderr goes only to the optional onDiagnostic hook).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import { CONTENT_CODES, KINDS, LIMITS, failure } from './limits.js';

/**
 * How to start the parser child.
 * @typedef {object} SpawnSpec
 * @property {string} command
 * @property {string[]} args
 * @property {Record<string, string>} [env] extra variables on top of minimalChildEnv() (none by default)
 */

/**
 * Default spawn spec. A source checkout runs `node [--max-old-space-size] server/entry.js --role parser`; inside a
 * Node SEA the executable runs itself with `--role parser` (the SEA has no script file on disk). The heap cap
 * in a SEA travels in NODE_OPTIONS, see docs/INGEST.md for the verification.
 * @param {{ heapMb: number, sea?: boolean, execPath?: string }} opts `sea` and `execPath` force the SEA branch (the
 *   smoke script and tests point execPath at the built sidecar exe)
 * @returns {SpawnSpec}
 */
export function defaultSpawnSpec({ heapMb, sea = isSea(), execPath = process.execPath }) {
  if (sea) {
    return { command: execPath, args: ['--role', 'parser'], env: { NODE_OPTIONS: `--max-old-space-size=${heapMb}` } };
  }
  const entry = fileURLToPath(new URL('../entry.js', import.meta.url));
  return { command: execPath, args: [`--max-old-space-size=${heapMb}`, entry, '--role', 'parser'] };
}

// On Windows, libuv adds these variables to every child that does not set them, copying the PARENT's values (an
// `env: {}` child still sees the parent's PATH, USERNAME, USERPROFILE and TEMP; checked on Windows 11 ARM64, Node 24).
// None is a secret, but they are paths and a user name the parser has no use for, so they are set to empty strings
// here. SYSTEMROOT, WINDIR, SYSTEMDRIVE and PROCESSOR_ARCHITECTURE are machine constants libuv and Windows keep
// supplying. The real parse, with these blanked, works on Windows ARM64 (docs/INGEST.md).
const WINDOWS_BLANKED = Object.freeze(['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE']);

/**
 * The environment every parser child starts with: nothing, except the Windows baseline set to empty strings.
 * @param {NodeJS.Platform} [platform]
 * @returns {Record<string, string>}
 */
export function minimalChildEnv(platform = process.platform) {
  return platform === 'win32' ? Object.fromEntries(WINDOWS_BLANKED.map((k) => [k, ''])) : {};
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function validRun(r) {
  return isObject(r) && isFiniteNumber(r.x) && isFiniteNumber(r.y) && isFiniteNumber(r.w) && isFiniteNumber(r.h) && typeof r.text === 'string';
}

const isOffset = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;

function validPage(p, kind) {
  if (!isObject(p) || typeof p.text !== 'string') return false;
  if (kind === 'pdf') {
    if (!Number.isSafeInteger(p.page) || p.page < 1 || !Array.isArray(p.runs) || !p.runs.every(validRun)) return false;
    return ['width', 'height', 'rotation'].every((k) => p[k] === undefined || isFiniteNumber(p[k]));
  }
  if (p.page !== null) return false;
  if (p.paragraphs === undefined) return true;
  const max = p.text.length;
  return (
    Array.isArray(p.paragraphs) &&
    p.paragraphs.every((x) => isObject(x) && isOffset(x.index, LIMITS.maxChars) && isOffset(x.start, max) && isOffset(x.end, max) && x.start <= x.end)
  );
}

/**
 * Validates and rebuilds a child answer. Unknown fields are dropped, the message is replaced by the fixed text.
 * @param {unknown} raw parsed JSON from the child
 * @returns {object | null} the clean result, or null when the shape is wrong
 */
export function validateChildResult(raw) {
  if (!isObject(raw)) return null;
  if (raw.ok === false) return CONTENT_CODES.includes(raw.code) ? failure(raw.code) : null;
  if (raw.ok !== true || !KINDS.includes(raw.kind) || !Array.isArray(raw.pages) || raw.pages.length > LIMITS.maxPages) return null;
  if (raw.kind !== 'pdf' && raw.pages.length !== 1) return null;
  if (raw.pages.length === 0 || !raw.pages.every((p) => validPage(p, raw.kind))) return null;
  const m = raw.meta;
  if (!isObject(m) || typeof m.paginated !== 'boolean' || typeof m.truncated !== 'boolean') return null;
  if (raw.kind === 'pdf') {
    // A PDF reports its real page count (at least the pages returned); every other kind has no pages.
    if (!Number.isSafeInteger(m.pageCount) || m.pageCount < raw.pages.length) return null;
  } else if (m.pageCount !== null) return null;
  if ((raw.kind === 'pdf') !== m.paginated) return null;
  // Totals the parsers enforce themselves; a child that exceeds them is not trusted.
  let chars = 0;
  let runs = 0;
  for (const p of raw.pages) {
    chars += p.text.length;
    runs += p.runs?.length ?? 0;
  }
  if (chars > LIMITS.maxChars || runs > LIMITS.maxRuns) return null;
  const pages = raw.pages.map((p) => {
    const out = { page: p.page, text: p.text };
    for (const k of ['runs', 'width', 'height', 'rotation', 'paragraphs']) if (p[k] !== undefined) out[k] = p[k];
    return out;
  });
  const meta = { pageCount: m.pageCount, paginated: m.paginated, truncated: m.truncated };
  if (typeof m.producer === 'string') meta.producer = m.producer;
  if (typeof m.title === 'string') meta.title = m.title;
  if (Number.isSafeInteger(m.unreadablePages)) meta.unreadablePages = m.unreadablePages;
  return { ok: true, kind: raw.kind, pages, meta };
}

/**
 * Creates a parse host with its own queue. The shared instance used by the app is in index.js.
 * @param {object} [opts] every option has a production default; tests pass fakes
 * @param {() => SpawnSpec} [opts.spawnSpec] how to start the child (default: defaultSpawnSpec)
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.heapMb]
 * @param {number} [opts.maxQueued] jobs waiting for the slot; one more is answered doc_busy
 * @param {number} [opts.maxInputBytes]
 * @param {number} [opts.maxStdoutBytes]
 * @param {number} [opts.maxStderrBytes] stderr kept for the hook, counted in characters (not bytes)
 * @param {number} [opts.killGraceMs] after SIGKILL, how long to wait for the child's 'close' before the pipes are
 *   destroyed and the job is answered anyway (a descendant holding a pipe, or a kill that failed, must not hold the slot)
 * @param {typeof spawn} [opts.spawn] replaces child_process.spawn (tests)
 * @param {(info: { code: string, exitCode: number | null, signal: string | null, stderr: string }) => void} [opts.onDiagnostic]
 *   Called when a child failed (doc_crashed, doc_timeout, doc_unavailable). stderr is capped; keep it out of HTTP responses.
 * @returns {{ run: (bytes: Uint8Array, kind: string, opts?: { signal?: AbortSignal }) => Promise<object>, queued: () => number, busy: () => boolean }}
 */
export function createParserHost(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? LIMITS.timeoutMs;
  const heapMb = opts.heapMb ?? LIMITS.heapMb;
  const maxQueued = opts.maxQueued ?? LIMITS.maxQueued;
  const maxInputBytes = opts.maxInputBytes ?? LIMITS.maxInputBytes;
  const maxStdoutBytes = opts.maxStdoutBytes ?? LIMITS.maxStdoutBytes;
  const maxStderrBytes = opts.maxStderrBytes ?? LIMITS.maxStderrBytes;
  const getSpec = opts.spawnSpec ?? (() => defaultSpawnSpec({ heapMb }));
  const killGraceMs = opts.killGraceMs ?? LIMITS.killGraceMs;
  const spawnChild = opts.spawn ?? spawn;
  const onDiagnostic = opts.onDiagnostic ?? (() => {});
  // A throwing hook must never escape an event handler or hold the slot: callers resolve first, then report.
  const report = (info) => {
    try {
      onDiagnostic(info);
    } catch {
      // Diagnostics are best effort.
    }
  };

  /** @type {{ bytes: Uint8Array, kind: string, signal?: AbortSignal, resolve: (r: object) => void, onAbort: () => void }[]} */
  const queue = [];
  let busy = false;

  /** Starts the child for one job and resolves with the outcome once the process is fully closed. */
  function execute(job) {
    return new Promise((resolveOnce) => {
      let settled = false;
      const resolve = (result) => {
        if (settled) return;
        settled = true;
        resolveOnce(result);
      };
      let child;
      try {
        const spec = getSpec();
        child = spawnChild(spec.command, spec.args, {
          env: { ...minimalChildEnv(), ...(spec.env ?? {}) },
          // Not the parent's working directory (it can come from the environment): the folder of the running executable.
          cwd: path.dirname(process.execPath),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        resolve(failure('doc_unavailable'));
        return report({ code: 'doc_unavailable', exitCode: null, signal: null, stderr: '' });
      }
      let verdict = null; // set when the host decides the outcome before the child answers
      let outChunks = [];
      let outBytes = 0;
      let errText = '';
      let graceTimer = null;
      // Answers with the host's verdict (timeout, abort, oversized output) and reports it.
      const answerVerdict = (exitCode, signal) => {
        clearTimeout(timer);
        clearTimeout(graceTimer);
        job.signal?.removeEventListener('abort', onAbort);
        resolve(failure(verdict));
        if (verdict !== 'aborted') report({ code: verdict, exitCode, signal, stderr: errText });
      };
      const kill = (code) => {
        verdict ??= code;
        try {
          child.kill('SIGKILL');
        } catch {
          // A failed kill is covered by the grace timer below.
        }
        // 'close' waits for every stdio pipe to end. If it does not come, free the slot anyway.
        graceTimer ??= setTimeout(() => {
          for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
          answerVerdict(null, null);
        }, killGraceMs);
      };
      const timer = setTimeout(() => kill('doc_timeout'), timeoutMs);
      const onAbort = () => kill('aborted');
      job.signal?.addEventListener('abort', onAbort, { once: true });
      if (job.signal?.aborted) onAbort();

      child.on('error', () => {
        // Spawn failure (ENOENT, EACCES) or a failed kill. Only a failed spawn has no pid.
        if (child.pid !== undefined) return;
        clearTimeout(timer);
        job.signal?.removeEventListener('abort', onAbort);
        resolve(failure('doc_unavailable'));
        report({ code: 'doc_unavailable', exitCode: null, signal: null, stderr: '' });
      });
      child.stdout.on('data', (chunk) => {
        outBytes += chunk.length;
        if (outBytes > maxStdoutBytes) {
          outChunks = [];
          kill('doc_crashed');
          return;
        }
        outChunks.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        if (errText.length < maxStderrBytes) errText += chunk.toString('utf8').slice(0, maxStderrBytes - errText.length);
      });
      // The child may die before reading everything (EPIPE): that is reported through 'close', not here.
      child.stdin.on('error', () => {});
      const header = `${JSON.stringify({ v: 1, kind: job.kind, bytes: job.bytes.length })}\n`;
      child.stdin.write(header);
      child.stdin.end(job.bytes);

      child.on('close', (exitCode, signal) => {
        if (settled) return; // already answered (spawn failure, or the kill grace timer): no second diagnostic
        clearTimeout(timer);
        clearTimeout(graceTimer);
        job.signal?.removeEventListener('abort', onAbort);
        const crashed = () => {
          resolve(failure('doc_crashed'));
          report({ code: 'doc_crashed', exitCode, signal, stderr: errText });
        };
        if (verdict) return answerVerdict(exitCode, signal);
        if (exitCode !== 0 || signal) return crashed();
        let parsed = null;
        try {
          const text = Buffer.concat(outChunks, outBytes).toString('utf8');
          const lines = text.split('\n').filter((l) => l.length > 0);
          if (lines.length === 1) parsed = validateChildResult(JSON.parse(lines[0]));
        } catch {
          parsed = null;
        }
        if (parsed === null) return crashed();
        return resolve(parsed);
      });
    });
  }

  /** Runs queued jobs one after another; the slot is released only after the child process has closed. */
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        job.signal?.removeEventListener('abort', job.onAbort);
        if (job.signal?.aborted) {
          job.resolve(failure('aborted'));
          continue;
        }
        job.resolve(await execute(job));
      }
    } finally {
      busy = false;
    }
  }

  return {
    /**
     * Parses `bytes` in the child. Never rejects.
     * @param {Uint8Array} bytes
     * @param {string} kind 'pdf' | 'docx' | 'text'
     * @param {{ signal?: AbortSignal }} [runOpts]
     * @returns {Promise<object>}
     */
    run(bytes, kind, { signal } = {}) {
      if (signal?.aborted) return Promise.resolve(failure('aborted'));
      if (!KINDS.includes(kind)) return Promise.resolve(failure('unsupported'));
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) return Promise.resolve(failure('empty'));
      if (bytes.length > maxInputBytes) return Promise.resolve(failure('too_large'));
      if (busy && queue.length >= maxQueued) return Promise.resolve(failure('doc_busy'));
      return new Promise((resolve) => {
        const job = {
          bytes,
          kind,
          signal,
          resolve,
          onAbort() {
            const at = queue.indexOf(job);
            if (at === -1) return; // already running: execute() has its own listener
            queue.splice(at, 1);
            resolve(failure('aborted'));
          },
        };
        signal?.addEventListener('abort', job.onAbort, { once: true });
        queue.push(job);
        pump();
      });
    },
    /** Jobs waiting for the slot. */
    queued: () => queue.length,
    /** True while a child is running. */
    busy: () => busy,
  };
}
