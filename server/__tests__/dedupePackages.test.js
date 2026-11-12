// scripts/desktop/dedupePackages.js: one copy of a package npm installed twice at the same version, never a merge of versions.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEDUPED_PACKAGES, dedupePackagesPlugin, listedDependencyVersions, owningPackage } from '../../scripts/desktop/dedupePackages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir;

const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const leaf = (where, version, marker) => {
  write(`${where}/node_modules/leaf/package.json`, JSON.stringify({ name: 'leaf', version }));
  write(`${where}/node_modules/leaf/index.js`, `module.exports = { marker: '${marker}' };\n`);
  write(`${where}/node_modules/leaf/data.json`, JSON.stringify({ marker }));
  write(`${where}/index.js`, "module.exports = { main: require('leaf'), data: require('leaf/data.json') };\n");
};
const count = (text, needle) => text.split(needle).length - 1;
const bundle = async (entry, plugins) => {
  const outfile = path.join(dir, `out-${Math.random().toString(36).slice(2)}.cjs`);
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins });
  return { outfile, text: fs.readFileSync(outfile, 'utf8') };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-packages-'));
  leaf('a', '1.0.0', 'COPY_ONE_MARKER');
  leaf('b', '1.0.0', 'COPY_ONE_MARKER');
  leaf('c', '2.0.0', 'COPY_TWO_MARKER');
  write('entry.js', "module.exports = [require('./a'), require('./b'), require('./c')];\n");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe('dedupePackagesPlugin', () => {
  it('without the plugin every installed copy is bundled', async () => {
    const { text } = await bundle(path.join(dir, 'entry.js'), []);
    expect(count(text, 'COPY_ONE_MARKER')).toBe(4);
  });

  it('keeps one copy per version, the main file and a subpath file alike, and never merges versions', async () => {
    const { text, outfile } = await bundle(path.join(dir, 'entry.js'), [dedupePackagesPlugin({ packages: ['leaf'] })]);
    expect(count(text, 'COPY_ONE_MARKER')).toBe(2);
    expect(count(text, 'COPY_TWO_MARKER')).toBe(2);
    const [a, b, c] = createRequire(import.meta.url)(outfile);
    expect(a.main.marker).toBe('COPY_ONE_MARKER');
    expect(b.data.marker).toBe('COPY_ONE_MARKER');
    expect(a.main).toBe(b.main);
    expect(c.main.marker).toBe('COPY_TWO_MARKER');
  });

  it('leaves packages outside its list alone', async () => {
    const { text } = await bundle(path.join(dir, 'entry.js'), [dedupePackagesPlugin({ packages: ['other'] })]);
    expect(count(text, 'COPY_ONE_MARKER')).toBe(4);
  });

  it('names only leaf packages and the one that depends on them', () => {
    expect(DEDUPED_PACKAGES).toEqual(['mime-db', 'mime-types', 'content-type']);
  });

  it('bundles the real mime-db once for express and its siblings and the bundle still answers', async () => {
    const entry = path.join(dir, 'real.js');
    write('real.js', `module.exports = { typeis: require(${JSON.stringify(path.join(ROOT, 'node_modules/type-is'))}), send: require(${JSON.stringify(path.join(ROOT, 'node_modules/send'))}), express: require(${JSON.stringify(path.join(ROOT, 'node_modules/express'))}) };\n`);
    const plain = await bundle(entry, []);
    const folded = await bundle(entry, [dedupePackagesPlugin()]);
    // "application/vnd.ms-excel" is one key in db.json: one per bundled copy.
    expect(count(folded.text, '"application/vnd.ms-excel"')).toBe(1);
    expect(fs.statSync(folded.outfile).size).toBeLessThan(fs.statSync(plain.outfile).size);
    const { typeis } = createRequire(import.meta.url)(folded.outfile);
    expect(typeis.is('application/json', ['json'])).toBe('json');
    expect(typeis.is('text/html', ['json'])).toBe(false);
  });
});

describe('same-version copies that would resolve different dependencies', () => {
  // top@1.0.0 twice, each requiring sub; the second install resolves another sub version (the mime-types ^1.54.0 case).
  const pair = (root, subA, subB) => {
    for (const [where, subVersion] of [['a', subA], ['b', subB]]) {
      write(`${root}/${where}/node_modules/top/package.json`, JSON.stringify({ name: 'top', version: '1.0.0', dependencies: { sub: '^1.0.0' } }));
      write(`${root}/${where}/node_modules/top/index.js`, "module.exports = require('sub');\n");
      write(`${root}/${where}/node_modules/sub/package.json`, JSON.stringify({ name: 'sub', version: subVersion }));
      write(`${root}/${where}/node_modules/sub/index.js`, `module.exports = { sub: '${subVersion}' };\n`);
      write(`${root}/${where}/index.js`, "module.exports = require('top');\n");
    }
    write(`${root}/entry.js`, "module.exports = [require('./a'), require('./b')];\n");
  };

  it('fails the build with a clear message naming the packages and the versions', async () => {
    pair('diff', '1.54.0', '1.60.0');
    const run = bundle(path.join(dir, 'diff/entry.js'), [dedupePackagesPlugin({ packages: ['top', 'sub'] })]);
    await expect(run).rejects.toThrow(/two copies of top@1\.0\.0 .* would resolve different versions of sub \((1\.54\.0 and 1\.60\.0|1\.60\.0 and 1\.54\.0)\)/);
    await expect(run).rejects.toThrow(/Remove top from DEDUPED_PACKAGES/);
  });

  it('folds them when both resolve the same version of every listed dependency', async () => {
    pair('same', '1.54.0', '1.54.0');
    const { text } = await bundle(path.join(dir, 'same/entry.js'), [dedupePackagesPlugin({ packages: ['top', 'sub'] })]);
    expect(count(text, "1.54.0")).toBe(1);
  });

  it('reads the version a folder resolves, from the nearest node_modules, and only for listed packages', () => {
    pair('read', '1.54.0', '1.60.0');
    expect(listedDependencyVersions(path.join(dir, 'read/b/node_modules/top'), ['top', 'sub'])).toEqual({ sub: '1.60.0' });
    expect(listedDependencyVersions(path.join(dir, 'read/b/node_modules/top'), ['top'])).toEqual({});
  });
});

describe('owningPackage', () => {
  it('finds the nearest package.json that names the package, and null when none does', () => {
    expect(owningPackage(path.join(dir, 'a/node_modules/leaf/data.json'), 'leaf')).toEqual({ version: '1.0.0', dir: path.join(dir, 'a/node_modules/leaf') });
    expect(owningPackage(path.join(dir, 'a/node_modules/leaf/data.json'), 'nothing')).toBeNull();
  });
});
