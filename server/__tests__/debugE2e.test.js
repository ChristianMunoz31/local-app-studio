// `npm run debug:e2e` (scripts/debugE2e.js): the plan and its refusals. Nothing here spawns Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { USAGE, main, planDebugE2e } from '../../scripts/debugE2e.js';

const exists = (p) => p === 'e2e/flows/design.spec.js';

describe('planDebugE2e', () => {
  it('runs one spec headed, one worker, no retries, with a trace, a video and APP_DEBUG=1', () => {
    const plan = planDebugE2e(['e2e/flows/design.spec.js'], { exists });
    expect(plan.argv).toEqual(['node_modules/@playwright/test/cli.js', 'test', 'e2e/flows/design.spec.js', '--headed', '--workers=1', '--retries=0', '--trace=on']);
    expect(plan.env).toEqual({ APP_DEBUG: '1', PW_VIDEO: 'on' });
  });

  it('passes --project and -g through, and accepts a Windows path', () => {
    const plan = planDebugE2e(['.\\e2e\\flows\\design.spec.js', '--project', 'flows', '-g', 'saves it'], { exists });
    expect(plan.argv.slice(-3)).toEqual(['--project=flows', '-g', 'saves it']);
    expect(plan.spec).toBe('e2e/flows/design.spec.js');
  });

  it('refuses a missing spec, a path outside e2e, a file that is not a spec and unknown options, with the usage line', () => {
    for (const argv of [[], ['--headed'], ['e2e/flows/nope.spec.js'], ['src/a.spec.js'], ['e2e/../x.spec.js'], ['e2e/flows/design.js'], ['e2e/flows/design.spec.js', '--workers', '4'], ['e2e/flows/design.spec.js', '--project'], ['e2e/flows/design.spec.js', '--project', 'a b'], ['e2e/flows/design.spec.js', '-g']]) {
      const plan = planDebugE2e(argv, { exists });
      expect(plan, JSON.stringify(argv)).toHaveProperty('error');
      expect(plan.error).toContain(USAGE);
    }
  });
});

describe('main', () => {
  it('exits 2 on a bad plan without running anything', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn();
    expect(main(['nope'], { run })).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the plan and says where the files are', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spec = fs.readdirSync(path.join(REPO_ROOT, 'e2e/flows')).find((f) => f.endsWith('.spec.js'));
    const run = vi.fn(() => 0);
    expect(main([`e2e/flows/${spec}`], { run })).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.join('\n')).toContain('test-results/');
    log.mockRestore();
  });
});

describe('package.json and playwright.config.js', () => {
  it('has the debug:e2e and doctor scripts', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['debug:e2e']).toBe('node scripts/debugE2e.js');
    expect(scripts.doctor).toBe('node --import ./scripts/lib/proHook.js scripts/doctor.js');
    expect(scripts['check:workflows']).toBe('node scripts/ci/workflowCheck.js');
    expect(scripts.check).toContain('npm run check:workflows');
  });

  it('keeps traces on failure, reads PW_VIDEO and APP_DEBUG, and turns its own retry off while classifying', () => {
    const config = fs.readFileSync(path.join(REPO_ROOT, 'playwright.config.js'), 'utf8');
    expect(config).toContain("trace: 'retain-on-failure'");
    expect(config).toContain('PW_VIDEO');
    expect(config).toContain("APP_DEBUG === '1'");
    expect(config).toContain("only-on-failure");
    expect(config).toContain('retries: classifying ? 0 : CI ? 1 : 0');
  });
});
