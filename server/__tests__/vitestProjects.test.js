// Every test file must run in exactly one Vitest project: the three projects (frontend, pure, backend)
// together cover what the old two-project config covered, with no file in two projects.
import { existsSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config, { SRC_DOM_TESTS, resolveMaxWorkers } from '../../vitest.config.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The include globs of the two-project config this one replaced (phase 11, fac769b).
const OLD_PROJECTS = {
  frontend: ['src/**/__tests__/**/*.test.{js,jsx,ts,tsx}', 'packages/runtime/src/**/__tests__/**/*.test.{js,jsx,ts,tsx}'],
  backend: ['server/__tests__/**/*.test.js', 'packages/runtime/server/**/__tests__/**/*.test.js'],
};
// A pro run also runs the tests under pro/ (docs/ARCHITECTURE.md, 'The pro seam'): the front half in the frontend and pure
// projects, the server half in backend. A public run has no pro/ tests.
const PRO_TESTS = PUBLIC_BUILD ? [] : ['pro/src/**/__tests__/**/*.test.{js,jsx,ts,tsx}', 'pro/server/__tests__/**/*.test.js'];

/** Expands one `{a,b}` group so fs.globSync needs no brace support. */
function expandBraces(pattern) {
  const m = /\{([^{}]+)\}/.exec(pattern);
  if (!m) return [pattern];
  return m[1].split(',').flatMap((alt) => expandBraces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)));
}

function filesOf(include, exclude = []) {
  const found = include.flatMap(expandBraces).flatMap((p) => globSync(p, { cwd: ROOT, exclude: (name) => name === 'node_modules' }));
  const skip = new Set(exclude.filter((e) => !e.includes('*')));
  return found.map((f) => f.split(path.sep).join('/')).filter((f) => !skip.has(f));
}

describe('vitest projects', () => {
  const projects = config.test.projects.map((p) => ({ name: p.test.name, files: filesOf(p.test.include, p.test.exclude) }));
  const oldFiles = [...Object.values(OLD_PROJECTS).flatMap((include) => filesOf(include)), ...filesOf(PRO_TESTS)];

  it('has the frontend, pure and backend projects', () => {
    expect(projects.map((p) => p.name)).toEqual(['frontend', 'pure', 'backend']);
  });

  it('runs no file in two projects', () => {
    const seen = new Map();
    const twice = [];
    for (const p of projects) {
      for (const f of p.files) {
        if (seen.has(f)) twice.push(`${f}: ${seen.get(f)} and ${p.name}`);
        seen.set(f, p.name);
      }
    }
    expect(twice).toEqual([]);
  });

  it('runs exactly the files the old two projects ran', () => {
    const now = projects.flatMap((p) => p.files);
    expect(oldFiles.length).toBeGreaterThan(400);
    expect([...now].sort()).toEqual([...oldFiles].sort());
  });

  it('keeps every DOM test out of the node project and every .jsx/.tsx test in jsdom', () => {
    const pure = projects.find((p) => p.name === 'pure').files;
    const frontend = projects.find((p) => p.name === 'frontend').files;
    expect(pure.filter((f) => /\.test\.(jsx|tsx)$/.test(f))).toEqual([]);
    expect(frontend.filter((f) => !f.startsWith('src/') && !f.startsWith('packages/runtime/src/') && !f.startsWith('pro/src/'))).toEqual([]);
    expect(pure.length).toBeGreaterThan(50);
  });

  it('lists only SRC_DOM_TESTS files that exist, so a rename cannot leave a stale entry', () => {
    expect(SRC_DOM_TESTS.length).toBeGreaterThan(0);
    for (const f of SRC_DOM_TESTS) expect(existsSync(path.join(ROOT, f)), f).toBe(true);
  });
});

describe('resolveMaxWorkers', () => {
  it('takes an integer from 1 to the core count', () => {
    expect(resolveMaxWorkers('1', 8)).toBe(1);
    expect(resolveMaxWorkers('6', 8)).toBe(6);
    expect(resolveMaxWorkers('8', 8)).toBe(8);
  });

  it('falls back to the tuned count for anything else', () => {
    for (const bad of [undefined, '', '0', '-1', '9', '99999', '2.5', 'abc', '1e1', ' ']) {
      expect(resolveMaxWorkers(bad, 8), String(bad)).toBe(4);
    }
    expect(resolveMaxWorkers('-1', 2)).toBe(1);
    expect(resolveMaxWorkers(undefined, 1)).toBe(1);
  });
});
