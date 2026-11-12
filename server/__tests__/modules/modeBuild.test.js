// The build seams of the app mode (scripts/desktop/modeBuild.js): real esbuild and Vite builds in studio and runtime
// mode. A runtime build swaps the Studio seam files for stubs and fails if Studio code, the editor entry, or (server)
// zod and the spec schema are still pulled in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBakedSpecJson, resolveBuildAppMode, studioServerPlugin, studioUiPlugin } from '../../../scripts/desktop/modeBuild.js';
import { bundleDefine } from '../../../scripts/desktop/workerBundle.js';
import { RUNTIME_ALIASES } from '../../../scripts/lib/runtimeAlias.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const posix = (...parts) => path.join(ROOT, ...parts).split(path.sep).join('/');

const bundleServer = async (mode, contents = null) => {
  const result = await esbuild({
    ...(contents === null ? { entryPoints: [path.join(ROOT, 'server', 'entry.js')] } : { stdin: { contents, resolveDir: ROOT, loader: 'js' } }),
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    legalComments: 'none',
    logLevel: 'silent',
    define: bundleDefine('0.0.0', { appMode: mode, buildDate: '2026-01-01T00:00:00.000Z' }),
    plugins: [studioServerPlugin(mode)],
  });
  return result.outputFiles[0].text;
};

const bundleUi = async (mode, entry) => {
  const out = await viteBuild({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: RUNTIME_ALIASES },
    define: { __APP_MODE__: JSON.stringify(mode) },
    plugins: [react(), studioUiPlugin(mode)],
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(ROOT, entry), formats: ['es'], fileName: 'out' },
      rolldownOptions: { external: (id) => !id.startsWith('.') && !id.startsWith('\0') && !id.startsWith('@/') && !id.startsWith('@local-app-studio/runtime/') && !path.isAbsolute(id) },
    },
  });
  const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  return chunks.flatMap((c) => Object.keys(c.modules)).map((id) => id.split('\\').join('/'));
};

const results = {};
beforeAll(async () => {
  [results.serverStudio, results.serverRuntime, results.uiStudio, results.uiRuntime] = await Promise.all([
    bundleServer('studio'),
    bundleServer('runtime'),
    bundleUi('studio', 'src/modules/index.js'),
    bundleUi('runtime', 'src/modules/index.js'),
  ]);
}, 180_000);

describe('server bundle (esbuild)', () => {
  it('studio mode carries the Studio routes, zod and the spec schema (Node type stripping and esbuild agree on the .ts imports)', () => {
    expect(results.serverStudio).toContain('server/studio/routes.js');
    expect(results.serverStudio).toContain('packages/runtime/src/spec/schema.ts');
    expect(results.serverStudio).toContain('src/catalog/validateLayout.ts');
    expect(results.serverStudio).toContain('node_modules/zod/');
    expect(results.serverStudio).toContain('preview_not_running');
  });

  it('runtime mode swaps every Studio seam for its stub and carries no Studio code, zod or spec schema', () => {
    const out = results.serverRuntime;
    expect(out).toContain('server/modules/studio.disabled.js');
    expect(out).toContain('server/modules/studio.data.disabled.js');
    expect(out).toContain('server/modules/studio.tools.disabled.js');
    expect(out).not.toContain('server/modules/studio.tools.js');
    expect(out).not.toContain('expandFeature');
    expect(out).toContain('src/modules/studio.assistant.disabled.js');
    expect(out).not.toContain('server/studio/');
    expect(out).not.toContain('packages/runtime/src/spec/schema.ts');
    expect(out).not.toContain('src/catalog/');
    expect(out).not.toContain('node_modules/zod/');
    expect(out).not.toContain('preview_not_running');
    expect(out).not.toContain('runtime-template');
    expect(out).not.toContain('taskkill.exe');
    expect(out).not.toMatch(/ZodError|\$ZodType/);
    expect(out).toContain('"runtime"');
  });

  it('runtime mode bundles the pure compiler (no zod, no schema)', async () => {
    const out = await bundleServer('runtime', "import { compileSpec } from './server/spec/compile.js'; console.log(compileSpec);");
    expect(out).toContain('STRICT');
  });

  it.each([
    ['Studio server code', "import './server/studio/routes.js';", /server\/studio\/routes\.js must not be in a runtime build/],
    ['the spec schema', "import './packages/runtime/src/spec/schema.ts';", /src\/spec\/schema\.ts must not be in a runtime build/],
    ['the spec index (it re-exports the schema)', "import './server/spec/index.js';", /src\/spec\/schema\.ts must not be in a runtime build/],
    ['the feature library', "import './src/catalog/features/index.ts';", /catalog[/]features[/]index[.]ts must not be in a runtime build/],
    ['zod', "import 'zod';", /node_modules\/zod\/.* must not be in a runtime build|must not be in a runtime build/],
    ['the Studio module around the seam', "import { registerStudioRoutes } from './server/studio/routes.js'; registerStudioRoutes();", /must not be in a runtime build/],
  ])('runtime mode fails the build when %s is imported', async (_name, contents, message) => {
    await expect(bundleServer('runtime', contents)).rejects.toThrow(message);
  });

  it('studio mode allows the same imports', async () => {
    await expect(bundleServer('studio', "import { registerStudioRoutes } from './server/studio/routes.js'; import 'zod'; console.log(registerStudioRoutes);")).resolves.toContain('server/studio/routes.js');
  });
});

describe('web UI build (Vite)', () => {
  const has = (ids, fragment) => ids.some((id) => id.includes(fragment));

  it('studio mode includes the Design and Preview tabs, the Design canvas, and not the vendored editor', () => {
    expect(has(results.uiStudio, '/src/modules/studio.jsx')).toBe(true);
    expect(has(results.uiStudio, '/src/studio/pages/DesignTab.tsx')).toBe(true);
    expect(has(results.uiStudio, '/src/studio/pages/PreviewTab.tsx')).toBe(true);
    expect(has(results.uiStudio, '/src/studio/design/DesignCanvas.tsx')).toBe(true);
    expect(has(results.uiStudio, '/src/vendor/ui-builder/')).toBe(false);
  });

  it('runtime mode loads the stubs and nothing from src/studio, the Design canvas, the vendored editor or zod', () => {
    expect(has(results.uiRuntime, '/src/modules/studio.disabled.jsx')).toBe(true);
    expect(has(results.uiRuntime, '/src/modules/studio.jsx')).toBe(false);
    expect(has(results.uiRuntime, '/src/studio/')).toBe(false);
    expect(has(results.uiRuntime, '/src/catalog/features/')).toBe(false);
    expect(has(results.uiRuntime, '/src/studio/design/')).toBe(false);
    expect(has(results.uiRuntime, '/src/studio/showcase/')).toBe(false);
    expect(has(results.uiRuntime, '/src/vendor/ui-builder/')).toBe(false);
    // Phase 2: runtime pages render catalog parts through the zod-free component map, never the vendored tree.
    expect(has(results.uiRuntime, '/src/catalog/components.ts')).toBe(true);
    expect(has(results.uiRuntime, '/src/vendor/')).toBe(false);
    expect(has(results.uiRuntime, '/node_modules/zod/')).toBe(false);
  });

  it('runtime mode swaps the Assistant page seam too', async () => {
    const ids = await bundleUi('runtime', 'src/constants/assistantPages.js');
    expect(has(ids, '/src/modules/studio.assistant.disabled.js')).toBe(true);
    expect(has(ids, '/src/modules/studio.assistant.js')).toBe(false);
  });

  it('runtime mode fails the build when Studio code is imported around the seam', async () => {
    await expect(bundleUi('runtime', 'src/studio/pages/PreviewTab.tsx')).rejects.toThrow(/src\/studio\/pages\/PreviewTab\.tsx must not be in a runtime build/);
    await expect(bundleUi('runtime', 'src/catalog/features/index.ts')).rejects.toThrow(/catalog[/]features[/]index[.]ts must not be in a runtime build/);
    await expect(bundleUi('runtime', 'src/vendor/ui-builder/components/ui/ui-builder/index.tsx')).rejects.toThrow(/must not be in a runtime build/);
  });
});

describe('plugins and defines', () => {
  it('reject a mode that is not studio or runtime', () => {
    expect(() => studioUiPlugin('maybe')).toThrow(/app mode must be one of studio, runtime/);
    expect(() => studioServerPlugin('maybe')).toThrow(/app mode must be one of studio, runtime/);
    expect(() => bundleDefine('1.0.0', { appMode: 'maybe' })).toThrow(/Unknown app mode "maybe"/);
  });

  it('bundleDefine bakes the mode and the spec text (a string literal; "null" when there is none)', () => {
    const studio = bundleDefine('1.0.0');
    expect(studio.__APP_MODE__).toBe('"studio"');
    expect(JSON.parse(studio.__APP_SPEC_JSON__)).toBe('null');
    const spec = JSON.stringify({ specVersion: 1 });
    const runtime = bundleDefine('1.0.0', { appMode: 'runtime', appSpecJson: spec });
    expect(runtime.__APP_MODE__).toBe('"runtime"');
    expect(JSON.parse(runtime.__APP_SPEC_JSON__)).toBe(spec);
    expect(JSON.parse(bundleDefine('1.0.0', { appMode: 'studio', appSpecJson: spec }).__APP_SPEC_JSON__)).toBe('null');
  });

  it('serves virtual:app-spec: the spec in a runtime build, null in studio', () => {
    const load = (plugin) => plugin.load.call({ error: (m) => { throw new Error(m); } }, plugin.resolveId('virtual:app-spec'));
    expect(load(studioUiPlugin('studio', { specJson: '{"a":1}' }))).toBe('export default null;');
    expect(load(studioUiPlugin('runtime', { specJson: '{"a":1}' }))).toBe('export default {"a":1};');
    expect(load(studioUiPlugin('runtime'))).toBe('export default null;');
  });

  it('resolveBuildAppMode and readBakedSpecJson follow config/app-spec.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-build-'));
    try {
      expect(resolveBuildAppMode({}, root)).toBe('studio');
      expect(readBakedSpecJson(root)).toBeNull();
      fs.mkdirSync(path.join(root, 'config'));
      fs.writeFileSync(path.join(root, 'config', 'app-spec.json'), '{ "specVersion": 1,\n "pages": [] }');
      expect(resolveBuildAppMode({}, root)).toBe('runtime');
      expect(resolveBuildAppMode({ APP_MODE: 'studio' }, root)).toBe('studio');
      expect(readBakedSpecJson(root)).toBe('{"specVersion":1,"pages":[]}');
      fs.writeFileSync(path.join(root, 'config', 'app-spec.json'), '{ nope');
      expect(() => readBakedSpecJson(root)).toThrow(/not valid JSON/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('the UI build and the sidecar build resolve the mode through resolveBuildAppMode, never separately', () => {
    for (const file of ['vite.config.js', path.join('scripts', 'desktop', 'buildSidecar.js')]) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source, file).toMatch(/\bresolveBuildAppMode\(process\.env, (root|ROOT)\)/);
      expect(source.replace(/resolveBuildAppMode/g, ''), file).not.toMatch(/\bresolveAppMode\b/);
    }
  });

  it('the sidecar build records the mode it baked in for check:sidecar', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'desktop', 'buildSidecar.js'), 'utf8');
    expect(source).toMatch(/bundle-meta\.json'\), `\$\{JSON\.stringify\(\{ appMode \}\)\}/);
  });

  it('this repo is a studio checkout', () => {
    expect(resolveBuildAppMode({}, ROOT)).toBe('studio');
    expect(posix('config', 'app-spec.json')).toMatch(/config\/app-spec\.json$/);
    expect(fs.existsSync(path.join(ROOT, 'config', 'app-spec.json'))).toBe(false);
  });
});
