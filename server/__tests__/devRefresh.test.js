import { describe, expect, it } from 'vitest';
import {
  DEV_CHANNEL_MISSING,
  RefreshRefusal,
  buildDevChannelInstaller,
  buildPlan,
  checkoutProblems,
  formatSummary,
  groupChangedFiles,
  matchCheckoutProcesses,
  parseArgs,
  parseProcessList,
  refresh,
} from '../../scripts/devRefresh.js';

const DIR = 'C:\\Users\\tester\\local-app-studio';

describe('parseArgs', () => {
  it('defaults and flags', () => {
    expect(parseArgs([], '/repo')).toEqual({ dryRun: false, dir: '/repo', desktop: false });
    const a = parseArgs(['--dry-run', '--desktop', '--dir', '/other'], '/repo');
    expect(a.dryRun && a.desktop).toBe(true);
    expect(a.dir).toMatch(/other$/);
  });

  it('rejects unknown or incomplete flags', () => {
    expect(() => parseArgs(['--dir'])).toThrow(RefreshRefusal);
    expect(() => parseArgs(['--force'])).toThrow(/Unknown argument/);
  });
});

describe('checkoutProblems', () => {
  const ok = { isGit: true, topLevelMatches: true, branch: 'main', dirty: [] };
  it('accepts a clean main checkout', () => expect(checkoutProblems(ok)).toEqual([]));
  it('refuses a non-git folder', () => expect(checkoutProblems({ ...ok, isGit: false })).toHaveLength(1));
  it('refuses another branch, detached HEAD and a dirty tree', () => {
    expect(checkoutProblems({ ...ok, branch: 'feat/x' })[0]).toMatch(/feat\/x/);
    expect(checkoutProblems({ ...ok, branch: '' })[0]).toMatch(/detached/);
    expect(checkoutProblems({ ...ok, dirty: [' M a.js', '?? b.js'] })[0]).toMatch(/2 changes/);
  });
  it('refuses a subfolder of a checkout', () => expect(checkoutProblems({ ...ok, topLevelMatches: false })[0]).toMatch(/--dir/));
});

describe('matchCheckoutProcesses', () => {
  const procs = [
    { pid: 1, name: 'node.exe', commandLine: `"C:\\node\\node.exe" ${DIR}\\server.js`, executablePath: 'C:\\node\\node.exe' },
    { pid: 2, name: 'node.exe', commandLine: 'node C:\\Users\\tester\\local-app-studio-wt-pipeline\\server.js' },
    { pid: 3, name: 'local-app-studio-server.exe', commandLine: '', executablePath: `${DIR}\\src-tauri\\binaries\\local-app-studio-server.exe` },
    { pid: 4, name: 'chrome.exe', commandLine: `chrome ${DIR}\\index.html` },
    { pid: 5, name: 'node.exe', commandLine: `node ${DIR}\\scripts\\devRefresh.js` },
    { pid: 6, name: 'node.exe', commandLine: 'node c:/users/TESTER/local-app-studio/node_modules/vite/bin/vite.js' },
    { pid: 7, name: 'node.exe', commandLine: 'node D:\\elsewhere\\app.js' },
  ];

  it('matches node/local-app-studio processes in the checkout, case and slash insensitive on win32', () => {
    expect(matchCheckoutProcesses(procs, DIR, { platform: 'win32' }).map((p) => p.pid)).toEqual([1, 3, 6]);
  });

  it('does not treat a sibling folder with the same prefix as the checkout', () => {
    expect(matchCheckoutProcesses(procs, DIR, { platform: 'win32' }).some((p) => p.pid === 2)).toBe(false);
    expect(matchCheckoutProcesses(procs, 'C:\\Users\\tester\\local-app-studio-wt-pipeline', { platform: 'win32' }).map((p) => p.pid)).toEqual([2]);
  });

  it('ignores listed pids and is case-sensitive on posix', () => {
    expect(matchCheckoutProcesses(procs, DIR, { platform: 'win32', ignorePids: [1, 3, 6] })).toEqual([]);
    const posix = [{ pid: 9, name: 'node', commandLine: 'node /home/me/local-app-studio/server.js' }];
    expect(matchCheckoutProcesses(posix, '/home/me/local-app-studio', { platform: 'linux' })).toHaveLength(1);
    expect(matchCheckoutProcesses(posix, '/home/me/Local App Studio', { platform: 'linux' })).toHaveLength(0);
  });

  it('tolerates junk input', () => {
    expect(matchCheckoutProcesses(null, DIR)).toEqual([]);
    expect(matchCheckoutProcesses([null, { pid: 'x' }], DIR)).toEqual([]);
  });
});

describe('parseProcessList', () => {
  it('parses PowerShell JSON as an array or a single object', () => {
    const one = '{"ProcessId":10,"Name":"node.exe","CommandLine":"node a.js","ExecutablePath":"C:\\\\n\\\\node.exe"}';
    expect(parseProcessList(one, 'win32')[0]).toMatchObject({ pid: 10, name: 'node.exe', commandLine: 'node a.js' });
    expect(parseProcessList(`[${one},${one}]`, 'win32')).toHaveLength(2);
    expect(parseProcessList('', 'win32')).toEqual([]);
    expect(parseProcessList('garbage', 'win32')).toEqual([]);
  });

  it('parses ps output', () => {
    const text = '  PID COMMAND\n  101 /usr/bin/node /home/me/local-app-studio/server.js\n  202 -bash\n';
    const list = parseProcessList(text, 'linux');
    expect(list.map((p) => p.pid)).toEqual([101, 202]);
    expect(list[0].name).toBe('node');
  });
});

describe('groupChangedFiles, buildPlan, formatSummary', () => {
  it('groups files by area', () => {
    const groups = groupChangedFiles(['server/a.js', 'server.js', 'src/App.jsx', 'package-lock.json', 'scripts\\x.js', 'docs/a.md', 'README.md', '.github/workflows/ci.yml', 'src-tauri/lib.rs', 'weird.bin', '']);
    expect(groups).toEqual({
      server: ['server/a.js', 'server.js'],
      ui: ['src/App.jsx'],
      dependencies: ['package-lock.json'],
      scripts: ['scripts/x.js'],
      docs: ['docs/a.md', 'README.md'],
      ci: ['.github/workflows/ci.yml'],
      desktop: ['src-tauri/lib.rs'],
      other: ['weird.bin'],
    });
  });

  it('builds the plan, with the dev channel step only for --desktop', () => {
    expect(buildPlan({ dir: DIR, desktop: false }).join('\n')).toMatch(/git pull --ff-only origin main/);
    expect(buildPlan({ dir: DIR, desktop: false }).some((s) => s.includes('desktop:build:dev'))).toBe(false);
    expect(buildPlan({ dir: DIR, desktop: true }).some((s) => s.includes('desktop:build:dev'))).toBe(true);
  });

  it('summarizes commits, areas, deps and the bundle check', () => {
    const text = formatSummary({
      oldHead: 'aaaaaaa111',
      newHead: 'bbbbbbb222',
      commits: ['bbbbbbb feat: x'],
      files: ['server/a.js'],
      depsReinstalled: true,
      bundle: { ran: true, ok: true },
    }).join('\n');
    expect(text).toMatch(/aaaaaaa -> bbbbbbb, 1 commit pulled/);
    expect(text).toMatch(/server \(1\)/);
    expect(text).toMatch(/Dependencies reinstalled: yes/);
    expect(text).toMatch(/Bundle check: passed/);
    const same = formatSummary({ oldHead: 'a', newHead: 'a', commits: [], files: [], depsReinstalled: false, bundle: { ran: true, ok: false } }).join('\n');
    expect(same).toMatch(/Already up to date/);
    expect(same).toMatch(/unchanged/);
    expect(same).toMatch(/FAILED/);
  });
});

describe('buildDevChannelInstaller', () => {
  it('says so when the branch has no desktop:build:dev script', () => {
    const logs = [];
    const calls = [];
    const result = buildDevChannelInstaller({ pkg: { scripts: {} }, dir: DIR, runner: (...a) => calls.push(a), log: (l) => logs.push(l) });
    expect(result).toBe(DEV_CHANNEL_MISSING);
    expect(logs).toEqual(['Local App Studio Dev channel build is not available on this branch yet']);
    expect(calls).toEqual([]);
    expect(buildDevChannelInstaller({ pkg: null, dir: DIR, runner: () => ({ status: 0 }), log: () => {} })).toBe(DEV_CHANNEL_MISSING);
  });

  it('runs the script when it exists and throws when it fails', () => {
    const calls = [];
    const pkg = { scripts: { 'desktop:build:dev': 'node x' } };
    expect(buildDevChannelInstaller({ pkg, dir: DIR, runner: (c, a) => (calls.push([c, ...a]), { status: 0 }), log: () => {} })).toBe('built');
    expect(calls).toEqual([['npm', 'run', 'desktop:build:dev']]);
    expect(() => buildDevChannelInstaller({ pkg, dir: DIR, runner: () => ({ status: 1 }), log: () => {} })).toThrow(/failed/);
  });
});

describe('refresh (injected runner, no real git)', () => {
  /** Scripted runner: answers by command line, records every call. */
  function setup({ branch = 'main', porcelain = '', head = ['old1111', 'new2222'], log = '', diff = '', pull = 0, procs = [], open = [], locks = ['h1', 'h1'], pkg = { scripts: {} } } = {}) {
    const calls = [];
    const headQueue = [...head];
    const lockQueue = [...locks];
    const runner = (cmd, args) => {
      const line = `${cmd} ${args.join(' ')}`;
      calls.push(line);
      if (line === 'git rev-parse --show-toplevel') return { status: 0, stdout: `${DIR}\n` };
      if (line === 'git branch --show-current') return { status: 0, stdout: `${branch}\n` };
      if (line === 'git status --porcelain') return { status: 0, stdout: porcelain };
      if (line === 'git rev-parse HEAD') return { status: 0, stdout: `${headQueue.length > 1 ? headQueue.shift() : headQueue[0]}\n` };
      if (line === 'git pull --ff-only origin main') return { status: pull, stdout: '' };
      if (line.startsWith('git log --oneline')) return { status: 0, stdout: log };
      if (line.startsWith('git diff --name-only')) return { status: 0, stdout: diff };
      return { status: 0, stdout: '' };
    };
    const lines = [];
    const deps = {
      runner,
      listProcesses: () => procs,
      portOpen: async (p) => open.includes(p),
      hashFile: () => lockQueue.shift() ?? 'h1',
      readPackage: () => pkg,
      log: (l) => lines.push(l),
      platform: 'win32',
    };
    return { calls, lines, deps };
  }
  const args = (o = {}) => ({ dryRun: false, dir: DIR, desktop: false, ...o });
  const mutating = (calls) => calls.filter((c) => /pull|^npm /.test(c));

  it('pulls, skips npm ci when the lockfile is unchanged, builds and summarizes', async () => {
    const s = setup({ log: 'new2222 feat(x): y\n', diff: 'server/a.js\nsrc/b.jsx\n' });
    await expect(refresh({ ...s.deps, args: args() })).resolves.toEqual({ refreshed: true });
    expect(mutating(s.calls)).toEqual(['git pull --ff-only origin main', 'npm run build', 'npm run check:bundle']);
    const out = s.lines.join('\n');
    expect(out).toMatch(/skipping npm ci/);
    expect(out).toMatch(/old1111 -> new2222, 1 commit pulled/);
    expect(out).toMatch(/server \(1\): server\/a\.js/);
  });

  it('runs npm ci before the build when the lockfile hash changed', async () => {
    const s = setup({ locks: ['h1', 'h2'], log: 'new2222 chore: deps', diff: 'package-lock.json' });
    await refresh({ ...s.deps, args: args() });
    expect(mutating(s.calls)).toEqual(['git pull --ff-only origin main', 'npm ci', 'npm run build', 'npm run check:bundle']);
    expect(s.lines.join('\n')).toMatch(/Dependencies reinstalled: yes/);
  });

  it('refuses on another branch or a dirty tree without changing anything', async () => {
    for (const o of [{ branch: 'feat/x' }, { porcelain: ' M a.js\n' }]) {
      const s = setup(o);
      await expect(refresh({ ...s.deps, args: args() })).rejects.toThrow(RefreshRefusal);
      expect(mutating(s.calls)).toEqual([]);
    }
  });

  it('refuses when a process uses the checkout or a dev port is listening', async () => {
    const proc = { pid: 77, name: 'node.exe', commandLine: `node ${DIR}\\server.js`, executablePath: '' };
    const a = setup({ procs: [proc] });
    await expect(refresh({ ...a.deps, args: args() })).rejects.toThrow(/Process 77/);
    expect(mutating(a.calls)).toEqual([]);
    const b = setup({ open: [4321] });
    await expect(refresh({ ...b.deps, args: args() })).rejects.toThrow(/port 4321/);
    expect(mutating(b.calls)).toEqual([]);
  });

  it('dry run prints the plan, changes nothing, and still reports refusals', async () => {
    const ok = setup();
    await expect(refresh({ ...ok.deps, args: args({ dryRun: true }) })).resolves.toEqual({ refreshed: false });
    expect(ok.lines.join('\n')).toMatch(/dry run/);
    expect(mutating(ok.calls)).toEqual([]);
    const bad = setup({ branch: 'feat/x' });
    await expect(refresh({ ...bad.deps, args: args({ dryRun: true }) })).rejects.toThrow(/A real run would refuse/);
    expect(mutating(bad.calls)).toEqual([]);
  });

  it('stops with a clear error when the fast-forward pull fails, before npm runs', async () => {
    const s = setup({ pull: 1 });
    await expect(refresh({ ...s.deps, args: args() })).rejects.toThrow(/git pull --ff-only failed/);
    expect(mutating(s.calls)).toEqual(['git pull --ff-only origin main']);
  });

  it('reports a failed bundle check without failing the refresh', async () => {
    const s = setup({ head: ['same'] });
    s.deps.runner = ((inner) => (cmd, a, o) => (a.join(' ') === 'run check:bundle' ? { status: 1, stdout: '' } : inner(cmd, a, o)))(s.deps.runner);
    await refresh({ ...s.deps, args: args() });
    expect(s.lines.join('\n')).toMatch(/Already up to date/);
    expect(s.lines.join('\n')).toMatch(/Bundle check: FAILED/);
  });

  it('--desktop runs the dev channel hook or says it is unavailable', async () => {
    const without = setup();
    await refresh({ ...without.deps, args: args({ desktop: true }) });
    expect(without.lines.join('\n')).toMatch(/Local App Studio Dev channel build is not available on this branch yet/);
    const withScript = setup({ pkg: { scripts: { 'desktop:build:dev': 'node x' } } });
    await refresh({ ...withScript.deps, args: args({ desktop: true }) });
    expect(withScript.calls).toContain('npm run desktop:build:dev');
  });
});
