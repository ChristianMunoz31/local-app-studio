// @vitest-environment node
// The pre-push hook is tested as a unit: the plan function and the hook file. No test pushes anything,
// and nothing here starts the gate.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { repairHeadRefusal } from '../../scripts/ci/gate.js';
import { SKIP_MESSAGE, localHeadFromStdin, main, prePushPlan, remoteBaseFromStdin } from '../../scripts/ci/prePush.js';

describe('remoteBaseFromStdin', () => {
  const L = 'a'.repeat(40);
  const R = 'b'.repeat(40);
  const ZERO = '0'.repeat(40);
  const line = (local, remote, ref = 'refs/heads/main') => `${ref} ${local} ${ref} ${remote}\n`;

  it('takes the remote sha of the one pushed ref, with LF or CRLF', () => {
    expect(remoteBaseFromStdin(line(L, R))).toBe(R);
    expect(remoteBaseFromStdin(line(L, R).replace('\n', '\r\n'))).toBe(R);
  });

  it('a new branch (remote sha all zeros) has no base, so the gate falls back to origin/main', () => {
    expect(remoteBaseFromStdin(line(L, ZERO))).toBeNull();
  });

  it('a deleted ref is ignored; a delete alone gives null', () => {
    expect(remoteBaseFromStdin(line(ZERO, R))).toBeNull();
    expect(remoteBaseFromStdin(line(ZERO, R) + line(L, R, 'refs/heads/x'))).toBe(R);
  });

  it('several refs at different remote shas, or one new branch among them, give null', () => {
    expect(remoteBaseFromStdin(line(L, R) + line(L, 'c'.repeat(40), 'refs/heads/a'))).toBeNull();
    expect(remoteBaseFromStdin(line(L, R) + line(L, ZERO, 'refs/heads/a'))).toBeNull();
    expect(remoteBaseFromStdin(line(L, R) + line(L, R, 'refs/heads/a'))).toBe(R);
  });

  it('empty or malformed input gives null', () => {
    for (const bad of ['', '\n', 'garbage', 'refs/heads/main xyz refs/heads/main xyz', `refs/heads/main ${L}`]) {
      expect(remoteBaseFromStdin(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('localHeadFromStdin', () => {
  const L = 'a'.repeat(40);
  const R = 'b'.repeat(40);
  const ZERO = '0'.repeat(40);
  const line = (local, remote, ref = 'refs/heads/main') => `${ref} ${local} ${ref} ${remote}\n`;

  it('is the one pushed local sha, ignoring deletes', () => {
    expect(localHeadFromStdin(line(L, R))).toBe(L);
    expect(localHeadFromStdin(line(ZERO, R) + line(L, R, 'refs/heads/x'))).toBe(L);
    expect(localHeadFromStdin(line(L, ZERO))).toBe(L);
  });

  it('is null for several different local shas, a delete alone, or malformed input', () => {
    expect(localHeadFromStdin(line(L, R) + line('c'.repeat(40), R, 'refs/heads/a'))).toBeNull();
    expect(localHeadFromStdin(line(ZERO, R))).toBeNull();
    expect(localHeadFromStdin('')).toBeNull();
    expect(localHeadFromStdin('garbage')).toBeNull();
  });
});

describe('prePushPlan with stdin', () => {
  const L = 'a'.repeat(40);
  const R = 'b'.repeat(40);
  const plain = { command: [process.execPath, 'scripts/ci/gate.js', '--quick', '--repair'] };

  it('passes the remote sha as --base', () => {
    expect(prePushPlan({}, `refs/heads/main ${L} refs/heads/main ${R}\n`, L)).toEqual({
      command: [process.execPath, 'scripts/ci/gate.js', '--quick', '--repair', '--base', R],
    });
  });

  it('passes the pushed sha as --head, and no --repair, when it is not the checked-out HEAD', () => {
    const other = 'c'.repeat(40);
    expect(prePushPlan({}, `refs/heads/x ${L} refs/heads/x ${R}\n`, other)).toEqual({
      command: [process.execPath, 'scripts/ci/gate.js', '--quick', '--base', R, '--head', L],
    });
    expect(prePushPlan({}, `refs/heads/x ${L} refs/heads/x ${'0'.repeat(40)}\n`, other)).toEqual({
      command: [process.execPath, 'scripts/ci/gate.js', '--quick', '--head', L],
    });
  });

  it('the gate refuses --repair for a --head that is not the checked-out commit', () => {
    expect(repairHeadRefusal(undefined, L)).toBeNull();
    expect(repairHeadRefusal(L, L)).toBeNull();
    expect(repairHeadRefusal('c'.repeat(40), L)).toMatch(/cannot run for a different --head/);
  });

  it('a new branch or no stdin passes no --base', () => {
    expect(prePushPlan({}, `refs/heads/x ${L} refs/heads/x ${'0'.repeat(40)}\n`, L)).toEqual(plain);
    expect(prePushPlan({}, '')).toEqual(plain);
  });

  it('GATE_SKIP=1 still skips whatever stdin holds', () => {
    expect(prePushPlan({ GATE_SKIP: '1' }, `refs/heads/main ${L} refs/heads/main ${R}\n`)).toHaveProperty('skip', true);
  });
});

describe('prePushPlan', () => {
  it('GATE_SKIP=1 skips with a message', () => {
    expect(prePushPlan({ GATE_SKIP: '1' })).toEqual({ skip: true, message: 'pre-push: gate skipped (GATE_SKIP=1)' });
    expect(SKIP_MESSAGE).toBe('pre-push: gate skipped (GATE_SKIP=1)');
  });

  it('unset runs the quick gate through node, not npm', () => {
    expect(prePushPlan({})).toEqual({ command: [process.execPath, 'scripts/ci/gate.js', '--quick', '--repair'] });
  });

  it('0, empty and other values do not skip', () => {
    for (const GATE_SKIP of ['0', '', 'true', 'yes', ' 1', '1 ']) {
      expect(prePushPlan({ GATE_SKIP }), JSON.stringify(GATE_SKIP)).toHaveProperty('command');
    }
  });
});

describe('main', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GATE_SKIP=1 prints the message and exits 0 without running anything', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main({ GATE_SKIP: '1' })).toBe(0);
    expect(log).toHaveBeenCalledWith('pre-push: gate skipped (GATE_SKIP=1)');
  });
});

describe('.githooks/pre-push', () => {
  const hook = fs.readFileSync(path.join(REPO_ROOT, '.githooks', 'pre-push'), 'utf8');

  it('is a POSIX shell script that execs scripts/ci/prePush.js with the git arguments', () => {
    expect(hook.startsWith('#!/bin/sh\n')).toBe(true);
    expect(hook).toContain('exec node scripts/ci/prePush.js "$@"');
    expect(hook).toContain('GATE_SKIP=1 git push');
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'ci', 'prePush.js'))).toBe(true);
  });

  it('has LF line endings (a CRLF shebang fails to run)', () => {
    expect(hook).not.toContain('\r');
  });

  it('is committed with the executable bit (mode 100755)', () => {
    const res = spawnSync('git', ['ls-files', '-s', '.githooks/pre-push'], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (res.error || res.status !== 0) return;
    expect(res.stdout.trim().split(/\s+/)[0]).toBe('100755');
  });

  it('installHooks.js points core.hooksPath at .githooks, which holds both hooks', () => {
    expect(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'installHooks.js'), 'utf8')).toContain("'core.hooksPath', '.githooks'");
    expect(fs.existsSync(path.join(REPO_ROOT, '.githooks', 'pre-commit'))).toBe(true);
  });
});
