// The pro seam (docs/ARCHITECTURE.md, 'The pro seam'): the resolver rules, the Vite and esbuild plugins, the Node resolve hook
// and the requireInBuild middleware. Plugins and the resolver run on a temp folder that stands in for the repo.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PRO_SEAMS, PUBLIC_BUILD_ENV, REPO_ROOT, isUnderProDir, proTwinOf, resolveProDir } from '../../scripts/lib/proDir.js';
import { planRun } from '../../scripts/lib/proRun.js';
import { proSeamEsbuildPlugin, proSeamVitePlugin } from '../../scripts/lib/proSeam.js';
import { initialize, resolve as hookResolve } from '../../scripts/lib/proResolveHook.js';
import { isProPartInBuild, requireInBuild, resolveBuildCloudAi } from '../buildFeatures.js';
import { PRO_PARTS } from '../../src/proParts.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const SEAM = 'src/proParts.js';
let root;
let extra;

const write = (base, rel, text) => {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-proseam-'));
  extra = fs.mkdtempSync(path.join(os.tmpdir(), 'las-proseam-extra-'));
  write(root, 'pro/server/.keep', '');
  write(root, 'pro/src/proParts.js', "export const WHO = 'twin';\n");
  write(root, 'src/proParts.js', "export const WHO = 'stub';\n");
  write(root, 'src/entry.js', "import { WHO } from './proParts.js';\nglobalThis.__who = WHO;\n");
  write(root, 'src/sneaky.js', "import { WHO } from '../pro/src/proParts.js';\nglobalThis.__who = WHO;\n");
  write(extra, 'src/proParts.js', "export const WHO = 'extra';\n");
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(extra, { recursive: true, force: true });
});

describe('PRO_SEAMS', () => {
  it('is a frozen list of repo-relative POSIX paths that starts with the build flag module', () => {
    expect(Object.isFrozen(PRO_SEAMS)).toBe(true);
    expect(PRO_SEAMS[0]).toBe(SEAM);
    for (const seam of PRO_SEAMS) expect(seam).toMatch(/^[A-Za-z0-9_./-]+$/);
  });

  it('forces a public build with APP_PRO_DIR=none', () => {
    expect(PUBLIC_BUILD_ENV).toEqual({ APP_PRO_DIR: 'none' });
    expect(Object.isFrozen(PUBLIC_BUILD_ENV)).toBe(true);
  });
});

describe('resolveProDir', () => {
  it('unset or empty: pro when <root>/pro/server is a folder', () => {
    expect(resolveProDir({}, root)).toEqual({ mode: 'pro', dir: path.join(root, 'pro') });
    expect(resolveProDir({ APP_PRO_DIR: '  ' }, root)).toEqual({ mode: 'pro', dir: path.join(root, 'pro') });
  });

  it('unset: public when there is no pro/server', () => {
    expect(resolveProDir({}, extra)).toEqual({ mode: 'public', dir: null });
  });

  it('none: public even when pro/ is present', () => {
    expect(resolveProDir({ APP_PRO_DIR: 'none' }, root)).toEqual({ mode: 'public', dir: null });
  });

  it('a folder: absolute or relative to the root', () => {
    expect(resolveProDir({ APP_PRO_DIR: extra }, root)).toEqual({ mode: 'pro', dir: extra });
    expect(resolveProDir({ APP_PRO_DIR: 'pro' }, root)).toEqual({ mode: 'pro', dir: path.join(root, 'pro') });
  });

  it('a folder that is not there fails closed', () => {
    expect(() => resolveProDir({ APP_PRO_DIR: path.join(root, 'nope') }, root)).toThrow(/does not exist/);
    expect(() => resolveProDir({ APP_PRO_DIR: 'None' }, root)).toThrow(/does not exist/);
  });
});

describe('proTwinOf', () => {
  const pro = () => resolveProDir({}, root);

  it('answers the twin of a seam in a pro build', () => {
    expect(proTwinOf(path.join(root, SEAM), pro(), root)).toBe(path.join(root, 'pro', SEAM));
    expect(proTwinOf(`${path.join(root, SEAM)}?v=1`, pro(), root)).toBe(path.join(root, 'pro', SEAM));
  });

  it('answers null for a public build, a non-seam, the twin itself and a file outside the root', () => {
    expect(proTwinOf(path.join(root, SEAM), { mode: 'public', dir: null }, root)).toBeNull();
    expect(proTwinOf(path.join(root, 'src', 'entry.js'), pro(), root)).toBeNull();
    expect(proTwinOf(path.join(root, 'pro', SEAM), pro(), root)).toBeNull();
    expect(proTwinOf(path.join(extra, SEAM), pro(), root)).toBeNull();
  });

  it('uses the folder of APP_PRO_DIR', () => {
    expect(proTwinOf(path.join(root, SEAM), resolveProDir({ APP_PRO_DIR: extra }, root), root)).toBe(path.join(extra, SEAM));
  });

  it.runIf(process.platform === 'win32')('ignores case on Windows', () => {
    expect(proTwinOf(path.join(root, 'SRC', 'PROPARTS.JS'), pro(), root)).toBe(path.join(root, 'pro', SEAM));
  });

  it('isUnderProDir tells pro/ from the rest', () => {
    expect(isUnderProDir(path.join(root, 'pro', 'src', 'x.js'), root)).toBe(true);
    expect(isUnderProDir(path.join(root, 'src', 'x.js'), root)).toBe(false);
    expect(isUnderProDir(path.join(root, 'pro'), root)).toBe(false);
  });
});

describe('proSeamVitePlugin', () => {
  const ctx = (id) => ({ resolve: vi.fn(async () => ({ id })), error: vi.fn((msg) => { throw new Error(msg); }) });
  const run = (plugin, source, c) => plugin.resolveId.call(c, source, path.join(root, 'src', 'entry.js'), {});

  it('is a pre plugin', () => {
    expect(proSeamVitePlugin(resolveProDir({}, root), { root }).enforce).toBe('pre');
  });

  it('pro: a resolved seam becomes its twin', async () => {
    const plugin = proSeamVitePlugin(resolveProDir({}, root), { root });
    expect(await run(plugin, './proParts.js', ctx(path.join(root, SEAM)))).toBe(path.join(root, 'pro', SEAM));
    expect(await run(plugin, '@/proParts', ctx(path.join(root, SEAM)))).toBe(path.join(root, 'pro', SEAM));
  });

  it('pro: anything else is left to Vite, and unrelated names are not even resolved', async () => {
    const plugin = proSeamVitePlugin(resolveProDir({}, root), { root });
    const other = ctx(path.join(root, 'src', 'other.js'));
    expect(await run(plugin, './other.js', other)).toBeNull();
    expect(other.resolve).not.toHaveBeenCalled();
    const lookalike = ctx(path.join(extra, SEAM));
    expect(await run(plugin, './proParts.js', lookalike)).toBeNull();
  });

  it('pro: an import that only ends like a seam (index.js, pro.js) is judged by its path and never resolved twice', async () => {
    const plugin = proSeamVitePlugin(resolveProDir({}, root), { root });
    const importer = path.join(root, 'server', 'x.js');
    for (const source of ['./db/index.js', '../src/other/index.js', '../pro.js', '@/components/index.js', '@/pro']) {
      const c = ctx(path.join(root, 'server', 'db', 'index.js'));
      expect(await plugin.resolveId.call(c, source, importer, {})).toBeNull();
      expect(c.resolve).not.toHaveBeenCalled();
    }
  });

  it('pro: a relative path that names a seam (with or without the extension) is still resolved and redirected', async () => {
    const plugin = proSeamVitePlugin(resolveProDir({}, root), { root });
    const importer = path.join(root, 'server', 'x.js');
    for (const source of ['./pro.js', './pro']) {
      const c = ctx(path.join(root, 'server', 'pro.js'));
      expect(await plugin.resolveId.call(c, source, importer, {})).toBe(path.join(root, 'pro', 'server', 'pro.js'));
      expect(c.resolve).toHaveBeenCalledTimes(1);
    }
  });

  it('pro: does not refuse a file under pro/', () => {
    const plugin = proSeamVitePlugin(resolveProDir({}, root), { root });
    expect(plugin.load.call(ctx(''), path.join(root, 'pro', 'src', 'proParts.js'))).toBeNull();
  });

  it('public: never redirects, and refuses to load a file under pro/', async () => {
    const plugin = proSeamVitePlugin({ mode: 'public', dir: null }, { root });
    expect(await run(plugin, './proParts.js', ctx(path.join(root, SEAM)))).toBeNull();
    expect(plugin.load.call(ctx(''), path.join(root, 'src', 'proParts.js'))).toBeNull();
    expect(() => plugin.load.call(ctx(''), `${path.join(root, 'pro', 'src', 'proParts.js')}?x=1`)).toThrow(/pro code and must not be in a public build/);
  });
});

describe('proSeamEsbuildPlugin', () => {
  const bundle = async (entry, resolved) => {
    const out = await build({
      entryPoints: [path.join(root, entry)],
      write: false,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [proSeamEsbuildPlugin(resolved, { root })],
    });
    return out.outputFiles[0].text;
  };

  it('pro: the bundle holds the twin, not the stub', async () => {
    const text = await bundle('src/entry.js', resolveProDir({}, root));
    expect(text).toContain('"twin"');
    expect(text).not.toContain('"stub"');
  });

  it('public: the bundle holds the stub', async () => {
    const text = await bundle('src/entry.js', { mode: 'public', dir: null });
    expect(text).toContain('"stub"');
    expect(text).not.toContain('"twin"');
  });

  it('public: a file under pro/ is a build error that names the file', async () => {
    await expect(bundle('src/sneaky.js', { mode: 'public', dir: null })).rejects.toThrow(/pro\/src\/proParts\.js is pro code and must not be in a public build/);
  });

  it('pro: a file under pro/ that is not a seam still builds (a twin imports its pro neighbours)', async () => {
    const text = await bundle('src/sneaky.js', resolveProDir({}, root));
    expect(text).toContain('"twin"');
  });
});

describe('the Node resolve hook', () => {
  const next = vi.fn(async (specifier) => ({ url: specifier, shortCircuit: true }));

  it('redirects a seam URL to its twin in a pro build', async () => {
    initialize({ dir: path.join(root, 'pro'), mode: 'pro', root });
    const url = pathToFileURL(path.join(root, SEAM)).href;
    const out = await hookResolve(url, {}, next);
    expect(out.url).toBe(pathToFileURL(path.join(root, 'pro', SEAM)).href);
    const other = pathToFileURL(path.join(root, 'src', 'entry.js')).href;
    expect((await hookResolve(other, {}, next)).url).toBe(other);
    expect((await hookResolve('node:fs', {}, next)).url).toBe('node:fs');
  });

  it('does nothing without a pro folder', async () => {
    initialize({ dir: null, root });
    const url = pathToFileURL(path.join(root, SEAM)).href;
    expect((await hookResolve(url, {}, next)).url).toBe(url);
  });

  // The real thing: the --import hook decides the build, redirects the stub and writes the decision back to the environment.
  const probe = (apiEnv) => {
    const code = "const m = await import('./src/proParts.js'); console.log(JSON.stringify({ helper: m.PRO_PARTS.helper, dir: process.env.APP_PRO_DIR }));";
    const res = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(REPO_ROOT, 'scripts', 'lib', 'proHook.js')).href, '--input-type=module', '-e', code], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...apiEnv },
    });
    expect(res.status, res.stderr).toBe(0);
    return JSON.parse(res.stdout.trim());
  };

  it.skipIf(PUBLIC_BUILD)('an unbundled run: pro when pro/ is present, and the decision goes back to APP_PRO_DIR', () => {
    const out = probe({ APP_PRO_DIR: '' });
    expect(out.helper).toBe(true);
    expect(out.dir).toBe(path.join(REPO_ROOT, 'pro'));
  });

  it('an unbundled run: APP_PRO_DIR=none keeps the stubs', () => {
    expect(probe({ APP_PRO_DIR: 'none' })).toEqual({ helper: false, dir: 'none' });
  });
});

describe('proRun', () => {
  const run = (args, env) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'lib', 'proRun.js'), ...args], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...env } });

  it('runs the stub of a CLI in a public build: one plain sentence and exit 1', () => {
    const res = run(['scripts/evalAi.js'], { APP_PRO_DIR: 'none' });
    expect(res.status).toBe(1);
    expect(res.stderr.trim()).toBe('The real-model eval is not in this build.');
  });

  it('needs a script to run', () => {
    expect(run([], { APP_PRO_DIR: 'none' }).status).toBe(2);
  });

  it('refuses a path that is not a pro seam, in a public and in a pro build, in one line', () => {
    for (const env of [{ APP_PRO_DIR: 'none' }, {}]) {
      for (const bad of ['scripts/doctor.js', '../outside.js', 'scripts/lib/proRun.js', 'pro/scripts/evalAi.js', 'package.json']) {
        const res = run([bad], env);
        expect(res.status, bad).toBe(1);
        expect(res.stderr.trim().split('\n'), bad).toHaveLength(1);
        expect(res.stderr, bad).toMatch(/runs only pro seams/);
      }
    }
  });

  it('planRun: a seam runs the stub in a public build and the twin in a pro build; a missing twin is one line', () => {
    const fake = path.join(os.tmpdir(), 'las-prorun-root');
    const missing = planRun('./scripts\\evalAi.js', { mode: 'pro', dir: path.join(fake, 'pro') }, fake);
    expect(missing.error).toContain('is missing');
    expect(missing.error).not.toContain('\n');
    expect(planRun('scripts/evalAi.js', { mode: 'public', dir: null }, REPO_ROOT)).toEqual({ script: path.join(REPO_ROOT, 'scripts', 'evalAi.js') });
    expect(planRun('scripts/other.js', { mode: 'public', dir: null }, REPO_ROOT).error).toContain('only pro seams');
    if (fs.existsSync(path.join(REPO_ROOT, 'pro', 'server'))) {
      expect(planRun('scripts/evalAi.js', { mode: 'pro', dir: path.join(REPO_ROOT, 'pro') })).toEqual({ script: path.join(REPO_ROOT, 'pro', 'scripts', 'evalAi.js') });
    }
  });
});

describe('requireInBuild', () => {
  const appWith = (parts, order) => {
    const app = express();
    app.use((req, _res, next) => {
      order.push('before');
      next();
    });
    app.post('/api/x', requireInBuild('helper', parts), express.json(), (_req, res) => {
      order.push('handler');
      res.json({ ok: true });
    });
    return app;
  };

  it('knows the parts', () => {
    expect(isProPartInBuild('helper', { helper: true })).toBe(true);
    expect(isProPartInBuild('helper', { helper: false })).toBe(false);
    expect(isProPartInBuild('nope', { helper: true })).toBe(false);
    expect(() => requireInBuild('nope')).toThrow(/Unknown pro part/);
  });

  it('a build without the part answers the 403 feature_unavailable envelope, no-store, before the body is read', async () => {
    const order = [];
    const res = await request(appWith({ helper: false }, order)).post('/api/x').set('Content-Type', 'application/json').send('{not json');
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      code: 'feature_unavailable',
      feature: 'helper',
      error: 'The helper is not in this build. Build it yourself in Design.',
      message: 'The helper is not in this build. Build it yourself in Design.',
    });
    expect(typeof res.body.requestId).toBe('string');
    expect(typeof res.body.action).toBe('string');
    expect(order).toEqual(['before']);
  });

  it('the installer sentence is its own', async () => {
    const app = express();
    app.get('/api/y', requireInBuild('installer', { installer: false }), (_req, res) => res.json({}));
    const res = await request(app).get('/api/y');
    expect(res.body).toMatchObject({ code: 'feature_unavailable', feature: 'installer', error: 'Making an installer is not in this build. Export the app instead.' });
  });

  it('a build with the part lets the request through', async () => {
    const order = [];
    const res = await request(appWith({ helper: true }, order)).post('/api/x').send({});
    expect(res.status).toBe(200);
    expect(order).toEqual(['before', 'handler']);
  });

  it('runs before requireAi in the middleware order of a route (the gate comes first)', async () => {
    const calls = [];
    const app = express();
    app.post('/api/z', requireInBuild('helper', { helper: false }), (_req, _res, next) => {
      calls.push('requireAi');
      next();
    }, (_req, res) => res.json({}));
    const res = await request(app).post('/api/z');
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('this run reads the real flag module', () => {
    expect(isProPartInBuild('helper')).toBe(!PUBLIC_BUILD);
    expect(PRO_PARTS.cloud).toBe(!PUBLIC_BUILD);
  });
});

describe('resolveBuildCloudAi in a public build', () => {
  const PUBLIC = { mode: 'public', dir: null };
  const PRO = { mode: 'pro', dir: '/x' };

  it('answers off, and refuses an explicit on', () => {
    expect(resolveBuildCloudAi({}, 'APP_CLOUD_AI', PUBLIC)).toBe('off');
    expect(resolveBuildCloudAi({ APP_CLOUD_AI: 'off' }, 'APP_CLOUD_AI', PUBLIC)).toBe('off');
    expect(() => resolveBuildCloudAi({ APP_CLOUD_AI: 'on' }, 'APP_CLOUD_AI', PUBLIC)).toThrow('The cloud provider is not in a public build.');
    expect(() => resolveBuildCloudAi({ APP_CLOUD_AI: 'x' }, '--cloud-ai', PUBLIC)).toThrow('--cloud-ai must be one of on, off (got "x")');
  });

  it('a pro build and a call without the resolved folder behave as before', () => {
    expect(resolveBuildCloudAi({}, 'APP_CLOUD_AI', PRO)).toBe('on');
    expect(resolveBuildCloudAi({ APP_CLOUD_AI: 'on' })).toBe('on');
  });
});
