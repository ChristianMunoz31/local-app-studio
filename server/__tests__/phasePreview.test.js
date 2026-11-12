// scripts/phase/preview.js with every machine reader injected: the command-line check, the plan, the refusals and a full
// restart over fakes. No process is stopped or started, no port is opened, no build runs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPreviewServer, main, planRestart } from '../../scripts/phase/preview.js';

const MAIN = 'D:\\proj\\local-app-studio';
const ok = { ok: true, why: 'node server.js of the main checkout' };

describe('isPreviewServer', () => {
  it('accepts node server.js of the main checkout, by command line or by directory', () => {
    expect(isPreviewServer({ name: 'node.exe', cmd: `node --import ./scripts/lib/proHook.js ${MAIN}\\server.js`, cwd: null }, MAIN).ok).toBe(true);
    expect(isPreviewServer({ name: 'node.exe', cmd: 'node --import ./scripts/lib/proHook.js server.js', cwd: MAIN }, MAIN).ok).toBe(true);
  });

  it('refuses a process that is not node, runs another script, or lives elsewhere', () => {
    expect(isPreviewServer(null, MAIN).ok).toBe(false);
    expect(isPreviewServer({ name: 'python.exe', cmd: `python ${MAIN}\\server.js`, cwd: MAIN }, MAIN).why).toMatch(/not node/);
    expect(isPreviewServer({ name: 'node.exe', cmd: `node ${MAIN}\\vite.js`, cwd: MAIN }, MAIN).why).toMatch(/server\.js/);
    expect(isPreviewServer({ name: 'node.exe', cmd: 'node D:\\other\\app\\server.js', cwd: 'D:\\other\\app' }, MAIN).why).toMatch(/main checkout/);
    expect(isPreviewServer({ name: 'node.exe', cmd: 'node D:\\proj\\local-app-studio-workspace\\server.js', cwd: 'D:\\proj\\local-app-studio-workspace' }, MAIN).ok).toBe(false);
  });
});

describe('isPreviewServer: the server.js argument must resolve inside the checkout', () => {
  it('refuses a checkout path that only appears elsewhere on the command line', () => {
    const a = isPreviewServer({ name: 'node.exe', cmd: `node D:\\other\\app\\server.js --root ${MAIN}`, cwd: 'D:\\other\\app' }, MAIN);
    expect(a.ok).toBe(false);
    expect(a.why).toMatch(/main checkout/);
    expect(isPreviewServer({ name: 'node.exe', cmd: `node server.js --data ${MAIN}\\proof`, cwd: 'D:\\other' }, MAIN).ok).toBe(false);
    expect(isPreviewServer({ name: 'node.exe', cmd: 'node server.js', cwd: null }, MAIN).ok).toBe(false);
  });

  it('resolves a relative argument against the process directory and reads quoted paths', () => {
    expect(isPreviewServer({ name: 'node.exe', cmd: 'node ..\\local-app-studio\\server.js', cwd: 'D:\\proj\\other' }, MAIN).ok).toBe(true);
    expect(isPreviewServer({ name: 'node.exe', cmd: `node "${MAIN}\\server.js"`, cwd: null }, MAIN).ok).toBe(true);
    expect(isPreviewServer({ name: 'node.exe', cmd: 'node ..\\x\\server.js', cwd: MAIN }, MAIN).ok).toBe(false);
  });
});

describe('planRestart', () => {
  const base = { port: 4321, holder: { pid: 10 }, holderCheck: ok, checkout: MAIN, data: 'D:\\ws\\proof-data', dataExists: true, createData: false, noBuild: false, checkoutProblems: [] };

  it('lists stop, build, check, start and wait', () => {
    const p = planRestart(base);
    expect(p.problems).toEqual([]);
    expect(p.steps[0]).toMatch(/stop pid 10/);
    expect(p.steps.join('\n')).toMatch(/npm run build/);
    expect(p.steps.join('\n')).toMatch(/APP_NO_DOTENV=1/);
  });

  it('refuses a foreign holder, a missing data folder, a dirty checkout and an owner port that is not the preview', () => {
    expect(planRestart({ ...base, holderCheck: { ok: false, why: 'not node (x)' } }).problems.join('\n')).toMatch(/pid 10 holds port 4321 and is not the preview server/);
    expect(planRestart({ ...base, dataExists: false }).problems.join('\n')).toMatch(/does not exist/);
    expect(planRestart({ ...base, dataExists: false, createData: true }).problems).toEqual([]);
    expect(planRestart({ ...base, checkoutProblems: ['dirty'] }).problems).toEqual(['dirty']);
    expect(planRestart({ ...base, noBuild: true, checkoutProblems: ['dirty'] }).problems).toEqual([]);
    expect(planRestart({ ...base, port: 11434, holder: null, holderCheck: null }).problems.join('\n')).toMatch(/owner port other than the preview/);
  });

  it('says so when nothing holds the port', () => {
    expect(planRestart({ ...base, holder: null, holderCheck: null }).steps[0]).toMatch(/nothing holds port 4321/);
  });
});

describe('preview main', () => {
  let dir = '';
  let data = '';
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-preview-')));
    data = path.join(dir, 'proof-data');
    fs.mkdirSync(data);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  const make = (extra = {}) => {
    const out = [];
    const err = [];
    const log = { stops: [], npm: [], launches: [] };
    const deps = {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      root: MAIN,
      tmpdir: dir,
      readTrees: async () => ({ main: MAIN, worktrees: [] }),
      readHolders: async () => ({ known: true, holders: [{ port: 4321, pid: 77 }] }),
      readProc: async () => [{ pid: 77, name: 'node.exe', cmd: `node --import x ${MAIN}\\server.js`, cwd: MAIN, created: 't1' }],
      stop: (pid) => {
        log.stops.push(pid);
        return { ok: true, detail: '' };
      },
      runner: (cmd, args) => {
        if (cmd === 'git') {
          const key = args.join(' ');
          if (key === 'rev-parse --show-toplevel') return { status: 0, stdout: `${MAIN}\n` };
          if (key === 'branch --show-current') return { status: 0, stdout: 'main\n' };
          return { status: 0, stdout: '' };
        }
        log.npm.push(args.join(' '));
        return { status: 0, stdout: '' };
      },
      portOpen: async () => true,
      launch: (checkout, env, logFile) => {
        log.launches.push({ checkout, env, logFile });
        return 4242;
      },
      sleep: async () => {},
      ...extra,
    };
    return { out, err, log, deps };
  };

  it('--status reports the holder and the check and does nothing else', async () => {
    const m = make();
    expect(await main(['--status'], m.deps)).toBe(0);
    expect(m.out.join('\n')).toMatch(/port 4321: pid 77 node\.exe/);
    expect(m.out.join('\n')).toMatch(/holder check: ok/);
    expect(m.log.stops).toEqual([]);
  });

  it('--restart --dry-run prints the plan and the checks and changes nothing', async () => {
    const m = make();
    expect(await main(['--restart', '--dry-run', '--data', data], m.deps)).toBe(0);
    expect(m.out.join('\n')).toMatch(/dry run: restart plan/);
    expect(m.out.join('\n')).toMatch(/checks passed: a real run would proceed/);
    expect(m.log.stops).toEqual([]);
    expect(m.log.npm).toEqual([]);
    expect(m.log.launches).toEqual([]);
  });

  it('--restart stops the preview server by pid, builds, starts with the data folder and waits for the port', async () => {
    const m = make();
    expect(await main(['--restart', '--data', data], m.deps)).toBe(0);
    expect(m.log.stops).toEqual([77]);
    expect(m.log.npm).toEqual(['run build', 'run check:bundle']);
    expect(m.log.launches[0].env).toMatchObject({ APP_DATA_DIR: data, APP_PORT: '4321', APP_NO_DOTENV: '1' });
    expect(m.log.launches[0].checkout).toBe(MAIN);
    expect(m.out.join('\n')).toMatch(/preview ready: http:\/\/127\.0\.0\.1:4321\//);
  });

  it('refuses to stop a process that is not the preview server, and leaves it running', async () => {
    const m = make({ readProc: async () => [{ pid: 77, name: 'node.exe', cmd: 'node D:\\other\\vite.js', cwd: 'D:\\other', created: 't' }] });
    expect(await main(['--stop'], m.deps)).toBe(1);
    expect(m.err.join('\n')).toMatch(/not the preview server/);
    expect(m.log.stops).toEqual([]);
  });

  it('checks and stops every holder of the port (IPv4 and IPv6), each after its own command-line check', async () => {
    const rows = { 77: { pid: 77, name: 'node.exe', cmd: `node ${MAIN}\\server.js`, cwd: MAIN, created: 'a' }, 78: { pid: 78, name: 'node.exe', cmd: `node ${MAIN}\\server.js`, cwd: MAIN, created: 'b' } };
    const both = make({ readHolders: async () => ({ known: true, holders: [{ port: 4321, pid: 77 }, { port: 4321, pid: 78 }] }), readProc: async (pid) => [rows[pid]] });
    expect(await main(['--stop'], both.deps)).toBe(0);
    expect(both.log.stops).toEqual([77, 78]);
    const mixed = make({
      readHolders: async () => ({ known: true, holders: [{ port: 4321, pid: 77 }, { port: 4321, pid: 78 }] }),
      readProc: async (pid) => [pid === 77 ? rows[77] : { pid: 78, name: 'node.exe', cmd: 'node D:\\other\\vite.js', cwd: 'D:\\other', created: 'c' }],
    });
    expect(await main(['--stop'], mixed.deps)).toBe(1);
    expect(mixed.err.join('\n')).toMatch(/pid 78 holds port 4321 and is not the preview server/);
    expect(mixed.log.stops).toEqual([]);
  });

  it('refuses when the port listing is unreadable, when the pid changed, and when a build fails (no restart then)', async () => {
    const unknown = make({ readHolders: async () => ({ known: false, holders: [] }) });
    expect(await main(['--stop'], unknown.deps)).toBe(1);
    expect(unknown.log.stops).toEqual([]);
    let n = 0;
    const reused = make({ readProc: async () => [{ pid: 77, name: 'node.exe', cmd: `node ${MAIN}\\server.js`, cwd: MAIN, created: `t${(n += 1)}` }] });
    expect(await main(['--stop'], reused.deps)).toBe(1);
    expect(reused.err.join('\n')).toMatch(/pid reused/);
    expect(reused.log.stops).toEqual([]);
    const failing = make({
      runner: (cmd, args) => (cmd === 'npm' ? { status: 1, stdout: '' } : args.join(' ') === 'rev-parse --show-toplevel' ? { status: 0, stdout: `${MAIN}\n` } : args[0] === 'branch' ? { status: 0, stdout: 'main\n' } : { status: 0, stdout: '' }),
    });
    expect(await main(['--restart', '--data', data], failing.deps)).toBe(1);
    expect(failing.log.launches).toEqual([]);
  });

  it('refuses a missing data folder and a dirty main checkout; bad flags exit 2', async () => {
    const m = make();
    expect(await main(['--restart', '--dry-run', '--data', path.join(dir, 'nope')], m.deps)).toBe(1);
    expect(m.err.join('\n')).toMatch(/does not exist/);
    const dirty = make({ runner: (cmd, args) => (args.includes('status') ? { status: 0, stdout: ' M a.js\n' } : args.join(' ') === 'rev-parse --show-toplevel' ? { status: 0, stdout: `${MAIN}\n` } : args[0] === 'branch' ? { status: 0, stdout: 'main\n' } : { status: 0, stdout: '' }) });
    expect(await main(['--restart', '--dry-run', '--data', data], dirty.deps)).toBe(1);
    expect(dirty.err.join('\n')).toMatch(/not clean/);
    expect(await main(['--stop', '--restart'], make().deps)).toBe(2);
    expect(await main(['--port', '80'], make().deps)).toBe(2);
    expect(await main(['--wat'], make().deps)).toBe(2);
  });
});
