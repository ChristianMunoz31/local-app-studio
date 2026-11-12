// ci:always-run
// The gate never raises a budget, never weakens a test and never pushes (BRIEF-phase15 section 1). Static proof over the
// scripts: no write call in scripts/ci names a limit file, a pin or a test, the state and ledger live under .gate/, the
// repair commits only its own message and nothing pushes, and the CI verify job cannot write to the branch.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { LEDGER_FILE } from '../../scripts/ci/gateLedger.js';
import { COMMIT_SUBJECT } from '../../scripts/ci/gateRepair.js';
import { DEFAULT_RUN_DIR, RUN_DIR, resolveRunDir } from '../../scripts/ci/gateClassify.js';
import { STATE_FILE } from '../../scripts/ci/gateState.js';
import { PRIVATE_WORKFLOWS } from './helpers/workflowSet.js';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const ciDir = path.join(REPO_ROOT, 'scripts/ci');
const scripts = fs.readdirSync(ciDir).filter((f) => f.endsWith('.js')).map((f) => `scripts/ci/${f}`);
const WRITE = /\b(writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|cpSync|unlinkSync|writeFile|appendFile)\(([^\n]*)/;
const FORBIDDEN = /scripts\/checks|__tests__|-budget|budget\.json|ciPipeline|sidecarBudget|bundleBudget|BUDGETS\.md|package\.json|\.github/;

describe('the gate never edits a limit, a pin or a test', () => {
  it.each(scripts)('%s: no write call names a limit file, a pin, a test or a workflow', (rel) => {
    const code = read(rel)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    for (const line of code) {
      const m = WRITE.exec(line);
      if (m) expect(line, `${rel}: ${line.trim()}`).not.toMatch(FORBIDDEN);
    }
  });

  it('the state, the ledger and every run file live under .gate/', () => {
    expect(STATE_FILE).toBe('.gate/flaky.json');
    expect(LEDGER_FILE).toBe('.gate/ledger.jsonl');
    expect(DEFAULT_RUN_DIR).toBe('.gate/run');
    expect(RUN_DIR).toBe(process.env.GATE_RUN_DIR ? resolveRunDir(process.env.GATE_RUN_DIR) : '.gate/run');
    expect(resolveRunDir(undefined)).toBe('.gate/run');
    expect(read('.gitignore')).toMatch(/^\.gate\/$/m);
  });

  it('GATE_RUN_DIR takes only a single folder directly under .gate/', () => {
    expect(resolveRunDir('.gate/run-light')).toBe('.gate/run-light');
    for (const bad of ['../x', '.gate/a/b', '.gate/../x', '.gate/..', '.gate/', '/abs/.gate/x', 'C:/x/.gate/run', '.gate\\x', 'x', '']) {
      expect(resolveRunDir(bad), bad).toBe('.gate/run');
    }
  });

  it('only gateRepair.js edits source files, only through eslint --fix on lint targets, and it never raises a limit', () => {
    const repair = read('scripts/ci/gateRepair.js');
    expect(repair).toContain(`export const COMMIT_SUBJECT = '${COMMIT_SUBJECT}'`);
    expect(COMMIT_SUBJECT).toBe('chore(gate): mechanical fixes');
    expect(repair).not.toMatch(/--no-verify/);
    expect(repair).not.toMatch(/'push'|git push|'--force/);
    expect((repair.match(/'commit'/g) ?? []).length).toBe(1);
    const gate = read('scripts/ci/gate.js');
    expect(gate).toContain('const LINT_TARGET = /\\.(js|jsx|ts|tsx)$/');
    for (const rel of scripts.filter((s) => s !== 'scripts/ci/gateRepair.js')) {
      expect(read(rel), rel).not.toMatch(/'--fix'/);
    }
  });

  it('no script under scripts/ci pushes', () => {
    for (const rel of scripts) {
      const code = read(rel)
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(code, rel).not.toMatch(/\[\s*['"]push['"]|\bpush origin/);
    }
  });

  it('the gate scripts never read a limit in order to change it: the budget scripts only write their --json file', () => {
    for (const rel of ['scripts/checks/bundleBudget.js', 'scripts/checks/sidecarBudget.js']) {
      const code = read(rel);
      const writes = code.split('\n').filter((l) => WRITE.test(l) && !/^\s*(\/\/|\*)/.test(l));
      expect(writes.every((l) => /appendFileSync\(env\.GITHUB_STEP_SUMMARY|writeFileSync\(out,/.test(l)), rel).toBe(true);
    }
  });
});

describe('CI never writes to the branch', () => {
  const ci = read('.github/workflows/ci.yml');
  const verify = ci.slice(ci.indexOf('\n  verify:'), ci.indexOf('\n  visual-baselines:'));

  it.skipIf(!PRIVATE_WORKFLOWS)('the verify job has contents: read and no git commit or git push (pins the private ci.yml, which is not in a public export)', () => {
    expect(verify).toMatch(/permissions:\n\s+contents: read\n/);
    const code = verify.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/contents:\s*write/);
    expect(code).not.toMatch(/git commit|git push|git add|--repair/);
  });

  it('--repair refuses to run in CI', () => {
    expect(read('scripts/ci/gate.js')).toContain('CI_REFUSAL');
    expect(read('scripts/ci/gateRepair.js')).toContain('if (env.CI) return');
  });
});
