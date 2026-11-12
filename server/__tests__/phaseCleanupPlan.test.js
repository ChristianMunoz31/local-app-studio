// The pure cleanup plan (scripts/phase/lib/cleanupPlan.js, DESIGN-phase24 section 3.3): matching, every refusal reason in
// order, a protected descendant, temp folder age, the port block and the rendered table. Fake process tables only.
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  descendantsOf,
  describeAction,
  freePortBlock,
  isInside,
  matchProcesses,
  parsePortRange,
  pathMentioned,
  portsFromPhases,
  refusal,
  renderTable,
  sandboxNameMatches,
  tempCandidates,
} from '../../scripts/phase/lib/cleanupPlan.js';
import { parseWorktreeList } from '../../scripts/phase/lib/worktrees.js';

const WT = 'D:\\work\\las-wt-phase24';
const MAIN = 'D:\\work\\local-app-studio';
const OTHER = 'D:\\work\\las-wt-phase23';
const proc = (pid, ppid, name, cmd, cwd = null) => ({ pid, ppid, name, cwd, cmd, created: '2026-11-06T10:00:00.000Z' });
const baseCtx = (table, extra = {}) => ({ table, selfPid: 100, ownerPids: [36948, 35016, 34988, 34964], ownerPortHolders: [], main: MAIN, others: [OTHER], ...extra });

describe('parseWorktreeList', () => {
  it('splits the main checkout from the worktrees', () => {
    const text = 'worktree D:/work/local-app-studio\nHEAD aaa\nbranch refs/heads/main\n\nworktree D:/work/las-wt-phase24\nHEAD bbb\nbranch refs/heads/feat/x\n\nworktree D:/work/det\nHEAD ccc\ndetached\n';
    expect(parseWorktreeList(text)).toEqual({
      main: 'D:/work/local-app-studio',
      worktrees: [
        { path: 'D:/work/las-wt-phase24', branch: 'feat/x', head: 'bbb' },
        { path: 'D:/work/det', branch: '', head: 'ccc' },
      ],
    });
    expect(parseWorktreeList('')).toEqual({ main: '', worktrees: [] });
  });
});

describe('pathMentioned and isInside', () => {
  it('ignores case and slash direction and needs a boundary after the folder', () => {
    expect(pathMentioned('node D:/Work/LAS-WT-PHASE24/x.js', WT)).toBe(true);
    expect(pathMentioned(`"${WT}"`, WT)).toBe(true);
    expect(pathMentioned(`cd ${WT} && x`, WT)).toBe(true);
    expect(pathMentioned(WT, WT)).toBe(true);
    expect(pathMentioned(`${WT}-old\\x`, WT)).toBe(false);
    expect(pathMentioned('D:\\work\\local-app-studio-workspace\\x', MAIN)).toBe(false);
    expect(pathMentioned('xD:\\work\\las-wt-phase24', WT)).toBe(false);
    expect(pathMentioned('anything', '')).toBe(false);
  });
  it('isInside is a strict child or equal, never a longer sibling', () => {
    expect(isInside(WT, `${WT}\\a\\b`)).toBe(true);
    expect(isInside(WT, WT.toUpperCase())).toBe(true);
    expect(isInside(WT, `${WT}-2\\a`)).toBe(false);
    expect(isInside(WT, null)).toBe(false);
  });
});

describe('matchProcesses', () => {
  const table = [
    proc(1, 0, 'bash.exe', 'bash -c x', `${WT}\\sub`),
    proc(2, 0, 'node.exe', `node ${WT}\\server.js`),
    proc(3, 0, 'node.exe', 'node D:\\tmp\\local-app-studio-sandbox\\p24-a\\x.js'),
    proc(4, 0, 'node.exe', 'node server.js'),
    proc(5, 0, 'python.exe', 'python x'),
    proc(6, 0, 'node.exe', 'node unrelated.js', 'D:\\other'),
  ];
  it('gives each reason, and port holders only when they are node', () => {
    const m = matchProcesses(table, {
      worktree: WT,
      sandboxDirs: [{ name: 'p24-a', path: 'D:\\tmp\\local-app-studio-sandbox\\p24-a' }],
      portHolders: [
        { port: 4485, pid: 4 },
        { port: 4486, pid: 5 },
      ],
    });
    expect(m.map((x) => [x.proc.pid, x.why])).toEqual([
      [1, ['cwd in worktree']],
      [2, ['names worktree']],
      [3, ['names sandbox p24-a']],
      [4, ['holds port 4485']],
    ]);
  });
});

describe('refusal', () => {
  it('walks the rules in the design order', () => {
    const self = proc(100, 90, 'node.exe', 'node cleanup');
    const parent = proc(90, 80, 'bash.exe', `bash ${WT}`);
    const owner = proc(36948, 0, 'node.exe', 'node server.js');
    const holder = proc(200, 0, 'node.exe', 'node server.js');
    const mainP = proc(300, 0, 'node.exe', `node ${MAIN}\\server.js`);
    const otherP = proc(301, 0, 'node.exe', `node ${OTHER}\\server.js`);
    const python = proc(302, 0, 'python.exe', `python ${WT}\\x.py`);
    const ok = proc(303, 0, 'node.exe', `node ${WT}\\x.js`);
    const table = [self, parent, owner, holder, mainP, otherP, python, ok];
    const ctx = baseCtx(table, { ownerPortHolders: [{ port: 4321, pid: 200 }] });
    expect(refusal(self, ctx)).toBe('this process');
    expect(refusal(parent, ctx)).toBe('an ancestor of this process');
    expect(refusal(owner, ctx)).toBe('owner pid');
    expect(refusal(holder, ctx)).toBe('holds owner port 4321');
    expect(refusal(mainP, ctx)).toBe('names the main checkout');
    expect(refusal(otherP, ctx)).toBe('names another worktree (las-wt-phase23)');
    expect(refusal(python, ctx)).toBe('not a dev tool (python.exe)');
    expect(refusal(ok, ctx)).toBeNull();
  });
  it('honours --owner-pid and puts owner pid before the main checkout rule', () => {
    const p = proc(777, 0, 'node.exe', `node ${MAIN}\\x.js`);
    expect(refusal(p, baseCtx([p], { ownerPids: [777] }))).toBe('owner pid');
  });
  it('lets a browser go only when it is a Playwright one', () => {
    const pw = proc(1, 0, 'chrome.exe', 'chrome ms-playwright\\chromium-1\\chrome.exe');
    const mine = proc(2, 0, 'chrome.exe', 'chrome --profile x');
    expect(refusal(pw, baseCtx([pw]))).toBeNull();
    expect(refusal(mine, baseCtx([mine]))).toBe('not a dev tool (chrome.exe)');
  });
  it('refuses a process whose child (at any depth) is protected', () => {
    const top = proc(10, 0, 'node.exe', `node ${WT}\\a.js`);
    const mid = proc(11, 10, 'cmd.exe', 'cmd');
    const leaf = proc(12, 11, 'node.exe', 'node server.js');
    const table = [top, mid, leaf];
    expect(refusal(top, baseCtx(table, { ownerPids: [12] }))).toBe('a child is protected (pid 12)');
    expect(refusal(top, baseCtx(table, { ownerPortHolders: [{ port: 5174, pid: 12 }] }))).toBe('a child is protected (pid 12)');
    expect(refusal(top, baseCtx(table))).toBeNull();
  });
  it('treats the scan child of this process as this process', () => {
    const self = proc(100, 90, 'node.exe', 'node cleanup');
    const scan = proc(101, 100, 'powershell.exe', 'powershell -File cwdScan.ps1');
    expect(refusal(scan, baseCtx([self, scan]))).toBe('this process');
  });
  it('survives a parent cycle', () => {
    const a = proc(1, 2, 'node.exe', 'x');
    const b = proc(2, 3, 'node.exe', 'y');
    const c = proc(3, 2, 'node.exe', 'z');
    expect(refusal(c, baseCtx([a, b, c], { selfPid: 1 }))).toBe('an ancestor of this process');
    expect(refusal(a, baseCtx([a, b, c], { selfPid: 50 }))).toBeNull();
  });
});

describe('tempCandidates', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const since = Date.parse('2026-11-06T08:00:00Z');
  const e = (name, birth, idleMin, isDirectory = true) => ({ name, path: `T\\${name}`, isDirectory, birthtimeMs: Date.parse(birth), mtimeMs: now - idleMin * 60000 });
  it('keeps new idle tmp.* folders only', () => {
    const list = [
      e('tmp.abc123', '2026-11-06T09:00:00Z', 45),
      e('tmp.old', '2026-11-06T07:00:00Z', 600),
      e('tmp.busy', '2026-11-06T09:00:00Z', 5),
      e('tmp.used', '2026-11-06T09:00:00Z', 90),
      e('tmp-x', '2026-11-06T09:00:00Z', 90),
      e('tmp.file', '2026-11-06T09:00:00Z', 90, false),
      e('tmp.a.b', '2026-11-06T09:00:00Z', 90),
    ];
    const out = tempCandidates(list, { since, now, inUse: (p) => p.endsWith('tmp.used') });
    expect(out).toEqual([{ path: 'T\\tmp.abc123', reason: 'created 2026-11-06T09:00:00.000Z' }]);
  });
  it('skips everything when the creation time is unknown', () => {
    expect(tempCandidates([e('tmp.abc', '2026-11-06T09:00:00Z', 90)], { since: null, now, inUse: () => false })).toEqual([]);
  });
});

describe('ports, sandbox names and phases.json', () => {
  it('parses a port range', () => {
    expect(parsePortRange('4485-4490')).toEqual([4485, 4490]);
    expect(parsePortRange('4490-4485')).toBeNull();
    expect(parsePortRange('80-90')).toBeNull();
    expect(parsePortRange('4000-60000')).toBeNull();
    expect(parsePortRange('x')).toBeNull();
  });
  it('names the sandboxes of a phase', () => {
    for (const n of ['p24', 'P24-slug', 'phase24', 'p24_x', 'p24.a']) expect(sandboxNameMatches(n, 24)).toBe(true);
    for (const n of ['p240', 'p2', 'phase2', 'xp24', 'p24x']) expect(sandboxNameMatches(n, 24)).toBe(false);
    expect(sandboxNameMatches('p05-x', 5)).toBe(true);
    expect(sandboxNameMatches('p5', 5)).toBe(true);
  });
  const json = {
    phases: [
      { phase: 23, ports: [4451, 4480], status: 'active' },
      { phase: 24, ports: [4481, 4510], status: 'active' },
    ],
  };
  it('reads the block and frees it', () => {
    expect(portsFromPhases(json, 24)).toEqual([4481, 4510]);
    expect(portsFromPhases(json, 99)).toBeNull();
    const r = freePortBlock(json, 24, new Date('2026-11-06T12:00:00Z'));
    expect(r.changed).toBe(true);
    expect(r.json.phases[1]).toEqual({ phase: 24, ports: [4481, 4510], status: 'free', freedAt: '2026-11-06T12:00:00.000Z' });
    expect(r.json.phases[0].status).toBe('active');
    expect(json.phases[1].status).toBe('active');
    expect(freePortBlock(r.json, 24).changed).toBe(false);
  });
  it('leaves an unknown layout alone', () => {
    expect(freePortBlock({ x: 1 }, 24)).toEqual({ json: { x: 1 }, changed: false, note: 'unknown phases.json layout, skipped' });
    expect(freePortBlock(json, 77).changed).toBe(false);
  });
});

describe('buildPlan and renderTable', () => {
  const table = [
    proc(41236, 1, 'bash.exe', `"C:\\Program Files\\Git\\bin\\bash.exe" -c ${'x'.repeat(200)}`, WT),
    proc(36948, 1, 'node.exe', 'node server.js | pipe', null),
  ];
  const matches = [
    { proc: table[0], why: ['cwd in worktree'] },
    { proc: table[1], why: ['holds port 4485'] },
  ];
  const facts = {
    matches,
    ctx: baseCtx(table),
    force: false,
    keepWorktree: false,
    target: WT,
    sandboxDirs: [{ name: 'p24-a', path: 'T\\sb\\p24-a' }],
    temp: [{ path: 'T\\tmp.abc', reason: 'created 2026-11-06T09:00:00.000Z' }],
    phase: 24,
    phasesFile: null,
  };
  it('lists every action in order and renders the table shape', () => {
    const plan = buildPlan(facts);
    expect(plan.map((a) => a.kind)).toEqual(['process', 'process', 'remove-worktree', 'prune', 'delete-folder', 'delete-folder', 'phases']);
    const lines = renderTable(plan.filter((a) => a.kind === 'process')).split('\n');
    expect(lines[0]).toBe('| pid | name | cwd | command (first 100) | why | action |');
    expect(lines[1]).toBe('| --- | --- | --- | --- | --- | --- |');
    expect(lines[2].startsWith(`| 41236 | bash.exe | ${WT} | "C:\\Program Files\\Git\\bin\\bash.exe" -c xxx`)).toBe(true);
    expect(lines[2].endsWith('| cwd in worktree | would stop (tree) |')).toBe(true);
    expect(lines[3]).toBe('| 36948 | node.exe |  | node server.js \\| pipe | holds port 4485 | refused: owner pid |');
    expect(lines[2].split(' | ')[3].length).toBe(100);
  });
  it('says stop instead of would stop under --force, and skips the worktree steps with --keep-worktree', () => {
    const plan = buildPlan({ ...facts, force: true, keepWorktree: true });
    expect(plan[0].action).toBe('stop (tree)');
    expect(plan.some((a) => a.kind === 'remove-worktree' || a.kind === 'prune')).toBe(false);
  });
  it('describes the folder and phases lines', () => {
    const lines = buildPlan(facts)
      .filter((a) => a.kind !== 'process')
      .map((a) => describeAction(a, true));
    expect(lines).toEqual([
      `would remove worktree ${WT}`,
      'would prune worktrees',
      'would delete T\\sb\\p24-a',
      'would delete T\\tmp.abc (created 2026-11-06T09:00:00.000Z)',
      'phases.json not found, skipped',
    ]);
    expect(describeAction({ kind: 'phases', file: 'W\\phases.json', phase: 24 }, true)).toBe('would free the port block of phase 24 in W\\phases.json');
  });
});

describe('descendants and child rules', () => {
  const at = (pid, ppid, name, cmd, created) => ({ pid, ppid, name, cmd, cwd: null, created });
  it('a process created before its parent is not its child (a reused ppid)', () => {
    const parent = at(10, 1, 'node.exe', 'node a.js', '2026-11-06T10:00:00Z');
    const old = at(11, 10, 'python.exe', 'python x', '2026-11-06T09:00:00Z');
    const real = at(12, 10, 'node.exe', 'node b.js', '2026-11-06T10:00:05Z');
    expect(descendantsOf([parent, old, real], 10).map((p) => p.pid)).toEqual([12]);
  });
  it('a cargo or tauri tree (link.exe, build-script-build.exe) does not protect its parent', () => {
    const top = proc(10, 0, 'node.exe', `node ${WT}\\a.js`);
    const cargo = proc(11, 10, 'cargo.exe', 'cargo build');
    const link = proc(12, 11, 'link.exe', 'link.exe /OUT:x');
    const script = proc(13, 11, 'build-script-build.exe', 'build-script-build');
    const main = proc(14, 11, 'build-script-main.exe', 'build-script-main');
    expect(refusal(top, baseCtx([top, cargo, link, script, main]))).toBeNull();
    const other = proc(15, 11, 'build-scripts.exe', 'x');
    expect(refusal(top, baseCtx([top, cargo, other]))).toBe('a child is not a dev tool (pid 15, build-scripts.exe)');
  });
  it('a child that is not a dev tool protects the parent, except the helper allowlist', () => {
    const top = proc(10, 0, 'node.exe', `node ${WT}\\a.js`);
    const py = proc(11, 10, 'python.exe', 'python x');
    expect(refusal(top, baseCtx([top, py]))).toBe('a child is not a dev tool (pid 11, python.exe)');
    const helpers = [
      proc(12, 10, 'conhost.exe', 'conhost 0x4'),
      proc(13, 10, 'msedgewebview2.exe', 'msedgewebview2'),
      proc(14, 10, 'chrome.exe', 'C:/x/ms-playwright/chromium-1/chrome.exe --type=renderer'),
    ];
    expect(refusal(top, baseCtx([top, ...helpers]))).toBeNull();
    const mine = proc(15, 10, 'chrome.exe', 'chrome --profile x');
    expect(refusal(top, baseCtx([top, mine]))).toBe('a child is not a dev tool (pid 15, chrome.exe)');
  });
});
