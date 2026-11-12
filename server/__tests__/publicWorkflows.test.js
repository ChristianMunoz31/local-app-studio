// ci:always-run
// The public workflow set (scripts/release/public-overlay/.github/workflows, swapped in by the export): the marker, the
// triggers, least permissions, concurrency, pinned actions, no secret, no pro path, no private name, node 24 and heavy
// jobs on a manual dispatch only. Runs in both trees: it reads the overlay folder here and .github/workflows in the
// export (where the public marker is present). The rules are scripts/ci/workflowCheck.js `checkPublicWorkflow`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { PUBLIC_FILES, PUBLIC_MARKER, checkAll, checkPublicWorkflow, detectWorkflowSet, parseWorkflow } from '../../scripts/ci/workflowCheck.js';
import { WORKFLOW_SET } from './helpers/workflowSet.js';

const DIR = WORKFLOW_SET === 'public' ? '.github/workflows' : 'scripts/release/public-overlay/.github/workflows';
const read = (name) => fs.readFileSync(path.join(REPO_ROOT, DIR, name), 'utf8');
// The private repository name is built from fragments so the public export does not contain it as a literal.
const PRIVATE_REPO = ['local', 'app', 'studio', 'pro'].join('-');
const PRIVATE_REPO_RE = PRIVATE_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PUBLIC_VERIFY_STEPS = ['hygiene: trusted config', 'hygiene: gitleaks', 'hygiene: em dash', 'hygiene: keys', 'hygiene: personal data', 'workflows', 'npm ci', 'lint', 'typecheck', 'unit tests', 'build', 'public build'];
const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts);
const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));
const problems = (name) => checkPublicWorkflow(read(name), { file: name, exists, scripts }).map((p) => `${name}:${p.line} ${p.message}`);
const stepNames = (text, jobId) => [...(text.split(new RegExp(`\\n {2}${jobId}:\\n`))[1] ?? '').split(/\n {2}[a-z][\w-]*:\n/)[0].matchAll(/^ {6}- name: "?([^"\n]+)"?$/gm)].map((m) => m[1]);

describe('the public workflow set files', () => {
  it('is exactly ci.yml and desktop-check.yml', () => {
    expect(fs.readdirSync(path.join(REPO_ROOT, DIR)).filter((f) => f.endsWith('.yml')).sort()).toEqual(PUBLIC_FILES);
  });

  it.each(PUBLIC_FILES)('%s starts with the marker line and passes the structural and the public rules', (name) => {
    expect(read(name).split(/\r?\n/)[0]).toBe('# las-workflow-set: public');
    expect(problems(name)).toEqual([]);
  });

  it('the marker is what detectWorkflowSet reads: the overlay folder is public, this checkout follows its own ci.yml', () => {
    const overlay = path.join(REPO_ROOT, 'scripts/release/public-overlay');
    expect(PUBLIC_MARKER).toBe('# las-workflow-set: public');
    expect(detectWorkflowSet(overlay)).toBe(fs.existsSync(path.join(overlay, '.github/workflows/ci.yml')) ? 'public' : 'private');
    expect(WORKFLOW_SET).toBe(detectWorkflowSet(REPO_ROOT));
  });

  it('check:workflows finds no problem in any workflow of this checkout (the public rules when the marker is present)', () => {
    for (const r of checkAll(REPO_ROOT)) expect(r.problems, r.file).toEqual([]);
  });
});

describe('ci.yml of the public set', () => {
  const ci = () => read('ci.yml');

  it('runs on push (main), pull_request and workflow_dispatch only', () => {
    const wf = parseWorkflow(ci());
    expect([...wf.triggers].sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(ci()).toMatch(/\n {2}push:\n {4}branches: \[main\]\n/);
  });

  it('has top level contents: read, no job permissions and no write', () => {
    expect(ci()).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(parseWorkflow(ci()).jobs.every((j) => !j.fields.has('permissions'))).toBe(true);
    expect(ci()).not.toMatch(/:\s*write\s*$/m);
  });

  it('cancels an older run of the same ref', () => {
    expect(ci()).toMatch(/\nconcurrency:\n {2}group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/);
  });

  it('pins every action by a 40 character sha with a version comment', () => {
    for (const name of PUBLIC_FILES) {
      const uses = read(name).split(/\r?\n/).filter((l) => /^\s*(?:- )?uses:/.test(l));
      expect(uses.length, name).toBeGreaterThan(0);
      for (const line of uses) expect(line, line).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+# v\d+(\.\d+)*/);
    }
  });

  it('uses no secret but the token, no pro path and no private repository name', () => {
    for (const name of PUBLIC_FILES) {
      const code = read(name).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      expect([...code.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]).filter((s) => s !== 'GITHUB_TOKEN'), name).toEqual([]);
      expect(code, name).not.toMatch(/(^|[^\w])pro\//);
      expect(code, name).not.toMatch(new RegExp(`${PRIVATE_REPO_RE}|-releases\\b|RELEASES_TOKEN|pull_request_target|workflow_run|schedule:`));
    }
  });

  it('runs the planned verify steps in order, with a Windows unit job and a manual e2e job', () => {
    expect(stepNames(ci(), 'verify').filter((n) => PUBLIC_VERIFY_STEPS.includes(n))).toEqual(PUBLIC_VERIFY_STEPS);
    expect(parseWorkflow(ci()).jobs.map((j) => j.id)).toEqual(['verify', 'unit-windows', 'e2e']);
    const jobs = parseWorkflow(ci()).jobs;
    expect(jobs.find((j) => j.id === 'verify').runsOn).toBe('ubuntu-24.04');
    expect(jobs.find((j) => j.id === 'unit-windows').runsOn).toBe('windows-2025');
    expect(jobs.find((j) => j.id === 'unit-windows').ifText).toBeNull();
  });

  it('keeps the gitleaks binary pinned by version and checksum, with no licence key', () => {
    expect(ci()).toMatch(/GITLEAKS_VERSION: \d+\.\d+\.\d+\n/);
    expect(ci()).toMatch(/GITLEAKS_SHA256: [0-9a-f]{64}\n/);
    expect(ci()).toContain('sha256sum --check --strict');
    expect(ci()).not.toContain('gitleaks/gitleaks-action');
    expect(ci()).toContain('--config "$GITLEAKS_CONFIG"');
  });

  it('runs the heavy job (e2e) on a manual dispatch only, and desktop-check.yml only by hand', () => {
    const e2e = parseWorkflow(ci()).jobs.find((j) => j.id === 'e2e');
    expect(e2e.ifText).toContain("github.event_name == 'workflow_dispatch'");
    expect(e2e.text).toContain('runE2e.js');
    const desktop = parseWorkflow(read('desktop-check.yml'));
    expect([...desktop.triggers]).toEqual(['workflow_dispatch']);
    for (const job of desktop.jobs) expect(job.ifText, job.id).toContain("github.event_name == 'workflow_dispatch'");
  });

  it('asks for node 24 in every setup-node and keeps untrusted values out of run lines', () => {
    for (const name of PUBLIC_FILES) {
      const versions = [...read(name).matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
      expect(versions.every((v) => v === '24'), name).toBe(true);
      const runs = read(name).split('\n').filter((l) => /^\s*(?:- )?run:/.test(l));
      for (const l of runs) expect(l, l).not.toMatch(/\$\{\{[^}]*(github\.event\.|github\.head_ref|github\.base_ref|inputs\.)/);
    }
    expect(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).engines.node).toMatch(/24/);
  });
});

describe('checkPublicWorkflow rules (fixtures)', () => {
  const SHA = 'a'.repeat(40);
  const good = `${PUBLIC_MARKER}
name: CI
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    name: verify
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
      - uses: actions/setup-node@${SHA} # v7.0.0
        with:
          node-version: 24
      - run: echo ok
`;
  const found = (text, file = 'ci.yml') => checkPublicWorkflow(text, { file }).map((p) => p.message).join('\n');

  it('passes a minimal public ci.yml', () => {
    expect(found(good)).toBe('');
  });

  it('needs the marker as the first line', () => {
    expect(found(good.replace(`${PUBLIC_MARKER}\n`, ''))).toContain('the first line must be');
    expect(found(`\n${good}`)).toBe('');
  });

  it('needs exactly contents: read at the top, and refuses a job permission or a write', () => {
    expect(found(good.replace('permissions:\n  contents: read\n', 'permissions: {}\n'))).toContain('permissions must be a block');
    expect(found(good.replace('contents: read\n', 'contents: read\n  pull-requests: read\n'))).toContain('exactly contents: read');
    expect(found(good.replace('contents: read\n', 'contents: write\n'))).toContain('exactly contents: read');
    expect(found(good.replace('    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n'))).toContain('must not set its own permissions');
    expect(found(good.replace('    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    permissions:\n      issues: write\n'))).toContain('a write permission');
  });

  it('needs concurrency per ref with cancel-in-progress', () => {
    expect(found(good.replace(/concurrency:\n {2}group: .*\n {2}cancel-in-progress: true\n/, ''))).toContain('concurrency needs');
    expect(found(good.replace('cancel-in-progress: true', 'cancel-in-progress: false'))).toContain('concurrency needs');
    expect(found(good.replace('ci-${{ github.ref }}', 'ci'))).toContain('concurrency needs');
  });

  it('refuses an unpinned action and a missing version comment', () => {
    expect(found(good.replace(`actions/checkout@${SHA} # v7.0.1`, 'actions/checkout@v4'))).toContain('must be pinned to a 40 character commit');
    expect(found(good.replace(`actions/checkout@${SHA} # v7.0.1`, `actions/checkout@${SHA}`))).toContain('needs a "# v<version>" comment');
  });

  it('refuses a secret other than the token, a pro path and a private name', () => {
    expect(found(good.replace('echo ok', 'echo ${{ secrets.NPM_TOKEN }}'))).toContain('secrets.NPM_TOKEN');
    expect(found(good.replace('echo ok', 'echo ${{ secrets.GITHUB_TOKEN }}'))).toBe('');
    expect(found(good.replace('echo ok', 'node pro/scripts/x.js'))).toContain('a pro/ path');
    expect(found(good.replace('echo ok', 'echo scripts/lib/proDir.js'))).toBe('');
    expect(found(good.replace('echo ok', `gh repo view owner/${PRIVATE_REPO}`))).toContain('a private repository');
    expect(found(good.replace('echo ok', 'echo owner/some-app-releases'))).toContain('a private repository');
    expect(found(good.replace('echo ok', 'echo $RELEASES_TOKEN'))).toContain('a private repository');
  });

  it('refuses the risky triggers', () => {
    for (const t of ['pull_request_target:', 'workflow_run:\n    workflows: [CI]', 'schedule:\n    - cron: "1 1 * * 1"', 'workflow_call:']) {
      expect(found(good.replace('  pull_request:\n', `  ${t}\n  pull_request:\n`)), t).toContain('is not allowed in a public workflow');
    }
  });

  it('wants node 24', () => {
    expect(found(good.replace('node-version: 24', 'node-version: 22'))).toContain('node-version must be 24 (got 22)');
  });

  it('keeps a heavy job on a manual dispatch', () => {
    const heavy = (cond) => good.replace('  verify:', `  e2e:\n    name: e2e\n${cond}    runs-on: ubuntu-24.04\n    steps:\n      - run: npx playwright test\n  verify:`);
    expect(found(heavy(''))).toContain('job e2e: a heavy job needs');
    expect(found(heavy("    if: ${{ github.event_name == 'push' }}\n"))).toContain('job e2e: a heavy job needs');
    expect(found(heavy("    if: ${{ github.event_name == 'workflow_dispatch' && inputs.e2e }}\n"))).toBe('');
    expect(found(good.replace('echo ok', 'cargo test'))).toContain('a heavy job needs');
  });

  it('wants the file specific rules: ci.yml triggers and verify, desktop-check.yml by hand only', () => {
    expect(found(good.replace('  workflow_dispatch:\n', ''))).toContain('ci.yml must run on workflow_dispatch');
    expect(found(good.replace('id: verify', 'id: other').replace('  verify:', '  other:'))).toContain('the job verify must keep the id and the name verify');
    expect(found(good, 'desktop-check.yml')).toContain('desktop-check.yml must run on workflow_dispatch only');
  });

  it('keeps the structural rules: a tab, an em dash and a missing runs-on are refused', () => {
    expect(found(`${good}\t`)).toContain('tab');
    expect(found(`${good}# a ${String.fromCharCode(0x2014)} b\n`)).toContain('em or en dash');
    expect(found(good.replace('    runs-on: ubuntu-24.04\n', ''))).toContain('no runs-on or uses');
  });
});
