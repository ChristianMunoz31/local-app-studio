// Environment doctor (phase 15, section 4). One line per check, each Found, Missing or Problem with the one next action.
// Toolchain lines (only in a build with the installer) come from detectToolchain() (the module behind the Build step's tool table) and their names from
// src/studio/lib/toolWords.ts, so the two screens never disagree. Every file system read, memory read, port lookup and
// helper probe goes through an injectable facade or probe, so unit tests spawn nothing and open no port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import { PRO_PARTS } from '../../src/proParts.js';
import { toolName } from '../../src/studio/lib/toolWords.ts';
import { DEFAULT_PORT, VITE_DEV_PORT } from '../config.js';
import { currentOp } from '../backup/lock.js';
import { resolveDataDir } from '../paths.js';
import { redactText } from '../redact.js';
import { detectToolchain, MIN_RUSTC } from '../studio/build/toolchain.js';
import { portHolder } from './ports.js';

const GIB = 1024 ** 3;
const MIN_DISK_BYTES = 5 * GIB;
const MIN_MEMORY_BYTES = 1 * GIB;
const OLLAMA_TIMEOUT_MS = 2000;
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const TOOL_IDS = ['node', 'npm', 'rustc', 'cargo', 'msvc', 'winsdk', 'webview2'];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const STATUS_WORDS = Object.freeze({ found: 'Found', missing: 'Missing', problem: 'Problem' });

/**
 * @typedef {{ id: string, label: string, status: 'found' | 'missing' | 'problem', detail: string, action: string }} DoctorLine
 * @typedef {{ checkedAt: string, lines: DoctorLine[], counts: { found: number, missing: number, problem: number } }} DoctorReport
 * @typedef {{ state: 'ready' | 'down' | 'no_tools_model' | 'remote' | 'off', host: string | null, models: string[], reason?: string }} OllamaState
 */

/**
 * @typedef {object} DoctorFacade
 * @property {Record<string, string | undefined>} env
 * @property {string} platform
 * @property {string} repoRoot
 * @property {() => Date} now
 * @property {boolean} buildTools whether to check the installer's build tools (false in a build without the installer)
 * @property {() => Promise<import('../studio/build/toolchain.js').ToolchainReport>} detectToolchain
 * @property {(port: number) => Promise<import('./ports.js').PortHolder>} portHolder
 * @property {(dir: string) => { bavail: number, bsize: number }} statfs
 * @property {() => number} freemem
 * @property {() => number} totalmem
 * @property {(dir: string) => void} probeWrite writes and deletes `.doctor-<pid>-<time>.tmp` in the folder; throws on failure
 * @property {(dir: string) => string[]} readdir
 */

/** @returns {DoctorFacade} the real machine */
export function defaultDoctorFacade() {
  return {
    env: process.env,
    platform: process.platform,
    repoRoot: REPO_ROOT,
    now: () => new Date(),
    buildTools: PRO_PARTS.installer,
    detectToolchain: () => detectToolchain(),
    portHolder: (port) => portHolder(port),
    statfs: (dir) => fs.statfsSync(dir),
    freemem: () => os.freemem(),
    totalmem: () => os.totalmem(),
    probeWrite(dir) {
      const file = path.join(dir, `.doctor-${process.pid}-${Date.now()}.tmp`);
      fs.writeFileSync(file, 'doctor');
      fs.unlinkSync(file);
    },
    readdir: (dir) => fs.readdirSync(dir),
    restoring: () => currentOp() === 'restore',
  };
}

// The path rules of the machine being described (f.platform), not of the machine running the code; they are the same on a real machine.
export const pathFor = (f) => (f.platform === 'win32' ? path.win32 : path.posix);

const gb = (bytes) => `${(bytes / GIB).toFixed(1)} GB`;
const line = (id, label, status, detail = '', action = '') => ({ id, label, status, detail, action: status === 'found' ? '' : action });

function toolLine(id, item) {
  if (!item) return line(id, id, 'missing', '', 'Check again.');
  const label = toolName(item);
  if (item.status === 'found') {
    const detail = [item.version, item.path].filter((v) => typeof v === 'string' && v !== '').join(', ');
    return line(id, label, 'found', detail);
  }
  if (id === 'rustc' && /^Your Rust is older/.test(item.hint)) {
    return line(id, label, 'problem', `Older than ${MIN_RUSTC}.`, 'Run rustup update stable, then check again.');
  }
  return line(id, label, 'missing', '', item.hint);
}

// The nearest existing folder at or above `dir` (the data folder may not exist before the first run).
function statfsNear(f, dir) {
  let cur = dir;
  for (let i = 0; i < 64; i += 1) {
    try {
      return { stats: f.statfs(cur), at: cur };
    } catch {
      const up = pathFor(f).dirname(cur);
      if (up === cur) return null;
      cur = up;
    }
  }
  return null;
}

export function driveOf(f, dir) {
  const p = pathFor(f);
  const root = p.parse(p.resolve(dir)).root;
  return root.replace(/[\\/]+$/, '') || root;
}

function diskLine(f, dataDir) {
  const found = statfsNear(f, dataDir);
  const drive = driveOf(f, dataDir);
  if (!found) return line('disk', 'Free disk space', 'problem', 'Could not read the free space.', `Check that ${drive} is available, then check again.`);
  const free = Number(found.stats.bavail) * Number(found.stats.bsize);
  if (free >= MIN_DISK_BYTES) return line('disk', 'Free disk space', 'found', `${gb(free)} free on ${drive}`);
  return line('disk', 'Free disk space', 'problem', `${gb(free)} free on ${drive}`, `Free at least 5 GB on ${drive} before you build an installer.`);
}

function memoryLine(f) {
  const free = f.freemem();
  const detail = `${gb(free)} free of ${gb(f.totalmem())}`;
  return free >= MIN_MEMORY_BYTES ? line('memory', 'Free memory', 'found', detail) : line('memory', 'Free memory', 'problem', detail, 'Close other programs, then try again.');
}

const norm = (text) => String(text).toLowerCase().replace(/\\/g, '/');

async function portLine(f, port, kind, repoRoot) {
  const label = kind === 'app' ? `Port ${port} (Local App Studio)` : `Port ${port} (development page)`;
  const id = `port-${port}`;
  const h = await f.portHolder(port);
  if (!h.checked) return line(id, label, 'problem', 'Could not tell who uses this port.', 'Check again, or close other programs that use the network.');
  if (h.free) return line(id, label, 'found', 'Free');
  // the holder's command line is already redacted, so the repo folder is redacted the same way before comparing
  const command = norm(h.command);
  const repo = norm(redactText(repoRoot, { max: 500 }));
  if (kind === 'app' && (h.self || (command.includes(`${repo}/server.js`) && command.includes('node')))) {
    return line(id, label, 'found', `Used by Local App Studio, PID ${h.pid}`);
  }
  if (kind === 'dev' && command.includes(repo) && command.includes('vite')) {
    return line(id, label, 'found', `Used by this copy's development page, PID ${h.pid}`);
  }
  const detail = `Used by PID ${h.pid}: ${h.command || 'unknown program'}`;
  return line(
    id,
    label,
    'problem',
    detail,
    kind === 'app' ? 'Close that program, or start Local App Studio with APP_PORT set to another port.' : 'Close that program before npm run dev.',
  );
}

function dataLine(f, dataDir) {
  // A restore is swapping files in the data folder: the write test (a temp file) waits for the next check.
  if (f.restoring?.()) return line('data-folder', 'Data folder', 'found', `${dataDir} (a backup is being restored, so it was not checked)`);
  try {
    f.probeWrite(dataDir);
    return line('data-folder', 'Data folder', 'found', dataDir);
  } catch (err) {
    const code = typeof err?.code === 'string' ? err.code : 'unknown';
    if (code === 'ENOENT') return line('data-folder', 'Data folder', 'missing', `${dataDir} does not exist yet.`, 'Start Local App Studio once to create it.');
    return line('data-folder', 'Data folder', 'problem', `${dataDir} (${code})`, 'Check that the data folder can be written to.');
  }
}

function ollamaLine(state) {
  const label = 'The helper (Ollama)';
  const host = state.host ?? DEFAULT_OLLAMA_HOST;
  switch (state.state) {
    case 'ready':
      return line('ollama', label, 'found', [host, state.models.join(', ')].filter(Boolean).join(', '));
    case 'no_tools_model':
      return line('ollama', label, 'problem', host, 'No model that can use tools. Download one in Settings > AI.');
    case 'remote':
      return line('ollama', label, 'problem', host, 'Not checked: the helper is set to another computer. Check it in Settings > AI.');
    case 'off':
      return line('ollama', label, 'problem', 'The helper is turned off.', 'Turn it on in Settings > AI.');
    default:
      return line('ollama', label, 'missing', state.reason ?? `${host} did not answer.`, 'Ollama is not running. Open Ollama from the Start menu, then check again.');
  }
}

function playwrightDir(f) {
  const p = pathFor(f);
  const set = (f.env.PLAYWRIGHT_BROWSERS_PATH ?? '').trim();
  if (set === '0') return p.join(f.repoRoot, 'node_modules', 'playwright-core', '.local-browsers');
  if (set) return set;
  if (f.platform === 'win32') return p.join(f.env.LOCALAPPDATA || p.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (f.platform === 'darwin') return p.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return p.join(os.homedir(), '.cache', 'ms-playwright');
}

function playwrightLine(f) {
  const label = 'Playwright browsers (tests only)';
  try {
    const dir = playwrightDir(f);
    if (f.readdir(dir).some((n) => /^chromium-/.test(n))) return line('playwright', label, 'found', dir);
  } catch {
    // folder missing
  }
  return line('playwright', label, 'missing', '', 'Run npx playwright install chromium.');
}

/** Loopback hosts need no network opt-in; anything else is not probed. */
const isLoopbackHost = (hostname) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);

/**
 * The Ollama check for the CLI: probes the loopback host itself (`OLLAMA_HOST` or the default) with a 2 second timeout.
 * Loopback only, the same exception as Settings > AI.
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [opts]
 * @returns {() => Promise<OllamaState>}
 */
export function cliOllamaProbe({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async () => {
    let origin = DEFAULT_OLLAMA_HOST;
    const raw = (env.OLLAMA_HOST ?? '').trim();
    if (raw) {
      try {
        origin = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).origin;
      } catch {
        return { state: 'down', host: null, models: [], reason: 'OLLAMA_HOST is not a valid address.' };
      }
    }
    if (!isLoopbackHost(new URL(origin).hostname)) return { state: 'remote', host: origin, models: [] };
    const get = async (p, init) => {
      const res = await fetchImpl(`${origin}${p}`, { ...init, signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    try {
      await get('/api/version');
      const tags = await get('/api/tags');
      const names = (Array.isArray(tags?.models) ? tags.models : []).map((m) => m?.name).filter((n) => typeof n === 'string');
      let tools = [];
      let sawCapabilities = false;
      for (const name of names.slice(0, 8)) {
        try {
          const info = await get('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) });
          if (Array.isArray(info?.capabilities)) {
            sawCapabilities = true;
            if (info.capabilities.includes('tools')) tools.push(name);
          }
        } catch {
          // one model failing to answer does not make the helper down
        }
      }
      // an older Ollama reports no capabilities: any installed model counts
      if (!sawCapabilities) tools = names;
      return tools.length > 0 ? { state: 'ready', host: origin, models: names } : { state: 'no_tools_model', host: origin, models: names };
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? 'no answer within 2 seconds' : 'it did not answer';
      return { state: 'down', host: origin, models: [], reason: `${origin}: ${why}.` };
    }
  };
}

/**
 * Runs every check, in the fixed order. Never throws: a check that fails to run becomes a Problem line.
 * @param {DoctorFacade} [facade]
 * @param {{ includeDevTools?: boolean, dataDir?: string, ports?: number[], ollamaProbe?: () => Promise<OllamaState> }} [opts]
 * @returns {Promise<DoctorReport>}
 */
export async function runDoctor(facade = defaultDoctorFacade(), opts = {}) {
  const f = facade;
  const includeDevTools = opts.includeDevTools ?? !isSea();
  const dataDir = opts.dataDir ?? resolveDataDir({ env: f.env });
  const ports = opts.ports ?? [DEFAULT_PORT, VITE_DEV_PORT];
  const probe = opts.ollamaProbe ?? cliOllamaProbe({ env: f.env });
  const guard = async (id, label, fn) => {
    try {
      return await fn();
    } catch {
      return line(id, label, 'problem', 'This check could not run.', 'Check again.');
    }
  };

  const lines = [];
  // A build without the installer has no use for the build tools: no lines, and no check that could only refuse.
  if (f.buildTools) {
    const toolchain = await Promise.resolve().then(() => f.detectToolchain()).catch(() => null);
    for (const id of TOOL_IDS) lines.push(toolLine(id, toolchain?.items?.find((i) => i.id === id)));
  }
  lines.push(await guard('disk', 'Free disk space', () => diskLine(f, dataDir)));
  lines.push(await guard('memory', 'Free memory', () => memoryLine(f)));
  for (const port of ports) {
    const kind = port === VITE_DEV_PORT ? 'dev' : 'app';
    lines.push(await guard(`port-${port}`, `Port ${port}`, () => portLine(f, port, kind, f.repoRoot)));
  }
  lines.push(await guard('data-folder', 'Data folder', () => dataLine(f, dataDir)));
  lines.push(await guard('ollama', 'The helper (Ollama)', async () => ollamaLine(await probe())));
  if (includeDevTools) lines.push(await guard('playwright', 'Playwright browsers (tests only)', () => playwrightLine(f)));

  const counts = { found: 0, missing: 0, problem: 0 };
  for (const l of lines) counts[l.status] += 1;
  return { checkedAt: f.now().toISOString(), lines, counts };
}

/** @param {DoctorReport['counts']} c @returns {string} for example "11 found, 2 missing, 1 problem." */
export const countsLine = (c) => `${c.found} found, ${c.missing} missing, ${c.problem} problem${c.problem === 1 ? '' : 's'}.`;

const pad2 = (n) => String(n).padStart(2, '0');
const localStamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/**
 * The CLI table.
 * @param {DoctorReport} report
 * @returns {string}
 */
export function formatDoctor(report) {
  const width = Math.max(0, ...report.lines.map((l) => l.label.length)) + 2;
  const rows = report.lines.map((l) => {
    const text = l.status === 'found' ? l.detail : [l.detail, l.action].filter(Boolean).join(' ');
    return `${STATUS_WORDS[l.status].padEnd(9)}${l.label.padEnd(width)}${text}`.trimEnd();
  });
  return [`Local App Studio doctor, ${localStamp(report.checkedAt)}`, ...rows, countsLine(report.counts), ''].join('\n');
}

/**
 * The Studio route's helper state from `describeAi('tools')` (no second probe). Never throws past the caller's guard.
 * @param {{ describe: (purpose: string) => Promise<object>, listModels?: () => Promise<Array<{ name?: string }>> }} deps
 * @returns {() => Promise<OllamaState>}
 */
export function studioOllamaProbe({ describe, listModels }) {
  return async () => {
    const d = await describe('tools');
    const host = typeof d?.ai?.host === 'string' && d.ai.host !== '' ? d.ai.host : null;
    if (d?.available) {
      let models = typeof d.model === 'string' ? [d.model] : [];
      try {
        const listed = listModels ? await listModels() : [];
        const names = listed.map((m) => m?.name).filter((n) => typeof n === 'string');
        if (names.length > 0) models = names;
      } catch {
        // the model that answered is enough
      }
      return { state: 'ready', host: host ?? DEFAULT_OLLAMA_HOST, models };
    }
    switch (d?.reason) {
      case 'no_model':
      case 'no_tool_model':
        return { state: 'no_tools_model', host: host ?? DEFAULT_OLLAMA_HOST, models: [] };
      case 'network_opt_in_required':
        return { state: 'remote', host, models: [] };
      case 'ai_disabled':
        return { state: 'off', host: null, models: [] };
      default:
        return { state: 'down', host: host ?? DEFAULT_OLLAMA_HOST, models: [] };
    }
  };
}
