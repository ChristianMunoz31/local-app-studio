// Doctor lines: fixed order, the same names and hints as the Build step's tool table, and the thresholds.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolName } from '../../../src/studio/lib/toolWords.ts';
import { cliOllamaProbe, countsLine, defaultDoctorFacade, driveOf, formatDoctor, pathFor, runDoctor, studioOllamaProbe } from '../../diagnostics/doctor.js';
import { PRO_PARTS } from '../../../src/proParts.js';
import { MIN_RUSTC } from '../../studio/build/toolchain.js';

const GIB = 1024 ** 3;
const RUST_HINT = 'Install Rust with rustup from rustup.rs (stable toolchain), then check again.';
const ITEMS = [
  { id: 'node', label: 'Node.js 24 or newer', status: 'found', required: true, path: 'C:\\nodejs\\node.exe', version: '24.15.0', hint: '' },
  { id: 'npm', label: 'npm', status: 'found', required: true, path: 'C:\\nodejs\\npm-cli.js', version: '11.0.0', hint: '' },
  { id: 'rustc', label: 'Rust compiler (rustc)', status: 'missing', required: true, path: null, hint: RUST_HINT },
  { id: 'cargo', label: 'Cargo', status: 'missing', required: true, path: null, hint: RUST_HINT },
  { id: 'msvc', label: 'Microsoft C++ build tools', status: 'found', required: true, path: 'C:\\link.exe', version: '14.4', hint: '' },
  { id: 'winsdk', label: 'Windows SDK', status: 'found', required: true, path: 'C:\\kernel32.lib', version: '10.0.26100.0', hint: '' },
  { id: 'webview2', label: 'WebView2 Runtime', status: 'missing', required: false, path: null, hint: 'Built apps need the WebView2 Runtime.' },
];

const facade = (over = {}) => ({
  env: {},
  platform: 'win32',
  repoRoot: 'C:\\repo\\las',
  now: () => new Date('2026-11-04T10:12:00.000Z'),
  buildTools: true,
  detectToolchain: async () => ({ ok: false, checkedAt: 'x', hostTriple: null, items: ITEMS }),
  portHolder: async (port) => ({ port, checked: true, free: true, pid: null, command: '', self: false }),
  statfs: () => ({ bavail: 100 * 1024, bsize: 1024 * 1024 }),
  freemem: () => 6 * GIB,
  totalmem: () => 16 * GIB,
  probeWrite: () => {},
  readdir: () => ['chromium-1200'],
  ...over,
});
const ready = async () => ({ state: 'ready', host: 'http://127.0.0.1:11434', models: ['llama3.2:3b'] });
const run = (over, opts = {}) => runDoctor(facade(over), { dataDir: 'C:\\data', ollamaProbe: ready, includeDevTools: true, ...opts });
const by = (report, id) => report.lines.find((l) => l.id === id);
const fail = (code) => () => {
  throw Object.assign(new Error('x'), { code });
};

describe('runDoctor', () => {
  it('returns the lines in the fixed order with counts', async () => {
    const r = await run();
    expect(r.lines.map((l) => l.id)).toEqual(['node', 'npm', 'rustc', 'cargo', 'msvc', 'winsdk', 'webview2', 'disk', 'memory', 'port-4321', 'port-5174', 'data-folder', 'ollama', 'playwright']);
    expect(r.counts).toEqual({ found: 11, missing: 3, problem: 0 });
    expect(r.checkedAt).toBe('2026-11-04T10:12:00.000Z');
  });

  it('checks the build tools only in a build with the installer', async () => {
    expect(defaultDoctorFacade().buildTools).toBe(PRO_PARTS.installer);
    let asked = 0;
    const r = await run({ buildTools: false, detectToolchain: async () => { asked += 1; return { items: ITEMS }; } });
    expect(r.lines.map((l) => l.id)).toEqual(['disk', 'memory', 'port-4321', 'port-5174', 'data-folder', 'ollama', 'playwright']);
    expect(r.counts).toEqual({ found: 7, missing: 0, problem: 0 });
    expect(asked).toBe(0);
  });

  it('gives every toolchain item the same name and hint as the Build step', async () => {
    const r = await run();
    for (const item of ITEMS) {
      const l = by(r, item.id);
      expect(l.label).toBe(toolName(item));
      expect(l.status).toBe(item.status);
      expect(l.action).toBe(item.status === 'missing' ? item.hint : '');
    }
    expect(by(r, 'node').detail).toBe('24.15.0, C:\\nodejs\\node.exe');
  });

  it('turns an old Rust into a problem with the update command', async () => {
    const items = ITEMS.map((i) => (i.id === 'rustc' ? { ...i, hint: `Your Rust is older than ${MIN_RUSTC}. Run "rustup update stable", then check again.` } : i));
    const l = by(await run({ detectToolchain: async () => ({ items }) }), 'rustc');
    expect(l).toMatchObject({ status: 'problem', action: 'Run rustup update stable, then check again.' });
  });

  it('still lists every tool when the toolchain check throws', async () => {
    const r = await run({ detectToolchain: fail('x') });
    expect(r.lines.slice(0, 7).every((l) => l.status === 'missing')).toBe(true);
  });

  it('checks disk at 5 GiB and memory at 1 GiB', async () => {
    const at = (bytes) => ({ statfs: () => ({ bavail: bytes, bsize: 1 }) });
    expect(by(await run(at(5 * GIB)), 'disk').status).toBe('found');
    const low = by(await run(at(5 * GIB - 1)), 'disk');
    expect(low.status).toBe('problem');
    expect(low.action).toBe('Free at least 5 GB on C: before you build an installer.');
    expect(by(await run({ freemem: () => GIB }), 'memory').status).toBe('found');
    const mem = by(await run({ freemem: () => GIB - 1 }), 'memory');
    expect(mem).toMatchObject({ status: 'problem', action: 'Close other programs, then try again.' });
    expect(by(await run(), 'memory').detail).toBe('6.0 GB free of 16.0 GB');
  });

  it('walks up to an existing folder for the free space', async () => {
    const seen = [];
    const statfs = (dir) => {
      seen.push(dir);
      if (seen.length < 3) throw new Error('ENOENT');
      return { bavail: 10 * GIB, bsize: 1 };
    };
    const r = await run({ statfs }, { dataDir: 'C:\\a\\b\\c' });
    expect(by(r, 'disk').status).toBe('found');
    expect(seen.length).toBe(3);
  });

  it('accepts a free port and this repo, and flags a stranger with the pid and command', async () => {
    const held = (over) => ({ portHolder: async (port) => ({ port, checked: true, free: false, pid: 5678, command: 'node.exe <home>\\other\\server.js', self: false, ...over }) });
    expect(by(await run(), 'port-4321')).toMatchObject({ status: 'found', detail: 'Free' });
    expect(by(await run(held({ self: true })), 'port-4321')).toMatchObject({ status: 'found', detail: 'Used by Local App Studio, PID 5678' });
    const stranger = by(await run(held()), 'port-4321');
    expect(stranger).toMatchObject({ status: 'problem', detail: 'Used by PID 5678: node.exe <home>\\other\\server.js' });
    expect(stranger.action).toBe('Close that program, or start Local App Studio with APP_PORT set to another port.');
    const vite = by(await run(held({ command: 'node.exe vite' })), 'port-5174');
    expect(vite.status).toBe('problem');
    expect(vite.action).toBe('Close that program before npm run dev.');
  });

  it('recognises this repo by its redacted folder', async () => {
    const f = { repoRoot: 'C:\\repo\\las' };
    const mine = (command) => ({ ...f, portHolder: async (port) => ({ port, checked: true, free: false, pid: 77, command, self: false }) });
    expect(by(await run(mine('node.exe <path>/las/server.js')), 'port-4321').status).toBe('found');
    expect(by(await run(mine('"node.exe" <path>/las/node_modules/vite/bin/vite.js')), 'port-5174').status).toBe('found');
  });

  it('does not write to the data folder while a restore holds it', async () => {
    let wrote = 0;
    const l = by(await run({ restoring: () => true, probeWrite: () => { wrote += 1; } }), 'data-folder');
    expect(wrote).toBe(0);
    expect(l.status).toBe('found');
    expect(l.detail).toContain('was not checked');
    expect(by(await run({ restoring: () => false }), 'data-folder').detail).toBe('C:\\data');
  });

  it('says unknown when a port could not be checked', async () => {
    const l = by(await run({ portHolder: async (port) => ({ port, checked: false, free: false, pid: null, command: '', self: false }) }), 'port-5174');
    expect(l.status).toBe('problem');
  });

  it('writes to the data folder, and names the error code when it cannot', async () => {
    expect(by(await run(), 'data-folder')).toMatchObject({ status: 'found', detail: 'C:\\data' });
    expect(by(await run({ probeWrite: fail('EACCES') }), 'data-folder')).toMatchObject({
      status: 'problem',
      detail: 'C:\\data (EACCES)',
      action: 'Check that the data folder can be written to.',
    });
    expect(by(await run({ probeWrite: fail('ENOENT') }), 'data-folder').status).toBe('missing');
  });

  it('describes the helper in each state', async () => {
    const probe = (state) => ({ ollamaProbe: async () => ({ host: 'http://127.0.0.1:11434', models: [], ...state }) });
    expect(by(await run({}, probe({ state: 'ready', models: ['a', 'b'] })), 'ollama').detail).toBe('http://127.0.0.1:11434, a, b');
    expect(by(await run({}, probe({ state: 'down', reason: 'no answer' })), 'ollama')).toMatchObject({
      status: 'missing',
      detail: 'no answer',
      action: 'Ollama is not running. Open Ollama from the Start menu, then check again.',
    });
    expect(by(await run({}, probe({ state: 'no_tools_model' })), 'ollama')).toMatchObject({ status: 'problem', action: 'No model that can use tools. Download one in Settings > AI.' });
    expect(by(await run({}, probe({ state: 'remote' })), 'ollama').action).toBe('Not checked: the helper is set to another computer. Check it in Settings > AI.');
  });

  it('looks for a chromium folder and leaves Playwright out of the packaged Studio', async () => {
    expect(by(await run(), 'playwright').status).toBe('found');
    expect(by(await run({ readdir: () => ['firefox-1'] }), 'playwright')).toMatchObject({ status: 'missing', action: 'Run npx playwright install chromium.' });
    expect(by(await run({ readdir: fail('ENOENT') }), 'playwright').status).toBe('missing');
    expect((await run({}, { includeDevTools: false })).lines.map((l) => l.id)).not.toContain('playwright');
  });

  it('turns a throwing check into a problem line instead of failing', async () => {
    const r = await run({ freemem: fail('x') });
    expect(by(r, 'memory')).toMatchObject({ status: 'problem', action: 'Check again.' });
  });
});

describe('path rules follow the described platform, on any host', () => {
  it('picks win32 rules for win32 and posix rules otherwise', () => {
    expect(pathFor({ platform: 'win32' })).toBe(path.win32);
    expect(pathFor({ platform: 'linux' })).toBe(path.posix);
    expect(pathFor({ platform: 'darwin' })).toBe(path.posix);
  });

  it('names the drive of a win32 path and the root of a posix path', () => {
    expect(driveOf({ platform: 'win32' }, 'C:\\a\\b\\c')).toBe('C:');
    expect(driveOf({ platform: 'linux' }, '/var/data/app')).toBe('/');
  });

  it('walks up a win32 path to its drive and a posix path to its root', async () => {
    const seenWin = [];
    const win = await run({ platform: 'win32', statfs: (d) => (seenWin.push(d), fail('ENOENT')()) }, { dataDir: 'C:\\a\\b\\c' });
    expect(by(win, 'disk').status).toBe('problem');
    expect(seenWin).toEqual(['C:\\a\\b\\c', 'C:\\a\\b', 'C:\\a', 'C:\\']);
    expect(by(win, 'disk').action).toContain('C: is available');
    const seenPosix = [];
    const posix = await run({ platform: 'linux', statfs: (d) => (seenPosix.push(d), fail('ENOENT')()) }, { dataDir: '/a/b/c' });
    expect(by(posix, 'disk').status).toBe('problem');
    expect(seenPosix).toEqual(['/a/b/c', '/a/b', '/a', '/']);
  });
});

describe('formatDoctor', () => {
  it('prints a header, one row per line and the counts', async () => {
    const rows = formatDoctor(await run()).split('\n');
    expect(rows[0]).toMatch(/^Local App Studio doctor, \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(rows[1]).toMatch(/^Found {4}Node\.js +24\.15\.0, C:\\nodejs\\node\.exe$/);
    expect(rows.find((r) => r.startsWith('Missing  Rust'))).toContain('Install Rust with rustup');
    expect(rows[rows.length - 2]).toBe('11 found, 3 missing, 0 problems.');
    expect(countsLine({ found: 1, missing: 0, problem: 1 })).toBe('1 found, 0 missing, 1 problem.');
  });
});

describe('studioOllamaProbe', () => {
  const probe = (d, models) => studioOllamaProbe({ describe: async () => d, listModels: async () => models })();

  it('maps describeAi answers', async () => {
    expect(await probe({ available: true, model: 'm1', ai: { kind: 'local', host: null } }, [{ name: 'm1' }, { name: 'm2' }])).toEqual({
      state: 'ready',
      host: 'http://127.0.0.1:11434',
      models: ['m1', 'm2'],
    });
    expect((await probe({ available: false, reason: 'no_tool_model' }, [])).state).toBe('no_tools_model');
    expect((await probe({ available: false, reason: 'network_opt_in_required', ai: { host: 'http://10.0.0.5:11434' } }, [])).state).toBe('remote');
    expect((await probe({ available: false, reason: 'ai_disabled' }, [])).state).toBe('off');
    expect((await probe({ available: false, reason: 'ollama_unavailable' }, [])).state).toBe('down');
  });

  it('falls back to the answering model when the list fails', async () => {
    const p = await studioOllamaProbe({ describe: async () => ({ available: true, model: 'm1' }), listModels: async () => fail('x')() })();
    expect(p.models).toEqual(['m1']);
  });
});

describe('cliOllamaProbe', () => {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchWith = (routes) => async (url) => {
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) throw new TypeError('refused');
    return routes[key]();
  };

  it('does not probe a host on another computer', async () => {
    const fetchImpl = async () => {
      throw new Error('must not be called');
    };
    const r = await cliOllamaProbe({ env: { OLLAMA_HOST: 'http://10.0.0.5:11434' }, fetchImpl })();
    expect(r).toMatchObject({ state: 'remote', host: 'http://10.0.0.5:11434' });
  });

  it('reports down with the reason when nothing answers', async () => {
    const r = await cliOllamaProbe({ env: {}, fetchImpl: fetchWith({}) })();
    expect(r.state).toBe('down');
    expect(r.reason).toContain('http://127.0.0.1:11434');
  });

  it('needs a model that lists the tools capability', async () => {
    const routes = (caps) => ({ '/api/version': () => json({}), '/api/tags': () => json({ models: [{ name: 'a' }] }), '/api/show': () => json({ capabilities: caps }) });
    expect((await cliOllamaProbe({ env: {}, fetchImpl: fetchWith(routes(['completion'])) })()).state).toBe('no_tools_model');
    expect(await cliOllamaProbe({ env: {}, fetchImpl: fetchWith(routes(['completion', 'tools'])) })()).toEqual({ state: 'ready', host: 'http://127.0.0.1:11434', models: ['a'] });
  });

  it('counts any model when the server reports no capabilities', async () => {
    const routes = { '/api/version': () => json({}), '/api/tags': () => json({ models: [{ name: 'a' }] }), '/api/show': () => json({}) };
    expect((await cliOllamaProbe({ env: {}, fetchImpl: fetchWith(routes) })()).state).toBe('ready');
    const empty = { '/api/version': () => json({}), '/api/tags': () => json({ models: [] }) };
    expect((await cliOllamaProbe({ env: {}, fetchImpl: fetchWith(empty) })()).state).toBe('no_tools_model');
  });
});
