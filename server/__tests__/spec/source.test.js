// Spec source resolution (ADR-001): baked, file, path and none, driven through the injectable parameters.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSpecSource, readSpecFile, getAppSpec, getCompiledSpec, resetAppSpecCache } from '../../spec/source.js';

const FIXTURE_FILE = fileFixture();
function fileFixture() {
  return path.resolve(import.meta.dirname, '../../../packages/runtime/src/spec/fixtures/crew-roster.json');
}
const fixtureText = fs.readFileSync(FIXTURE_FILE, 'utf8');

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-spec-source-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveSpecSource', () => {
  it('studio mode has no spec', () => {
    expect(resolveSpecSource({ mode: 'studio', env: { APP_SPEC_PATH: FIXTURE_FILE }, bundledMode: undefined, root })).toEqual({ kind: 'none', spec: null });
  });

  it('a runtime bundle reads the baked JSON and ignores APP_SPEC_PATH', () => {
    const out = resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: fixtureText, env: { APP_SPEC_PATH: '/nope' }, root });
    expect(out.kind).toBe('baked');
    expect(out.spec.app.name).toBe('Crew Roster');
    expect(out.spec.theme).toEqual({ preset: 'aurora', radius: 'md' });
    expect(resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: 'null', env: {}, root }).kind).toBe('none');
    expect(resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: undefined, env: {}, root }).kind).toBe('none');
  });

  it('a studio bundle in runtime mode reads APP_SPEC_PATH only', () => {
    const out = resolveSpecSource({ mode: 'runtime', bundledMode: 'studio', env: { APP_SPEC_PATH: FIXTURE_FILE }, root });
    expect(out.kind).toBe('path');
    expect(resolveSpecSource({ mode: 'runtime', bundledMode: 'studio', env: {}, root }).kind).toBe('none');
  });

  it('an unbundled server prefers config/app-spec.json, then APP_SPEC_PATH, then none', () => {
    const env = { APP_SPEC_PATH: FIXTURE_FILE };
    expect(resolveSpecSource({ mode: 'runtime', bundledMode: undefined, env, root }).kind).toBe('path');
    expect(resolveSpecSource({ mode: 'runtime', bundledMode: undefined, env: {}, root }).kind).toBe('none');
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'app-spec.json'), fixtureText);
    expect(resolveSpecSource({ mode: 'runtime', bundledMode: undefined, env, root }).kind).toBe('file');
  });

  it('fails loudly on an unreadable or invalid spec', () => {
    expect(() => readSpecFile(path.join(root, 'missing.json'))).toThrow('app_spec_unreadable');
    expect(() => resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: '{oops', root })).toThrow('app_spec_unreadable');
    expect(() => resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: '{"specVersion":2}', root })).toThrow(/^app_spec_invalid: /);
  });
});

describe('cached accessors', () => {
  it('are null in studio mode', () => {
    resetAppSpecCache();
    expect(getAppSpec()).toBeNull();
    expect(getCompiledSpec()).toBeNull();
  });
});
