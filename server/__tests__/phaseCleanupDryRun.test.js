// scripts/phase/cleanup.js main with --dry-run over a throwaway repo and worktree under os.tmpdir() and an injected empty
// process table: it prints the plan and removes nothing. Also the refusals of the argument parser.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, parseArgs, worktreeMatchesPhase } from '../../scripts/phase/cleanup.js';
import { readWorktrees } from '../../scripts/phase/lib/processTable.js';

let root = '';
let repo = '';
let wt = '';
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-dry-')));
  repo = path.join(root, 'main-checkout');
  wt = path.join(root, 'las-wt-phase99');
  fs.mkdirSync(repo);
  fs.mkdirSync(path.join(root, 'tmp'));
  git(['init', '-q', '-b', 'main'], repo);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'], repo);
  git(['worktree', 'add', '-q', '-b', 'feat/phase99-x', wt], repo);
});
afterAll(() => {
  try {
    git(['worktree', 'remove', '--force', wt], repo);
  } catch {
    // The folder is removed below anyway.
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const run = async (argv, extra = {}) => {
  const lines = [];
  const errs = [];
  const code = await main(argv, {
    out: (l) => lines.push(l),
    err: (l) => errs.push(l),
    platform: 'win32',
    repoRoot: repo,
    tmpdir: path.join(root, 'tmp'),
    homedir: path.join(root, 'home'),
    cwd: root,
    readTable: async () => [],
    readPortHolders: async () => ({ known: true, holders: [] }),
    readWorktrees: (r) => readWorktrees(r),
    stop: () => {
      throw new Error('a dry run must not stop anything');
    },
    ...extra,
  });
  return { code, text: lines.join('\n'), errs: errs.join('\n') };
};

describe('phases.json write', () => {
  it('goes through renameRetry, not a bare fs.renameSync', () => {
    const src = fs.readFileSync(new URL('../../scripts/phase/cleanup.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/fs\.renameSync\(/);
    expect(src).toMatch(/renameRetry\(tmp, phasesFile\)/);
  });
});

describe('cleanup --dry-run', () => {
  it('prints the plan and removes nothing', async () => {
    const r = await run(['--phase', '99', '--ports', '4481-4490']);
    expect(r.code).toBe(0);
    expect(r.text).toContain('| pid | name | cwd | command (first 100) | why | action |');
    expect(r.text).toContain('no matching processes');
    expect(r.text).toContain('would remove worktree');
    expect(r.text).toContain('would prune worktrees');
    expect(r.text).toContain('phases.json not found, skipped');
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.existsSync(repo)).toBe(true);
    expect(git(['worktree', 'list', '--porcelain'], repo)).toContain('las-wt-phase99');
  }, 60000);

  it('--dry-run behaves like no flag, and --keep-worktree drops the worktree lines', async () => {
    const a = await run(['--phase', '99', '--dry-run', '--keep-worktree']);
    expect(a.code).toBe(0);
    expect(a.text).not.toContain('would remove worktree');
    expect(fs.existsSync(wt)).toBe(true);
  }, 60000);

  it('exits 2 for --dry-run with --force, for an unknown phase and for the main checkout as target', async () => {
    expect((await run(['--phase', '99', '--dry-run', '--force'])).code).toBe(2);
    expect((await run(['--phase', '98'])).code).toBe(2);
    expect((await run(['--phase', '99', '--worktree', repo])).code).toBe(2);
    expect(fs.existsSync(repo)).toBe(true);
  }, 60000);

  it('refuses a --worktree whose folder is not the phase worktree', async () => {
    const r = await run(['--phase', '23', '--worktree', wt]);
    expect(r.code).toBe(2);
    expect(r.errs).toContain('is not the worktree of phase 23');
    expect(worktreeMatchesPhase('X:/a/las-wt-phase07', 7)).toBe(true);
    expect(worktreeMatchesPhase('X:/a/las-wt-phase7', 7)).toBe(true);
    expect(worktreeMatchesPhase('X:/a/las-wt-phase24', 2)).toBe(false);
    expect(worktreeMatchesPhase('X:/a/other', 24)).toBe(false);
    expect((await run(['--phase', '99', '--worktree', wt])).code).toBe(0);
  }, 60000);

  it('--force with a failed rescan removes no worktree and deletes no sandbox', async () => {
    const calls = [];
    let reads = 0;
    const sandbox = path.join(root, 'tmp', 'local-app-studio-sandbox', 'p99-a');
    fs.mkdirSync(sandbox, { recursive: true });
    const r = await run(['--phase', '99', '--force', '--ports', '4481-4490'], {
      readTable: async () => {
        reads += 1;
        if (reads > 1) throw new Error('scan down');
        return [];
      },
      sleep: async () => {},
      runFile: async (file, args) => {
        calls.push(args.join(' '));
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    expect(r.code).toBe(1);
    expect(calls.filter((c) => c.startsWith('worktree remove'))).toEqual([]);
    expect(r.text).toContain('the second scan failed');
    expect(fs.existsSync(sandbox)).toBe(true);
    expect(fs.existsSync(wt)).toBe(true);
  }, 60000);

  it('L24-14: --force does not count its own process or its parent shell as holders of the worktree', async () => {
    const calls = [];
    const stopped = [];
    const self = { pid: 7000, ppid: 7001, name: 'node.exe', cwd: root, cmd: `node scripts/phase/cleanup.js --phase 99 --force --worktree ${wt}`, created: 't1' };
    const shell = { pid: 7001, ppid: 1, name: 'powershell.exe', cwd: wt, cmd: 'powershell -NoProfile', created: 't0' };
    const r = await run(['--phase', '99', '--force', '--worktree', wt, '--ports', '4481-4490'], {
      selfPid: 7000,
      readTable: async () => [self, shell],
      sleep: async () => {},
      stop: (pid) => {
        stopped.push(pid);
        return { ok: true, detail: '' };
      },
      runFile: async (file, args) => {
        calls.push(args.join(' '));
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    expect(stopped).toEqual([]);
    expect(r.text).not.toContain('still held by');
    expect(r.text).toContain('refused: this process');
    expect(r.text).toContain('refused: an ancestor of this process');
    expect(calls.filter((c) => c.startsWith('worktree remove'))).toHaveLength(1);
  }, 60000);

  it('L24-14: another process that names the worktree still holds it', async () => {
    const calls = [];
    const other = { pid: 7100, ppid: 1, name: 'node.exe', cwd: wt, cmd: `node ${wt}/x.js`, created: 't2' };
    const self = { pid: 7000, ppid: 1, name: 'node.exe', cwd: root, cmd: `node cleanup.js --worktree ${wt}`, created: 't1' };
    const r = await run(['--phase', '99', '--force', '--worktree', wt, '--ports', '4481-4490', '--owner-pid', '7100'], {
      selfPid: 7000,
      readTable: async () => [self, other],
      sleep: async () => {},
      runFile: async (file, args) => {
        calls.push(args.join(' '));
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    expect(r.text).toContain('worktree not removed: still held by pid 7100');
    expect(calls.filter((c) => c.startsWith('worktree remove'))).toEqual([]);
  }, 60000);

  it('only says the scan needs Windows elsewhere', async () => {
    const r = await run(['--phase', '99'], { platform: 'linux' });
    expect(r.code).toBe(0);
    expect(r.text).toContain('the process scan needs Windows');
  });
});

describe('parseArgs', () => {
  it('refuses bad input', () => {
    expect(parseArgs([])).toEqual({ error: '--phase <N> is required' });
    expect(parseArgs(['--phase', 'x']).error).toMatch(/--phase/);
    expect(parseArgs(['--phase', '1', '--ports', '1-2']).error).toMatch(/--ports/);
    expect(parseArgs(['--phase', '1', '--sandbox', '../x']).error).toMatch(/--sandbox/);
    expect(parseArgs(['--phase', '1', '--since', 'nope']).error).toMatch(/--since/);
    expect(parseArgs(['--phase', '1', '--owner-pid', 'a']).error).toMatch(/--owner-pid/);
    expect(parseArgs(['--phase', '1', '--bogus']).error).toMatch(/unknown/);
  });
  it('collects repeated flags', () => {
    const o = parseArgs(['--phase', '7', '--sandbox', 'a', '--sandbox', 'b', '--owner-pid', '5', '--owner-pid', '6', '--force']);
    expect(o).toMatchObject({ phase: 7, sandboxes: ['a', 'b'], ownerPids: [5, 6], force: true });
  });
});
