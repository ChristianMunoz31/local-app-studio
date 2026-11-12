// scripts/phase/ports.js (the port registry) and scripts/phase/wait.js (the shared heavy-step lock), over temp files and
// injected readers: no process is started, no port is opened, nothing outside os.tmpdir() is written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allocate, blockText, check, main as portsMain, normalize, renderRegistry, seedRegistry } from '../../scripts/phase/ports.js';
import { EXIT_BUSY, blockersNow, liveHolder, main as waitMain, readLock, release, resolveCommand, tryAcquire } from '../../scripts/phase/wait.js';

let dir = '';
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-ports-wait-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const collect = () => {
  const lines = [];
  return { lines, fn: (l) => lines.push(l) };
};
const NOW = new Date('2026-11-07T12:00:00Z');

describe('ports registry', () => {
  it('seeds the owner ports and an empty pool', () => {
    const s = seedRegistry();
    expect(s.owner.map((o) => o.port)).toEqual([4321, 4791, 5174, 11434]);
    expect(s.phases).toEqual([]);
  });

  it('allocates the lowest block, keeps it on a second call and gives the next phase the next block', () => {
    const a = allocate(null, 27, { now: NOW });
    expect(a.created).toBe(true);
    expect(a.entry.ports).toEqual([4581, 4680]);
    const again = allocate(a.registry, 27, { now: NOW });
    expect(again.created).toBe(false);
    expect(again.entry.ports).toEqual([4581, 4680]);
    const b = allocate(a.registry, 28, { now: NOW });
    expect(b.entry.ports).toEqual([4681, 4780]);
    const none = allocate(b.registry, 29, { now: NOW });
    expect(none.entry).toBeNull();
  });

  it('does not count a freed block as taken and never hands out a block that meets an owner port', () => {
    const reg = { pool: [4581, 4780], phases: [{ phase: 9, ports: [4581, 4680], status: 'free' }] };
    expect(allocate(reg, 30, { now: NOW }).entry.ports).toEqual([4581, 4680]);
    const meets = allocate({ pool: [4700, 4999], phases: [] }, 31, { now: NOW });
    expect(meets.entry.ports).toEqual([4800, 4899]);
    expect(allocate({ pool: [4721, 4900], phases: [] }, 32, { now: NOW }).entry).toBeNull();
  });

  it('checks a port: owner, a phase block, or free', () => {
    const reg = allocate(null, 27, { now: NOW }).registry;
    expect(check(reg, 4321).owner).toMatch(/owner/);
    expect(check(reg, 4600).owner).toBe('phase 27');
    expect(check(reg, 4700)).toEqual({ port: 4700, owner: null, free: true });
  });

  it('normalizes damaged input to a seed and prints a table with live listeners', () => {
    expect(normalize('x').phases).toEqual([]);
    expect(normalize({ phases: [null, { phase: 'a', ports: [1, 2] }, { phase: 3, ports: [4600, 4610] }] }).phases).toHaveLength(1);
    const reg = allocate(null, 27, { now: NOW }).registry;
    expect(blockText(reg, 27)).toBe('4581-4680');
    expect(renderRegistry(reg, [{ port: 4600, pid: 9 }])).toMatch(/listening: 4600=pid 9/);
  });

  it('--allocate --dry-run writes nothing; --allocate writes the file; --free frees; --check exits 1 for a taken port', async () => {
    const file = path.join(dir, 'phases.json');
    const run = async (argv) => {
      const out = collect();
      const err = collect();
      const code = await portsMain(argv, { out: out.fn, err: err.fn, now: () => NOW });
      return { code, text: out.lines.join('\n'), err: err.lines.join('\n') };
    };
    const dry = await run(['--allocate', '--phase', '40', '--file', file, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.text).toMatch(/dry run: allocated 4581-4680 to phase 40/);
    expect(fs.existsSync(file)).toBe(false);
    expect((await run(['--allocate', '--phase', '40', '--file', file])).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).phases[0].ports).toEqual([4581, 4680]);
    expect((await run(['--check', '4600', '--file', file])).code).toBe(1);
    expect((await run(['--free', '--phase', '40', '--file', file])).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).phases[0].status).toBe('free');
    expect((await run(['--check', '4600', '--file', file])).code).toBe(0);
    expect((await run(['--bogus'])).code).toBe(2);
    expect((await run(['--allocate', '--free'])).code).toBe(2);
    expect((await run(['--allocate', '--phase', '40', '--size', '0', '--file', file])).code).toBe(2);
  });

  it('the list reads the phase gate files path: a missing file is said, not created', async () => {
    const out = collect();
    const file = path.join(dir, 'missing', 'phases.json');
    expect(await portsMain(['--file', file], { out: out.fn, err: out.fn })).toBe(0);
    expect(out.lines.join('\n')).toMatch(/not created yet/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('wait lock', () => {
  const alive = new Set();
  const isAlive = (pid) => alive.has(pid);

  it('takes a free lock, refuses a live holder, takes over a stale one and releases only its own', () => {
    const file = path.join(dir, 'a.lock');
    alive.add(100);
    expect(tryAcquire(file, { pid: 100, owner: 'a', cmd: 'x' }, isAlive).ok).toBe(true);
    const busy = tryAcquire(file, { pid: 200, owner: 'b', cmd: 'y' }, isAlive);
    expect(busy.ok).toBe(false);
    expect(busy.holder.owner).toBe('a');
    release(file, 200);
    expect(readLock(file).pid).toBe(100);
    alive.delete(100);
    expect(liveHolder(file, isAlive)).toBeNull();
    expect(tryAcquire(file, { pid: 200, owner: 'b', cmd: 'y' }, isAlive).ok).toBe(true);
    release(file, 200);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a damaged lock file older than 2 s counts as free', () => {
    const file = path.join(dir, 'bad.lock');
    fs.writeFileSync(file, 'not json');
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(file, old, old);
    expect(tryAcquire(file, { pid: 1, owner: 'a', cmd: 'x' }, isAlive).ok).toBe(true);
  });

  it('an empty or unparsable lock file younger than 2 s is held, not damaged, and stays untouched', () => {
    for (const [name, text] of [['empty', ''], ['half', '{"pid": 12']]) {
      const file = path.join(dir, `fresh-${name}.lock`);
      fs.writeFileSync(file, text);
      const r = tryAcquire(file, { pid: 1, owner: 'a', cmd: 'x' }, isAlive);
      expect(r.ok, name).toBe(false);
      expect(r.holder.cmd).toMatch(/being written/);
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
      // the same file, 3 s later by the injected clock, is damaged and replaced
      expect(tryAcquire(file, { pid: 1, owner: 'a', cmd: 'x' }, isAlive, { now: () => Date.now() + 3000 }).ok, name).toBe(true);
    }
  });

  it('reads the lock back after writing it and treats a lock another caller replaced as lost', () => {
    const file = path.join(dir, 'race.lock');
    const lost = tryAcquire(file, { pid: 1, created: 'c1', owner: 'a', cmd: 'x' }, isAlive, { onWritten: () => fs.writeFileSync(file, JSON.stringify({ pid: 2, created: 'c2', owner: 'b', cmd: 'y' })) });
    expect(lost.ok).toBe(false);
    expect(lost.holder.pid).toBe(2);
    expect(readLock(file).pid).toBe(2);
    // same pid, different creation time (a reused pid) is also not ours
    fs.rmSync(file);
    const reused = tryAcquire(file, { pid: 1, created: 'c1', owner: 'a', cmd: 'x' }, isAlive, { onWritten: () => fs.writeFileSync(file, JSON.stringify({ pid: 1, created: 'c9' })) });
    expect(reused.ok).toBe(false);
    fs.rmSync(file);
    expect(tryAcquire(file, { pid: 1, created: 'c1', owner: 'a', cmd: 'x' }, isAlive).ok).toBe(true);
  });

  it('blockersNow names the lock holder and the heavy tools of other worktrees, never this worktree', () => {
    const file = path.join(dir, 'b.lock');
    alive.add(300);
    tryAcquire(file, { pid: 300, owner: 'critic', cmd: 'vitest' }, isAlive);
    const procs = [
      { pid: 11, name: 'node.exe', cmd: 'node D:\\p\\las-wt-phase23\\node_modules\\vitest\\vitest.mjs run' },
      { pid: 12, name: 'node.exe', cmd: 'node D:\\p\\las-wt-phase27\\node_modules\\vitest\\vitest.mjs run' },
      { pid: 13, name: 'node.exe', cmd: 'node D:\\p\\las-wt-phase23\\server.js' },
    ];
    const r = blockersNow({ procs, self: 'las-wt-phase27', targets: ['las-wt-phase23', 'las-wt-phase27'], lockFile: file, isAlive, pid: 999 });
    expect(r.pids.sort()).toEqual([11, 300]);
    expect(r.holder.owner).toBe('critic');
    expect(blockersNow({ procs, self: 'las-wt-phase27', targets: [], lockFile: file, isAlive, pid: 300 }).pids).toEqual([]);
  });
});

describe('resolveCommand', () => {
  const o = { execPath: 'N:/node.exe', npmCli: () => 'N:/node_modules/npm/bin/npm-cli.js' };
  it('runs node, npm and npx under this node and anything else by name, with no shell', () => {
    expect(resolveCommand(['node', 'a.js', '--x'], o)).toEqual(['N:/node.exe', ['a.js', '--x']]);
    expect(resolveCommand(['npm', 'run', 'build'], o)).toEqual(['N:/node.exe', ['N:/node_modules/npm/bin/npm-cli.js', 'run', 'build']]);
    expect(resolveCommand(['npx', 'vitest', 'run'], o)).toEqual(['N:/node.exe', [path.join('N:/node_modules/npm/bin', 'npx-cli.js'), 'vitest', 'run']]);
    expect(resolveCommand(['cargo', 'test'], o)).toEqual(['cargo', ['test']]);
  });
});

describe('wait main', () => {
  const base = (extra = {}) => {
    const out = collect();
    let t = 0;
    return {
      out,
      deps: {
        out: out.fn,
        err: out.fn,
        root: path.join(dir, 'las-wt-phase27'),
        readProcs: async () => [],
        readTrees: async () => ({ main: path.join(dir, 'local-app-studio'), worktrees: [] }),
        isAlive: () => true,
        sleep: async (ms) => {
          t += ms;
        },
        now: () => t,
        pid: process.pid,
        ...extra,
      },
    };
  };

  it('--dry-run reports and takes no lock', async () => {
    const lock = path.join(dir, 'c.lock');
    const { out, deps } = base();
    expect(await waitMain(['--dry-run', '--lock', lock, '--', 'echo hi'], deps)).toBe(0);
    expect(out.lines.join('\n')).toMatch(/would not wait/);
    expect(out.lines.join('\n')).toMatch(/would then run: echo hi/);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('exits 75 when a foreign heavy tool stays past --max-wait, 0 when quiet, and runs a command under the lock', async () => {
    const lock = path.join(dir, 'd.lock');
    const heavy = { pid: 55, name: 'node.exe', cmd: `node ${path.join(dir, 'local-app-studio')}\\node_modules\\vitest\\vitest.mjs` };
    const busy = base({ readProcs: async () => [heavy] });
    expect(await waitMain(['--lock', lock, '--max-wait', '30', '--poll', '10'], busy.deps)).toBe(EXIT_BUSY);
    const quiet = base();
    expect(await waitMain(['--lock', lock, '--max-wait', '30'], quiet.deps)).toBe(0);
    let seen = null;
    const ran = base({
      spawnArgv: (argv) => {
        seen = { cmd: argv.join(' '), lockHeld: readLock(lock) !== null };
        return { on: (ev, fn) => ev === 'exit' && fn(7) };
      },
    });
    expect(await waitMain(['--lock', lock, '--owner', 'E', '--', 'echo', 'hi'], ran.deps)).toBe(7);
    expect(seen).toEqual({ cmd: 'echo hi', lockHeld: true });
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('waits on a live lock holder and exits 75, then takes the lock once the holder is gone', async () => {
    const lock = path.join(dir, 'e.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: 424242, owner: 'other', cmd: 'vitest' }));
    const waiting = base({ isAlive: (pid) => pid === 424242 });
    expect(await waitMain(['--lock', lock, '--max-wait', '20', '--poll', '10', '--', 'echo'], waiting.deps)).toBe(EXIT_BUSY);
    const gone = base({
      isAlive: (pid) => pid === process.pid,
      spawnArgv: () => ({ on: (ev, fn) => ev === 'exit' && fn(0) }),
    });
    expect(await waitMain(['--lock', lock, '--', 'echo'], gone.deps)).toBe(0);
  });

  it('refuses bad flags with exit 2', async () => {
    const { deps } = base();
    expect(await waitMain(['--max-wait', 'x'], deps)).toBe(2);
    expect(await waitMain(['--nope'], deps)).toBe(2);
    expect(await waitMain(['--poll', '0'], deps)).toBe(2);
  });
});
