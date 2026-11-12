// scripts/checks/proMarker.js: the scanner behind check:pro-marker on synthetic artifacts, and the ties that keep the lists real.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRO_SEAMS, REPO_ROOT } from '../../scripts/lib/proDir.js';
import {
  EXPECTED_SEAMS,
  PRO_MARKER_PREFIX,
  PRO_ONLY_STRINGS,
  checkDistDir,
  checkServerArtifact,
  checkSource,
  kindFromMeta,
  main,
  markerOf,
  mayImportFromPro,
  proSpecifiersIn,
} from '../../scripts/checks/proMarker.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const HAS_PRO = fs.existsSync(path.join(REPO_ROOT, 'pro', 'server'));
let dir;
let n = 0;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-marker-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const tree = (files) => {
  const root = path.join(dir, `t${(n += 1)}`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'local-app-studio' }));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
};
const run = (argv, root) => {
  const out = { log: [], error: [] };
  const code = main(argv, { log: (m) => out.log.push(m), error: (m) => out.error.push(m), root });
  return { code, ...out };
};
const markers = (seams) => seams.map((s) => `"${markerOf(s)}"`).join(';');
// PRO_ONLY_STRINGS is read from pro/scripts/checks/proOnlyStrings.js: empty in a public build, so a test that needs an entry skips itself.
const FRAGMENT = PRO_ONLY_STRINGS[0];

describe('the lists', () => {
  it.skipIf(PUBLIC_BUILD)('PRO_ONLY_STRINGS is frozen, has 8 to 60 distinct long fragments and none is written out in proMarker.js', () => {
    expect(Object.isFrozen(PRO_ONLY_STRINGS)).toBe(true);
    expect(PRO_ONLY_STRINGS.length).toBeGreaterThanOrEqual(8);
    expect(PRO_ONLY_STRINGS.length).toBeLessThanOrEqual(60);
    expect(new Set(PRO_ONLY_STRINGS).size).toBe(PRO_ONLY_STRINGS.length);
    const self = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'checks', 'proMarker.js'), 'utf8');
    for (const f of PRO_ONLY_STRINGS) {
      expect(f.length).toBeGreaterThan(20);
      expect(self).not.toContain(f);
    }
  });

  it.skipIf(!PUBLIC_BUILD)('in a public build PRO_ONLY_STRINGS is an empty frozen array and the check still fails on a marker', () => {
    expect(Object.isFrozen(PRO_ONLY_STRINGS)).toBe(true);
    expect(PRO_ONLY_STRINGS).toHaveLength(0);
    expect(checkServerArtifact(`var x = "${markerOf('src/proParts.js')}";`, 'absent')).toHaveLength(1);
  });

  it.skipIf(!HAS_PRO || PUBLIC_BUILD)('the public proMarker.js source contains none of the entries of the list in pro/ (needs pro/ and a pro build)', async () => {
    const { PRO_ONLY_STRINGS: list } = await import(pathToFileURL(path.join(REPO_ROOT, 'pro', 'scripts', 'checks', 'proOnlyStrings.js')).href);
    expect(list.length).toBeGreaterThanOrEqual(8);
    const self = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'checks', 'proMarker.js'), 'utf8');
    for (const f of list) expect(self, f).not.toContain(f);
  });

  it('the expected seams per artifact kind', () => {
    expect(EXPECTED_SEAMS.web).toEqual(['src/proParts.js', 'src/components/settings/cloudUi.js']);
    expect(EXPECTED_SEAMS.runtime).toEqual(['server/license/index.js', 'server/pro.js', 'server/ai/providers/openaiCompat.js', 'src/proParts.js']);
    expect([...EXPECTED_SEAMS.studio].sort()).toEqual([...PRO_SEAMS.filter((s) => s.startsWith('server/')), 'src/proParts.js'].sort());
    for (const seams of Object.values(EXPECTED_SEAMS)) for (const s of seams) expect(PRO_SEAMS).toContain(s);
  });

  it.skipIf(!HAS_PRO || PUBLIC_BUILD)('every PRO_ONLY_STRINGS entry is in a pro file and in no tracked file outside pro/ (git grep)', () => {
    for (const f of PRO_ONLY_STRINGS) {
      const grep = (args) => spawnSync('git', ['grep', '-l', '-F', '-e', f, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(grep(['--', 'pro']).stdout.trim(), f).not.toBe('');
      expect(grep(['--', '.', ':!pro']).stdout.trim(), f).toBe('');
    }
  });
});

describe('checkServerArtifact', () => {
  it('absent: clean text passes; the marker prefix and each pro-only fragment are reported', () => {
    expect(checkServerArtifact('var x = 1;', 'absent')).toEqual([]);
    expect(checkServerArtifact(`var x = "${markerOf('src/proParts.js')}";`, 'absent')).toHaveLength(1);
  });

  it.skipIf(PUBLIC_BUILD)('absent: each pro-only fragment is reported (needs the list in pro/, which a public build does not have)', () => {
    expect(checkServerArtifact(`var x = "${FRAGMENT}";`, 'absent')).toHaveLength(1);
    expect(checkServerArtifact(`${markerOf('server/pro.js')} ${PRO_ONLY_STRINGS.join(' ')}`, 'absent')).toHaveLength(1 + PRO_ONLY_STRINGS.length);
  });

  it('present: each kind needs every one of its markers and names the missing ones', () => {
    for (const kind of ['studio', 'runtime']) {
      expect(checkServerArtifact(markers(EXPECTED_SEAMS[kind]), 'present', kind)).toEqual([]);
      const lacking = EXPECTED_SEAMS[kind].slice(1);
      const problems = checkServerArtifact(markers(lacking), 'present', kind);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(markerOf(EXPECTED_SEAMS[kind][0]));
    }
  });

  it('present: a runtime bundle is not a studio bundle, and an unknown kind needs the common markers only', () => {
    const runtimeOnly = markers(EXPECTED_SEAMS.runtime);
    expect(checkServerArtifact(runtimeOnly, 'present', 'studio').length).toBeGreaterThan(0);
    expect(checkServerArtifact(runtimeOnly, 'present', null)).toEqual([]);
    expect(checkServerArtifact('nothing', 'present', null)).toHaveLength(EXPECTED_SEAMS.runtime.length);
  });

  it('reads a Buffer as latin1', () => {
    const bytes = Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from(markers(EXPECTED_SEAMS.runtime)), Buffer.from([200])]);
    expect(checkServerArtifact(bytes, 'present', 'runtime')).toEqual([]);
    expect(checkServerArtifact(bytes, 'absent')).toHaveLength(1);
  });
});

describe('checkDistDir', () => {
  const dist = (files) => path.join(tree(files), 'dist');
  const both = { 'dist/assets/a.js': markers(['src/proParts.js']), 'dist/assets/b.js': markers(['src/components/settings/cloudUi.js']) };

  it('present needs both web markers, in any file', () => {
    expect(checkDistDir(dist(both), 'present')).toEqual([]);
    const problems = checkDistDir(dist({ 'dist/a.js': markers(['src/proParts.js']) }), 'present');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('cloudUi.js');
  });

  it('absent: a marker in a .js file is reported; other files are not read', () => {
    expect(checkDistDir(dist({ 'dist/a.js': 'x', 'dist/b.png': markers(['server/pro.js']) }), 'absent')).toEqual([]);
    expect(checkDistDir(dist({ 'dist/a.js': markers(['server/pro.js']), 'dist/c.js': 'ok' }), 'absent')).toHaveLength(1);
  });

  it.skipIf(PUBLIC_BUILD)('absent: no marker and no fragment in .js .css .html .json .map files (needs the list in pro/, which a public build does not have)', () => {
    expect(checkDistDir(dist({ 'dist/a.js': 'x', 'dist/b.png': markers(['server/pro.js']) }), 'absent')).toEqual([]);
    const bad = checkDistDir(dist({ 'dist/a.js': markers(['server/pro.js']), 'dist/sub/b.html': FRAGMENT, 'dist/c.js': 'ok' }), 'absent');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/a\.js/);
    expect(bad[0]).toMatch(/sub\/b\.html/);
  });

  it('absent: names at most five files and counts the rest', () => {
    const files = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`dist/f${i}.js`, PRO_MARKER_PREFIX]));
    expect(checkDistDir(dist(files), 'absent')[0]).toMatch(/and 2 more/);
  });

  it('a folder that is not there is one problem', () => {
    expect(checkDistDir(path.join(dir, 'nope'), 'present')).toHaveLength(1);
  });
});

describe('kindFromMeta', () => {
  it('reads appMode from the bundle-meta.json beside the file', () => {
    const root = tree({ 'a/bundle-meta.json': '{"appMode":"runtime"}', 'b/bundle-meta.json': '{"appMode":"x"}', 'c/server.cjs': '' });
    expect(kindFromMeta(path.join(root, 'a', 'server.cjs'))).toBe('runtime');
    expect(kindFromMeta(path.join(root, 'b', 'server.cjs'))).toBeNull();
    expect(kindFromMeta(path.join(root, 'c', 'server.cjs'))).toBeNull();
  });
});

describe('main', () => {
  it('needs exactly one mode and refuses unknown or valueless flags', () => {
    expect(run([]).error[0]).toMatch(/exactly one/);
    expect(run(['--require-absent', '--require-present']).error[0]).toMatch(/exactly one/);
    expect(run(['--nope']).error[0]).toMatch(/Unknown argument/);
    expect(run(['--require-absent', '--bundle']).error[0]).toMatch(/needs a value/);
    expect(run(['--require-absent', '--kind', 'x']).error[0]).toMatch(/studio or runtime/);
    expect(run(['--require-absent', '--source']).error[0]).toMatch(/--require-present/);
  });

  it('with no target and no build output it says what to do and fails', () => {
    const res = run(['--require-absent'], tree({}));
    expect(res.code).toBe(1);
    expect(res.error[0]).toMatch(/Nothing to check/);
  });

  it('checks the outputs that exist by default, and takes the kind from bundle-meta.json', () => {
    const root = tree({
      '.sidecar-build/server.cjs': markers(EXPECTED_SEAMS.runtime),
      '.sidecar-build/bundle-meta.json': '{"appMode":"runtime"}',
      'dist/index.html': markers(EXPECTED_SEAMS.web),
    });
    const ok = run(['--require-present'], root);
    expect(ok.code).toBe(0);
    expect(ok.log.join('\n')).toMatch(/server\.cjs \(runtime\)/);
    expect(run(['--require-absent'], root).code).toBe(1);
  });

  it('a studio bundle needs the studio markers, and --kind beats the meta file', () => {
    const root = tree({ 'b.cjs': markers(EXPECTED_SEAMS.runtime), '.sidecar-build/bundle-meta.json': '{"appMode":"runtime"}' });
    expect(run(['--require-present', '--bundle', path.join(root, 'b.cjs'), '--kind', 'studio']).code).toBe(1);
    expect(run(['--require-present', '--bundle', path.join(root, 'b.cjs'), '--kind', 'runtime']).code).toBe(0);
    expect(run(['--require-present', '--bundle', path.join(root, 'b.cjs')]).log.join('\n')).toMatch(/kind unknown/);
  });

  it('a requested target that does not exist fails', () => {
    const res = run(['--require-absent', '--bundle', path.join(dir, 'missing.cjs'), '--dist-dir', path.join(dir, 'missing')]);
    expect(res.code).toBe(1);
    expect(res.error).toHaveLength(2);
  });

  it('absent passes on a clean bundle and a clean dist', () => {
    const root = tree({ 'b.cjs': 'var a = 1;', 'dist/a.js': 'x' });
    const res = run(['--require-absent', '--bundle', path.join(root, 'b.cjs'), '--dist-dir', path.join(root, 'dist')]);
    expect(res.code).toBe(0);
    expect(res.log).toHaveLength(2);
  });
});

describe('--source', () => {
  const twin = (seam) => `export const PRO_MARKER = '${markerOf(seam)}';\n(globalThis.__LAS_PRO__ ??= []).push(PRO_MARKER);\n`;
  const good = () => {
    const files = { 'pro/server/.keep': '' };
    for (const seam of PRO_SEAMS) {
      files[seam] = 'export const A = 1;\n';
      files[`pro/${seam}`] = twin(seam);
    }
    return files;
  };
  const src = (files) => {
    const root = tree(files);
    return { root, res: run(['--require-present', '--source'], root) };
  };

  it('a complete tree passes and says no build output was scanned', () => {
    const { res } = src(good());
    expect(res.error).toEqual([]);
    expect(res.code).toBe(0);
    expect(res.log.join('\n')).toMatch(/No build output was scanned/);
  });

  it('it does not scan stale build outputs, only the targets it is given', () => {
    const { root } = src(good());
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'a.js'), 'x');
    const res = run(['--require-present', '--source'], root);
    expect(res.code).toBe(0);
    expect(res.log.join('\n')).toMatch(/No build output was scanned/);
  });

  it('a missing stub, a missing twin, a missing or unpushed marker and a stub with a marker each fail', () => {
    const [a, b, c, d, e] = PRO_SEAMS;
    const files = good();
    delete files[a];
    delete files[`pro/${b}`];
    files[`pro/${c}`] = `export const PRO_MARKER = 'other';\n`;
    files[`pro/${d}`] = `export const PRO_MARKER = '${markerOf(d)}';\n`;
    files[e] = `export const A = '${markerOf(e)}';\n`;
    const { res } = src(files);
    expect(res.code).toBe(1);
    const text = res.error.join('\n');
    expect(text).toContain(`${a}: the stub is missing`);
    expect(text).toContain(`pro/${b}: the twin is missing`);
    expect(text).toContain(`pro/${c}: the twin does not export`);
    expect(text).toContain(`pro/${d}: the twin does not push`);
    expect(text).toContain(`${e}: the stub carries a pro marker`);
  });

  it.skipIf(PUBLIC_BUILD)('pro-only text outside pro/ fails; the same text under pro/ is fine', () => {
    const files = { ...good(), 'src/leak.js': `const s = '${FRAGMENT}';\n`, 'pro/server/ok.js': `const s = '${FRAGMENT}';\n` };
    const { res } = src(files);
    expect(res.code).toBe(1);
    expect(res.error.join('\n')).toContain('src/leak.js');
    expect(res.error.join('\n')).not.toContain('pro/server/ok.js');
  });

  it('a file outside pro/ that imports a path under pro/ fails, unless it is a test', () => {
    const files = {
      ...good(),
      'server/leak.js': "import { x } from '../pro/server/thing.js';\n",
      'scripts/lazy.mjs': "const m = await import('../pro/scripts/a.js');\n",
      'server/__tests__/ok.test.js': "import { x } from '../../pro/server/thing.js';\n",
      'e2e/support/h.js': "import { y } from '../../pro/x.js';\n",
      'server/fine.js': "import { z } from './pro.js';\n",
      'pro/server/inner.js': "import { x } from './thing.js';\n",
    };
    const { res } = src(files);
    expect(res.code).toBe(1);
    const text = res.error.join('\n');
    expect(text).toContain('server/leak.js: imports "../pro/server/thing.js"');
    expect(text).toContain('scripts/lazy.mjs: imports "../pro/scripts/a.js"');
    expect(text).toContain('e2e/support/h.js');
    expect(text).not.toContain('ok.test.js');
    expect(text).not.toContain('server/fine.js');
    expect(text).not.toContain('pro/server/inner.js');
  });

  it('without a pro/ folder the twins are skipped with a note, the stubs are still checked', () => {
    const files = Object.fromEntries(PRO_SEAMS.map((s) => [s, 'export const A = 1;\n']));
    const root = tree(files);
    const res = run(['--require-present', '--source'], root);
    expect(res.code).toBe(0);
    expect(res.log.join('\n')).toMatch(/pro\/ is not present/);
    expect(checkSource(root).problems).toEqual([]);
  });

  it('can scan a build as well', () => {
    const { root } = src(good());
    fs.writeFileSync(path.join(root, 'b.cjs'), 'nothing');
    const res = run(['--require-present', '--source', '--bundle', path.join(root, 'b.cjs'), '--kind', 'runtime'], root);
    expect(res.code).toBe(1);
    expect(res.log.join('\n')).not.toMatch(/No build output/);
  });
});

describe('proSpecifiersIn', () => {
  it('lists only relative specifiers that resolve under pro/ in code files', () => {
    expect(proSpecifiersIn('server/a.js', "import x from '../pro/b.js'; import y from './pro.js'; import z from 'pro/c.js';")).toEqual(['../pro/b.js']);
    expect(proSpecifiersIn('src/a.ts', "export { q } from '../pro/src/q.ts';")).toEqual(['../pro/src/q.ts']);
    expect(proSpecifiersIn('docs/a.md', "import x from '../pro/b.js'")).toEqual([]);
    expect(proSpecifiersIn('server/a.js', "import x from '../../pro/b.js'")).toEqual([]);
  });

  it('tests may import from pro/, nothing else may', () => {
    expect(mayImportFromPro('server/__tests__/a.js')).toBe(true);
    expect(mayImportFromPro('src/studio/__tests__/a.test.tsx')).toBe(true);
    expect(mayImportFromPro('src/a.test.js')).toBe(true);
    expect(mayImportFromPro('e2e/flows/a.spec.js')).toBe(true);
    expect(mayImportFromPro('e2e/support/appServer.js')).toBe(false);
    expect(mayImportFromPro('scripts/lib/proRun.js')).toBe(false);
  });
});

describe.skipIf(!HAS_PRO || PUBLIC_BUILD)('every pro code file is recognizable in a bundle or a copy', () => {
  it('each non-test code file under pro/ carries a marker or holds at least one PRO_ONLY_STRINGS fragment', () => {
    const files = spawnSync('git', ['ls-files', 'pro'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .stdout.split('\n')
      .filter((f) => /\.(?:m?js|cjs|jsx|ts|tsx)$/.test(f) && !/(?:^|\/)__tests__\//.test(f));
    expect(files.length).toBeGreaterThan(30);
    const bare = files.filter((f) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
      return !text.includes(PRO_MARKER_PREFIX) && !PRO_ONLY_STRINGS.some((fragment) => text.includes(fragment));
    });
    expect(bare).toEqual([]);
  });
});

describe.skipIf(!HAS_PRO)('this repository', () => {
  it('passes its own source check', () => {
    expect(checkSource(REPO_ROOT).problems).toEqual([]);
  });
});
