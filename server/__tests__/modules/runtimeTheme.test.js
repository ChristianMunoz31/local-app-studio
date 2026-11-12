// A runtime build of a themed app (phase 7): the baked spec keeps its theme block unchanged, the runtime UI graph carries
// the theme engine files and no Studio, showcase, design, theme-editor, dnd-kit or vendored editor code, and the startup
// code applies only contract variables with safe values (a tampered baked theme falls back through sanitizeTheme).
// Uses the modeBuild harness (real Vite build in runtime mode).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build as viteBuild } from 'vite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readBakedSpecJson, studioUiPlugin } from '../../../scripts/desktop/modeBuild.js';
import { RUNTIME_ALIASES } from '../../../scripts/lib/runtimeAlias.js';
import { startRuntimeTheme } from '@local-app-studio/runtime/theme/applyRoot.ts';
import { sanitizeTheme } from '@local-app-studio/runtime/theme/sanitize.ts';
import { LEGACY_VARIABLES, THEME_VARIABLES } from '@local-app-studio/runtime/theme/variables.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));

/** The saved spec: the Crew Roster fixture with the Forest theme and an accent hue override. */
const SAVED_SPEC = { ...FIXTURE, theme: { id: 'forest', preset: 'forest', radius: 'md', overrides: { accentHue: 120 } } };

let tempRoot;
let bakedText;
let graph;
let code;

beforeAll(async () => {
  // The real path: config/app-spec.json in a build root, read by readBakedSpecJson, served by the plugin.
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-theme-'));
  fs.mkdirSync(path.join(tempRoot, 'config'));
  fs.writeFileSync(path.join(tempRoot, 'config', 'app-spec.json'), JSON.stringify(SAVED_SPEC, null, 2));
  bakedText = readBakedSpecJson(tempRoot);

  const out = await viteBuild({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: RUNTIME_ALIASES },
    define: { __APP_MODE__: JSON.stringify('runtime') },
    plugins: [react(), studioUiPlugin('runtime', { specJson: bakedText })],
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(ROOT, 'src/modules/index.js'), formats: ['es'], fileName: 'out' },
      rolldownOptions: { external: (id) => id !== 'virtual:app-spec' && !id.startsWith('.') && !id.startsWith('\0') && !id.startsWith('@/') && !id.startsWith('@local-app-studio/runtime/') && !path.isAbsolute(id) },
    },
  });
  const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  graph = chunks.flatMap((c) => Object.keys(c.modules)).map((id) => id.split('\\').join('/'));
  code = chunks.map((c) => c.code).join('\n');
}, 180_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the runtime build of a themed app', () => {
  const has = (fragment) => graph.some((id) => id.includes(fragment));

  it('bakes the saved spec unchanged, theme block included', () => {
    expect(JSON.parse(bakedText)).toEqual(SAVED_SPEC);
    expect(JSON.parse(bakedText).theme).toEqual({ id: 'forest', preset: 'forest', radius: 'md', overrides: { accentHue: 120 } });
    // The spec text reaches the built chunks as data (the virtual module), with the theme in it.
    expect(code).toContain('"forest"');
    expect(code).toContain('accentHue');
    expect(code).toContain('Crew Roster');
    expect(has('virtual:app-spec')).toBe(true);
  });

  it('holds the theme engine files the startup code needs', () => {
    for (const file of ['ids', 'themes', 'variables', 'color', 'sanitize', 'resolve', 'applyRoot']) {
      expect(has(`/src/theme/${file}.ts`), `src/theme/${file}.ts`).toBe(true);
    }
  });

  it('holds no Studio, showcase, design, theme-editor, dnd-kit or vendored editor code', () => {
    expect(has('/src/studio/')).toBe(false);
    expect(has('/src/studio/design')).toBe(false);
    expect(has('/src/studio/showcase')).toBe(false);
    expect(has('/src/studio/theme')).toBe(false);
    expect(graph.filter((id) => id.includes('@dnd-kit'))).toEqual([]);
    expect(has('/src/vendor/')).toBe(false);
    expect(has('/src/modules/studio.jsx')).toBe(false);
    expect(has('/node_modules/zod/')).toBe(false);
  });
});

/** A minimal DOM: only what startRuntimeTheme touches. */
function fakeDom({ light = false } = {}) {
  const set = new Map();
  const classes = new Set(light ? ['light'] : []);
  const root = {
    classList: { contains: (c) => classes.has(c) },
    style: { setProperty: (name, value) => set.set(name, value), removeProperty: (name) => set.delete(name) },
  };
  const body = { style: {} };
  vi.stubGlobal('document', { documentElement: root, body });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  return { set, body };
}

const UNSAFE = [/[;{}<>"]/, /url\(/i, /expression/i, /@import/i, /\/\*/];
const expectSafe = (set) => {
  expect(set.size).toBeGreaterThan(0);
  for (const [name, value] of set) {
    expect(THEME_VARIABLES, name).toContain(name);
    expect(typeof value, name).toBe('string');
    for (const re of UNSAFE) expect(value, `${name}: ${value}`).not.toMatch(re);
  }
};

describe('applying the baked theme at startup', () => {
  it('sets only contract names with safe values, in both modes', () => {
    for (const light of [false, true]) {
      const { set } = fakeDom({ light });
      const handle = startRuntimeTheme(SAVED_SPEC.theme);
      expect(handle.label).toBe('Forest');
      expect(handle.mode).toBe('dark');
      expectSafe(set);
      expect(set.has('--brand')).toBe(true);
      expect(set.has('--font-sans')).toBe(true);
      handle.stop();
      expect(set.size).toBe(0);
    }
  });

  it('applies the accent hue override (the accent differs from the same theme without it)', () => {
    const a = fakeDom();
    startRuntimeTheme({ id: 'forest', preset: 'forest', radius: 'md', overrides: { accentHue: 120 } });
    const withHue = a.set.get('--brand');
    const b = fakeDom();
    startRuntimeTheme({ id: 'forest', preset: 'forest', radius: 'md' });
    expect(withHue).toBeTruthy();
    expect(withHue).not.toBe(b.set.get('--brand'));
  });

  it('a spec without a theme id sets only the corners and hands the glow back as the default background', () => {
    const { set } = fakeDom();
    const handle = startRuntimeTheme({ preset: 'aurora', radius: 'md' });
    expect(handle.label).toBe('Classic');
    expect(handle.themed).toBe(false);
    expect(handle.background).toBe('aurora');
    expect([...set.keys()].sort()).toEqual(LEGACY_VARIABLES.filter((n) => !n.startsWith('--mesh-')).sort());
    expectSafe(set);
  });
});

describe('a tampered baked theme falls back safely', () => {
  const TAMPERED = [
    ['raw CSS in the id', { id: 'forest; background:url(//evil.example/x)', preset: 'aurora', radius: 'md' }],
    ['a style-closing id', { id: '</style><script>x</script>', preset: 'aurora', radius: 'md' }],
    ['a CSS string for the preset', { preset: 'a{b:c}', radius: 'url(x)' }],
    ['a __proto__ key', JSON.parse('{"__proto__":{"id":"forest"},"preset":"aurora","radius":"md"}')],
    ['a __proto__ key inside overrides', JSON.parse('{"id":"forest","overrides":{"__proto__":{"accentHue":5}}}')],
    ['null', null],
    ['a string', 'forest'],
    ['an array', ['forest']],
  ];

  it.each(TAMPERED)('%s: no theme id survives sanitizeTheme', (_name, raw) => {
    const s = sanitizeTheme(raw);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'overrides')) {
      expect(s.id).toBe('forest');
      expect(s.accentHue).toBeNull();
    } else {
      expect(s.id).toBeNull();
    }
    expect(Object.prototype.hasOwnProperty.call(s, '__proto__')).toBe(false);
    expect(({}).polluted).toBeUndefined();
  });

  it.each(TAMPERED)('%s: startup sets only safe contract names', (_name, raw) => {
    const { set } = fakeDom();
    const handle = startRuntimeTheme(raw);
    expectSafe(set);
    expect(['Classic', 'Forest']).toContain(handle.label);
    handle.stop();
  });

  it.each([
    ['too large', 360],
    ['negative', -1],
    ['fractional', 12.5],
    ['a string', '120'],
    ['a CSS string', '120;} body{display:none'],
    ['not finite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('an accent hue that is %s is dropped, the valid theme id is kept', (_name, hue) => {
    const s = sanitizeTheme({ id: 'forest', preset: 'forest', radius: 'md', overrides: { accentHue: hue } });
    expect(s.id).toBe('forest');
    expect(s.accentHue).toBeNull();
    const { set } = fakeDom();
    startRuntimeTheme({ id: 'forest', overrides: { accentHue: hue } });
    expectSafe(set);
  });

  it('the bounds of the accent hue are accepted', () => {
    expect(sanitizeTheme({ id: 'forest', overrides: { accentHue: 0 } }).accentHue).toBe(0);
    expect(sanitizeTheme({ id: 'forest', overrides: { accentHue: 359 } }).accentHue).toBe(359);
  });

  it('overrides without an id are ignored (the legacy look)', () => {
    const s = sanitizeTheme({ preset: 'aurora', radius: 'md', overrides: { accentHue: 10 } });
    expect(s.id).toBeNull();
    expect(s.accentHue).toBeNull();
  });
});
