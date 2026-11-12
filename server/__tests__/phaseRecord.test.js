// scripts/phase/record.js over a throwaway repo, a STATUS file, a gate JSON and its --md: append only, idempotent, refuses OVERVIEW.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decisionDraft, gatesBlock, gatesMarker, main, memoryParagraph, nextDecisionNumber } from '../../scripts/phase/record.js';

const STATUS = `# Phase 97 status

## Part A
- [x] A1 one
- [ ] A2 two

## Owner questions
1. Raise the web budget?
2. Keep the Assistant renderer?

## Tracked LOWs
- LOW one
- LOW two
- LOW three
`;
const STATE = { runId: 'p97-20261107-0900', head: 'f'.repeat(40), steps: [{ key: 'pro:lint', status: 'pass' }, { key: 'pro:build', status: 'fail-real', reason: 'exit 1' }] };
const MD = '| Gate | Pro |\n| --- | --- |\n| lint | 0 |\n';

let dir = '';
let repo = '';
beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-record-')));
  repo = path.join(dir, 'las-wt-phase97');
  fs.mkdirSync(path.join(repo, 'docs', 'phase97'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'phase97', 'STATUS-phase97.md'), STATUS);
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git(['init', '-q', '-b', 'feat/phase97-x']);
  git(['add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ state: STATE, rows: [] }));
  fs.writeFileSync(path.join(dir, 'gate.md'), MD);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const run = async (argv) => {
  const out = [];
  const err = [];
  const code = await main(['--gate', path.join(dir, 'gate.json'), ...argv], { out: (l) => out.push(l), err: (l) => err.push(l), root: repo, homedir: dir, now: () => new Date('2026-11-07T10:00:00Z') });
  return { code, text: out.join('\n'), err: err.join('\n') };
};

describe('pieces', () => {
  it('numbers the next decision from the file, or none', () => {
    expect(nextDecisionNumber('Decision 30 was\n### decision 31 text')).toBe(32);
    expect(nextDecisionNumber('nothing')).toBeNull();
  });

  it('the gates block carries the md unedited under the marker', () => {
    expect(gatesMarker(STATE)).toBe('Gates at fffffff (run p97-20261107-0900)');
    expect(gatesBlock(STATE, MD)).toBe(`## Gates at fffffff (run p97-20261107-0900)\n\n${MD.trim()}\n`);
  });

  it('the decision draft and the memory paragraph state facts and invent none', () => {
    const rows = [{ id: 'A1', text: 'one', done: true, section: 'a' }, { id: 'A2', text: 'two', done: false, section: 'a' }];
    const facts = { head: 'f'.repeat(40), branch: 'feat/phase97-x' };
    const dec = decisionDraft({ number: 32, phase: 97, day: '2026-11-07', facts, rows, state: STATE, questions: ['1. Q'], lows: 3 });
    expect(dec).toMatch(/^## Decision 32 draft \(phase 97 at fffffff, 2026-11-07\)/);
    expect(dec).toMatch(/1 ticked, 1 open of 2/);
    expect(dec).toMatch(/Open rows: A2\./);
    expect(dec).toMatch(/not passed: pro:build: fail-real \(exit 1\)/);
    expect(dec).toMatch(/Tracked LOWs: 3\./);
    const mem = memoryParagraph({ phase: 97, day: '2026-11-07', facts, rows, state: STATE, questions: ['1. Q'], lows: 3 });
    expect(mem.trim().split('\n')).toHaveLength(1);
    expect(mem).toMatch(/1 of 2 STATUS rows ticked; gate run p97-20261107-0900 at fffffff, 1 step not passed/);
    expect(`${dec}${mem}`).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('record main', () => {
  it('--dry-run prints the blocks and writes nothing', async () => {
    const target = path.join(dir, 'drafts-dry.md');
    const r = await run(['--append-to', target, '--memory-out', path.join(dir, 'mem-dry.md'), '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/## Gates at fffffff/);
    expect(r.text).toMatch(/Owner questions from STATUS/);
    expect(r.text).toMatch(/dry run: would append 2 block\(s\)/);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'mem-dry.md'))).toBe(false);
  });

  it('appends after the existing text, numbers the decision, writes the memory file and does not append twice', async () => {
    const target = path.join(dir, 'drafts.md');
    fs.writeFileSync(target, '# Records\n\nDecision 40 was made.\n');
    const mem = path.join(dir, 'memory-p97.md');
    const first = await run(['--append-to', target, '--memory-out', mem]);
    expect(first.code).toBe(0);
    const text = fs.readFileSync(target, 'utf8');
    expect(text.startsWith('# Records\n\nDecision 40 was made.\n\n## Gates at fffffff')).toBe(true);
    expect(text).toMatch(/## Decision 41 draft \(phase 97 at [0-9a-f]{7}, 2026-11-07\)/);
    expect(text).toContain(MD.trim());
    expect(fs.readFileSync(mem, 'utf8')).toMatch(/^Phase 97 \(2026-11-07\)/);
    const second = await run(['--append-to', target]);
    expect(second.text).toMatch(/already in the file/);
    expect(fs.readFileSync(target, 'utf8')).toBe(text);
  });

  it('refuses OVERVIEW.md in any folder and usage mistakes', async () => {
    const r = await run(['--append-to', path.join(dir, 'OVERVIEW.md')]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/OVERVIEW\.md is the parent's file/);
    expect(fs.existsSync(path.join(dir, 'OVERVIEW.md'))).toBe(false);
    const mem = await run(['--append-to', path.join(dir, 'ok.md'), '--memory-out', path.join(dir, 'sub', 'OVERVIEW.md')]);
    expect(mem.code).toBe(1);
    expect(mem.err).toMatch(/--memory-out: OVERVIEW\.md is the parent's file/);
    expect(fs.existsSync(path.join(dir, 'sub'))).toBe(false);
    expect((await run([])).code).toBe(2);
    expect((await run(['--bogus'])).code).toBe(2);
  });

  it('refuses any output path under the home .claude folder, for --memory-out and --append-to', async () => {
    const memory = path.join(dir, '.claude', 'projects', 'x', 'memory', 'note.md');
    const a = await run(['--append-to', path.join(dir, 'ok2.md'), '--memory-out', memory]);
    expect(a.code).toBe(1);
    expect(a.err).toMatch(/--memory-out: .*is under .*\.claude/);
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
    const b = await run(['--append-to', path.join(dir, '.claude', 'drafts.md')]);
    expect(b.code).toBe(1);
    expect(b.err).toMatch(/--append-to: .*is under/);
    expect(fs.existsSync(path.join(dir, 'ok2.md'))).toBe(false);
    const c = await run(['--append-to', path.join(dir, '.claude-notes.md'), '--dry-run']);
    expect(c.code).toBe(0);
  });
});
