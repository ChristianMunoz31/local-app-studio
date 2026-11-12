// `gate --repair` (scripts/ci/gateRepair.js, DESIGN-phase15 section 2.7), in a temporary git repository with a scripted eslint:
// a mechanical fix is committed with the exact message, a changed string literal or an edit outside the fixable lines
// is refused and every file restored, uncommitted edits are skipped, and CI never repairs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CI_REFUSAL, COMMIT_SUBJECT, changedOldLines, defaultExec, literalTokens, repair } from '../../scripts/ci/gateRepair.js';

const temps = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

/** A repo with one committed file `a.js`. */
function makeRepo(source = 'const a = 1\nconst b = 2\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-repair-'));
  temps.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'gate@example.test');
  git(dir, 'config', 'user.name', 'Gate Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.js'), source);
  git(dir, 'add', 'a.js');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/**
 * An exec that sends git to the real git of the temp repo and plays eslint: `--format json` answers `messages` (with `fix`
 * ranges) and `--fix` rewrites a.js with `fixed`.
 */
function scripted(dir, { messages, fixed }) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git') return defaultExec('git', args, dir);
    if (args.includes('--format')) return { status: 1, stdout: JSON.stringify([{ filePath: path.join(dir, 'a.js'), messages }]), stderr: '' };
    if (args.includes('--fix')) {
      fs.writeFileSync(path.join(dir, 'a.js'), fixed);
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

const semi = { ruleId: 'semi', line: 1, endLine: 1, fix: { range: [11, 11], text: ';' } };

describe('repair', () => {
  it('commits a mechanical fix as "chore(gate): mechanical fixes" with the files and rules in the body', async () => {
    const dir = makeRepo();
    const { exec } = scripted(dir, { messages: [semi], fixed: 'const a = 1;\nconst b = 2\n' });
    const r = await repair({ root: dir, targets: ['a.js'], exec, env: {} });
    expect(r.committed).toMatchObject({ files: ['a.js'], rules: ['semi'] });
    expect(r.committed.sha).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(git(dir, 'log', '-1', '--format=%s')).toBe(COMMIT_SUBJECT);
    expect(git(dir, 'log', '-1', '--format=%b')).toMatch(/1 files: a\.js\. Rules: semi\. Revert with: git revert/);
    expect(fs.readFileSync(path.join(dir, 'a.js'), 'utf8')).toBe('const a = 1;\nconst b = 2\n');
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('refuses a fix that changes a string literal, restores every file and makes no commit', async () => {
    const dir = makeRepo("const a = 'one'\nconst b = 2\n");
    const before = git(dir, 'rev-parse', 'HEAD');
    const { exec } = scripted(dir, { messages: [{ ruleId: 'quotes', line: 1, endLine: 1, fix: { range: [10, 15], text: '"one!"' } }], fixed: 'const a = "one!"\nconst b = 2\n' });
    const r = await repair({ root: dir, targets: ['a.js'], exec, env: {} });
    expect(r.committed).toBeNull();
    expect(r.refused).toEqual(['Not repaired: a.js changed more than mechanical fixes, so nothing was changed.']);
    expect(fs.readFileSync(path.join(dir, 'a.js'), 'utf8')).toBe("const a = 'one'\nconst b = 2\n");
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('refuses a change on a line eslint did not report as fixable', async () => {
    const dir = makeRepo();
    const { exec } = scripted(dir, { messages: [semi], fixed: 'const a = 1;\nconst b = 3\n' });
    const r = await repair({ root: dir, targets: ['a.js'], exec, env: {} });
    expect(r.committed).toBeNull();
    expect(r.refused).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'a.js'), 'utf8')).toBe('const a = 1\nconst b = 2\n');
  });

  it('skips a file with uncommitted edits and never runs eslint on it', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1\nconst b = 99\n');
    const { exec, calls } = scripted(dir, { messages: [semi], fixed: 'x' });
    const r = await repair({ root: dir, targets: ['a.js'], exec, env: {} });
    expect(r.skipped).toEqual(['a.js has changes that are not committed, so it was not touched.']);
    expect(calls.some((c) => c.includes('--fix'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'a.js'), 'utf8')).toBe('const a = 1\nconst b = 99\n');
  });

  it('skips everything when something is staged', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'other.js'), 'x\n');
    git(dir, 'add', 'other.js');
    const { exec, calls } = scripted(dir, { messages: [semi], fixed: 'x' });
    const r = await repair({ root: dir, targets: ['a.js'], exec, env: {} });
    expect(r.skipped).toEqual(['Skipped repair: there are staged changes.']);
    expect(calls.some((c) => c[0] !== 'git')).toBe(false);
  });

  it('does nothing when eslint reports nothing it can fix', async () => {
    const dir = makeRepo();
    const { exec, calls } = scripted(dir, { messages: [{ ruleId: 'no-undef', line: 1, endLine: 1 }], fixed: 'x' });
    const r = await repair({ root: dir, targets: ['a.js'], exec, env: {} });
    expect(r).toMatchObject({ committed: null, refused: [], skipped: [] });
    expect(calls.some((c) => c.includes('--fix'))).toBe(false);
  });

  it('CI never repairs: exit code 2 and the plain sentence, nothing run', async () => {
    const exec = vi.fn();
    const r = await repair({ root: os.tmpdir(), targets: ['a.js'], exec, env: { CI: 'true' } });
    expect(r.exitCode).toBe(2);
    expect(r.refused).toEqual([CI_REFUSAL]);
    expect(CI_REFUSAL).toBe('--repair never runs in CI: CI does not write to the branch.');
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('literalTokens', () => {
  it('sees string and template literals, not spacing or semicolons', () => {
    const a = literalTokens(ts, 'a.js', "const a = 'x'\nconst b = `t ${a} u`\n");
    const b = literalTokens(ts, 'a.js', "const a = 'x';\nconst  b = `t ${a} u`;\n");
    expect(a).toEqual(b);
    expect(a).toContain('x');
    expect(literalTokens(ts, 'a.js', "const a = 'y'\n")).not.toEqual(literalTokens(ts, 'a.js', "const a = 'x'\n"));
  });

  it('reads JSX files with the JSX scanner', () => {
    expect(literalTokens(ts, 'a.jsx', 'const a = <b c="d" />\n')).toContain('d');
  });
});

describe('changedOldLines', () => {
  it('lists the old lines of every hunk; an insertion counts the line before and after', () => {
    const diff = ['@@ -3,2 +3,2 @@', '-a', '-b', '+c', '+d', '@@ -10 +10 @@', '@@ -20,0 +21 @@'].join('\n');
    expect(changedOldLines(diff).sort((x, y) => x - y)).toEqual([3, 4, 10, 20, 21]);
  });
});
