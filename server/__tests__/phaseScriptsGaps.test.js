// Gap cases for the phase scripts (DESIGN-phase24, BRIEF-phase24 section 2): the refusal list over every owner pid and
// port, the temp folder age and creation rules at their edges, a --force cleanup over fakes that stops only what the
// rules allow, the ledger never mixing builds in one headroom line, and a static proof that nothing in scripts/phase
// writes a budget file or a pin. Pure over fakes and folders under os.tmpdir(); nothing real is stopped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { previousFor, withHeadroom } from '../../scripts/ci/gateLedger.js';
import { main as cleanupMain, parseArgs } from '../../scripts/phase/cleanup.js';
import { OWNER_PIDS, OWNER_PORTS, TEMP_IDLE_MS, refusal, tempCandidates } from '../../scripts/phase/lib/cleanupPlan.js';

const WT = 'D:\\work\\proj\\las-wt-phase24';
const MAIN = 'D:\\work\\proj\\local-app-studio';
const proc = (pid, ppid, name, cmd, cwd = null) => ({ pid, ppid, name, cmd, cwd, created: '2026-11-06T09:00:00Z' });

describe('the owner list', () => {
  it('holds the four owner pids and four owner ports of the rules', () => {
    expect([...OWNER_PIDS]).toEqual([36948, 35016, 34988, 34964]);
    expect([...OWNER_PORTS]).toEqual([4321, 4791, 5174, 11434]);
  });

  it.each([...OWNER_PIDS])('refuses owner pid %i even for a plain node process inside the worktree', (pid) => {
    const p = proc(pid, 0, 'node.exe', `node ${WT}\\x.js`, WT);
    const ctx = { table: [p], selfPid: 1, ownerPids: [...OWNER_PIDS], ownerPortHolders: [], main: MAIN, others: [] };
    expect(refusal(p, ctx)).toBe('owner pid');
  });

  it.each([...OWNER_PORTS])('refuses the holder of owner port %i', (port) => {
    const p = proc(700, 0, 'node.exe', `node ${WT}\\server.js`, WT);
    const ctx = { table: [p], selfPid: 1, ownerPids: [...OWNER_PIDS], ownerPortHolders: [{ port, pid: 700 }], main: MAIN, others: [] };
    expect(refusal(p, ctx)).toBe(`holds owner port ${port}`);
  });

  it('a process that is none of those is allowed', () => {
    const p = proc(701, 0, 'node.exe', `node ${WT}\\server.js`, WT);
    expect(refusal(p, { table: [p], selfPid: 1, ownerPids: [...OWNER_PIDS], ownerPortHolders: [], main: MAIN, others: [] })).toBeNull();
  });
});

describe('tempCandidates edges', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const since = Date.parse('2026-11-06T08:00:00Z');
  const e = (birth, mtime) => ({ name: 'tmp.abc', path: 'T\\tmp.abc', isDirectory: true, birthtimeMs: birth, mtimeMs: mtime });

  it('a folder idle for exactly 30 minutes is kept, one a millisecond older goes', () => {
    expect(tempCandidates([e(since + 1, now - TEMP_IDLE_MS)], { since, now, inUse: () => false })).toEqual([]);
    expect(tempCandidates([e(since + 1, now - TEMP_IDLE_MS - 1)], { since, now, inUse: () => false })).toHaveLength(1);
  });

  it('a folder created at the worktree time or before it is never a candidate', () => {
    expect(tempCandidates([e(since, now - 3 * TEMP_IDLE_MS)], { since, now, inUse: () => false })).toEqual([]);
    expect(tempCandidates([e(since - 1, now - 3 * TEMP_IDLE_MS)], { since, now, inUse: () => false })).toEqual([]);
  });

  it('a folder still in use is kept however old', () => {
    expect(tempCandidates([e(since + 1, now - 10 * TEMP_IDLE_MS)], { since, now, inUse: () => true })).toEqual([]);
  });

  it('a non finite creation time or NaN times keep everything', () => {
    expect(tempCandidates([e(since + 1, now - 3 * TEMP_IDLE_MS)], { since: Number.NaN, now, inUse: () => false })).toEqual([]);
    expect(tempCandidates([e(Number.NaN, now - 3 * TEMP_IDLE_MS)], { since, now, inUse: () => false })).toEqual([]);
    expect(tempCandidates([e(since + 1, Number.NaN)], { since, now, inUse: () => false })).toEqual([]);
  });
});

describe('cleanup --force over fakes', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  function setup() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-force-')));
    dirs.push(root);
    const main = path.join(root, 'main-checkout');
    const wt = path.join(root, 'las-wt-phase99');
    const tmp = path.join(root, 'tmp');
    for (const d of [main, wt, tmp]) fs.mkdirSync(d);
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    for (const n of ['tmp.idle', 'tmp.used', 'tmp.fresh']) fs.mkdirSync(path.join(tmp, n));
    for (const n of ['tmp.idle', 'tmp.used']) fs.utimesSync(path.join(tmp, n), old, old);
    const table = [
      proc(1001, 1, 'node.exe', `node ${wt}\\a.js`, wt),
      proc(36948, 1, 'node.exe', `node ${wt}\\b.js`, wt),
      proc(902, 1, 'node.exe', `node ${wt}\\c.js`, wt),
      proc(903, 1, 'node.exe', `node ${wt}\\d.js`, wt),
      proc(904, 1, 'node.exe', `node ${main}\\e.js ${wt}`, wt),
      proc(905, 1, 'python.exe', `python ${wt}\\f.py`, wt),
      proc(906, 1, 'bash.exe', 'bash', path.join(tmp, 'tmp.used')),
    ];
    const stopped = [];
    const lines = [];
    const deps = {
      out: (l) => lines.push(l),
      err: (l) => lines.push(`ERR ${l}`),
      platform: 'win32',
      repoRoot: main,
      tmpdir: tmp,
      homedir: path.join(root, 'home'),
      cwd: root,
      selfPid: 5150,
      sleep: async () => {},
      readTable: async () => table,
      readProcess: async (pid) => table.filter((p) => p.pid === pid),
      readPortHolders: async () => ({ known: true, holders: [{ port: 4321, pid: 902 }] }),
      readWorktrees: async () => ({ main, worktrees: [{ path: wt, branch: 'x', head: 'h' }] }),
      stop: (pid) => {
        stopped.push(pid);
        return { ok: true, detail: '' };
      },
    };
    return { root, tmp, wt, main, deps, stopped, lines };
  }
  const iso = (ms) => new Date(ms).toISOString();

  it('stops only the unprotected process and deletes only the idle, unused, new temp folder', async () => {
    const t = setup();
    const code = await cleanupMain(['--phase', '99', '--force', '--keep-worktree', '--owner-pid', '903', '--since', iso(Date.now() - 60000)], t.deps);
    expect(code, t.lines.join('\n')).toBe(0);
    expect(t.stopped).toEqual([1001]);
    expect(fs.existsSync(path.join(t.tmp, 'tmp.idle'))).toBe(false);
    expect(fs.existsSync(path.join(t.tmp, 'tmp.used'))).toBe(true);
    expect(fs.existsSync(path.join(t.tmp, 'tmp.fresh'))).toBe(true);
    expect(fs.existsSync(t.wt)).toBe(true);
    expect(fs.existsSync(t.main)).toBe(true);
    const text = t.lines.join('\n');
    expect(text).toContain('refused: owner pid');
    expect(text).toContain('refused: holds owner port 4321');
    expect(text).toContain('refused: names the main checkout');
    expect(text).toContain('refused: not a dev tool (python.exe)');
  });

  it('a folder created before the phase began is left alone', async () => {
    const t = setup();
    const code = await cleanupMain(['--phase', '99', '--force', '--keep-worktree', '--since', iso(Date.now() + 3600 * 1000)], t.deps);
    expect(code).toBe(0);
    for (const n of ['tmp.idle', 'tmp.used', 'tmp.fresh']) expect(fs.existsSync(path.join(t.tmp, n))).toBe(true);
  });

  it('refuses --force when the port holders cannot be read, and stops nothing', async () => {
    const t = setup();
    const code = await cleanupMain(['--phase', '99', '--force', '--keep-worktree'], { ...t.deps, readPortHolders: async () => ({ known: false, holders: [] }) });
    expect(code).toBe(1);
    expect(t.stopped).toEqual([]);
  });

  it('skips a pid that was reused between the scan and the stop', async () => {
    const t = setup();
    const code = await cleanupMain(['--phase', '99', '--force', '--keep-worktree', '--since', iso(Date.now() - 60000)], {
      ...t.deps,
      readProcess: async (pid) => [{ pid, cmd: 'something else', created: '2026-11-06T10:00:00Z' }],
    });
    expect(code).toBe(0);
    expect(t.stopped).toEqual([]);
    expect(t.lines.join('\n')).toContain('pid reused');
  });

  it('with no flag and with --dry-run nothing is stopped or deleted; both flags together exit 2', async () => {
    const t = setup();
    for (const argv of [['--phase', '99'], ['--phase', '99', '--dry-run']]) {
      expect(await cleanupMain([...argv, '--since', iso(Date.now() - 60000)], t.deps)).toBe(0);
    }
    expect(t.stopped).toEqual([]);
    expect(fs.existsSync(path.join(t.tmp, 'tmp.idle'))).toBe(true);
    expect(parseArgs(['--phase', '99', '--dry-run', '--force'])).toEqual({ error: '--dry-run and --force cannot be combined' });
    expect(parseArgs(['--phase', '99', '--dry-run']).force).toBe(false);
    expect(parseArgs(['--phase', '99']).force).toBe(false);
    expect(parseArgs(['--phase', '99', '--force']).force).toBe(true);
  });
});

describe('the ledger never mixes builds in one headroom line', () => {
  const line = (build, id, measured) => ({ build, mode: 'full', budgets: [{ id, measured }] });
  const row = { id: 'web.totalJsGzipKb', measured: 410, limit: 500 };

  it('the delta of a public row is against the public line only, and null with no public line', () => {
    const entries = [line('public', row.id, 380), line('pro', row.id, 400)];
    expect(withHeadroom([row], previousFor(entries, 'public'))[0].delta).toBe(30);
    expect(withHeadroom([row], previousFor(entries, 'pro'))[0].delta).toBe(10);
    expect(withHeadroom([row], previousFor([line('pro', row.id, 400)], 'public'))[0].delta).toBeNull();
    expect(withHeadroom([row], previousFor([line('public', row.id, 380)], 'pro'))[0].delta).toBeNull();
  });
});

describe('nothing in scripts/phase writes a budget file or a pin', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const files = walk(path.join(REPO_ROOT, 'scripts/phase')).filter((f) => /\.(js|ps1)$/.test(f));
  const rows = files.map((f) => [path.relative(REPO_ROOT, f).replace(/\\/g, '/'), f]);
  const WRITE = /\b(writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|cpSync|unlinkSync|writeFile|appendFile|Set-Content|Out-File|Add-Content|Remove-Item)\b([^\n]*)/;
  const FORBIDDEN = /scripts\/checks|__tests__|-budget|budget\.json|ciPipeline|sidecarBudget|bundleBudget|BUDGETS\.md|package\.json|\.github|migrations\.lock/;
  const code = (f) =>
    fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l));

  it('finds the phase scripts', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(rows)('%s: no write call names a limit file, a pin, a test or a workflow', (rel, f) => {
    for (const l of code(f)) if (WRITE.test(l)) expect(l, `${rel}: ${l.trim()}`).not.toMatch(FORBIDDEN);
  });

  it.each(rows)('%s: never pushes, never uses a shell string and never runs eslint --fix', (rel, f) => {
    const text = code(f).join('\n');
    expect(text, rel).not.toMatch(/\[\s*['"]push['"]|\bpush origin|--no-verify/);
    expect(text, rel).not.toMatch(/shell:\s*true|\bexecSync\(|(?<![.\w])exec\(/);
    expect(text, rel).not.toMatch(/'--fix'/);
  });
});
