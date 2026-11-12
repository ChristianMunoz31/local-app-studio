// App mode resolution (ADR-001): APP_MODE, else the presence of config/app-spec.json, and the baked-mode rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveAppMode, getAppMode, parseAppMode, resetAppModeCache, resolveAppMode } from '../../appMode.js';

const tempRoots = [];
const makeRoot = ({ withSpec }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-mode-'));
  tempRoots.push(root);
  if (withSpec) {
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config', 'app-spec.json'), '{}');
  }
  return root;
};

afterEach(() => {
  while (tempRoots.length > 0) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('parseAppMode', () => {
  it('accepts studio and runtime, and treats blank as unset', () => {
    expect(parseAppMode('studio')).toBe('studio');
    expect(parseAppMode(' runtime ')).toBe('runtime');
    expect(parseAppMode('')).toBeNull();
    expect(parseAppMode(undefined)).toBeNull();
  });

  it('throws on anything else', () => {
    expect(() => parseAppMode('Studio')).toThrow(/must be one of studio, runtime/);
    expect(() => parseAppMode('prod')).toThrow(/got "prod"/);
  });
});

describe('resolveAppMode', () => {
  it('is studio when there is no baked spec and no override', () => {
    expect(resolveAppMode({}, { root: makeRoot({ withSpec: false }) })).toBe('studio');
  });

  it('is runtime when config/app-spec.json exists', () => {
    expect(resolveAppMode({}, { root: makeRoot({ withSpec: true }) })).toBe('runtime');
  });

  it('lets APP_MODE win over the spec file in both directions', () => {
    expect(resolveAppMode({ APP_MODE: 'studio' }, { root: makeRoot({ withSpec: true }) })).toBe('studio');
    expect(resolveAppMode({ APP_MODE: 'runtime' }, { root: makeRoot({ withSpec: false }) })).toBe('runtime');
  });

  it('throws on an invalid APP_MODE', () => {
    expect(() => resolveAppMode({ APP_MODE: 'nope' }, { root: makeRoot({ withSpec: false }) })).toThrow(/APP_MODE must be one of/);
  });

  it('is studio for this repo (no config/app-spec.json is committed)', () => {
    expect(resolveAppMode({})).toBe('studio');
  });
});

describe('effectiveAppMode (a bundle bakes its mode in)', () => {
  it('a source checkout resolves from the environment', () => {
    const root = makeRoot({ withSpec: true });
    expect(effectiveAppMode({}, undefined, { root })).toBe('runtime');
  });

  it('a runtime bundle is runtime and refuses APP_MODE=studio', () => {
    expect(effectiveAppMode({}, 'runtime')).toBe('runtime');
    expect(effectiveAppMode({ APP_MODE: 'runtime' }, 'runtime')).toBe('runtime');
    expect(() => effectiveAppMode({ APP_MODE: 'studio' }, 'runtime')).toThrow(/cannot run in studio mode/);
  });

  it('a studio bundle stays studio, and may be switched to runtime (the preview child)', () => {
    expect(effectiveAppMode({}, 'studio')).toBe('studio');
    expect(effectiveAppMode({ APP_MODE: 'studio' }, 'studio')).toBe('studio');
    expect(effectiveAppMode({ APP_MODE: 'runtime' }, 'studio')).toBe('runtime');
  });

  it('ignores config/app-spec.json when the mode is baked', () => {
    const root = makeRoot({ withSpec: true });
    expect(effectiveAppMode({}, 'studio', { root })).toBe('studio');
  });

  it('rejects a baked mode that is not studio or runtime', () => {
    expect(() => effectiveAppMode({}, 'staging')).toThrow(/baked app mode must be one of/);
  });
});

describe('getAppMode', () => {
  const saved = process.env.APP_MODE;
  beforeEach(() => resetAppModeCache());
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = saved;
    resetAppModeCache();
  });

  it('is studio under Vitest and is cached until reset', () => {
    delete process.env.APP_MODE;
    expect(getAppMode()).toBe('studio');
    process.env.APP_MODE = 'runtime';
    expect(getAppMode()).toBe('studio');
    resetAppModeCache();
    expect(getAppMode()).toBe('runtime');
  });
});
