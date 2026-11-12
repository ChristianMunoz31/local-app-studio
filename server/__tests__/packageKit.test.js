import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  KitError,
  collectNpmPackages,
  collectRustPackages,
  excludeRule,
  formatSha256File,
  isExcluded,
  packageKit,
  renderNotices,
  resolveTag,
  scanFileSet,
} from '../../scripts/package-kit.mjs';
import { BUNDLED_COMPONENTS, collectBundledComponents, findGitleaks, humanSize, readLicenseFiles } from '../../scripts/lib/kitPackage.js';

const enc = (s) => new TextEncoder().encode(s);
// Built from fragments so this file is not itself flagged by the private-key check.
const PEM_BLOCK = `-----BEGIN ${'PRIVATE'} KEY-----\nAAAA\n-----END ${'PRIVATE'} KEY-----\n`;

let tmpDirs = [];
const mkTmp = (prefix = 'kit-test-') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
const write = (root, rel, content) => {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeEach(() => {
  tmpDirs = [];
});
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('excludeRule', () => {
  const excluded = [
    '.env',
    '.env.local',
    '.env.production',
    'foo/.env',
    'a/b/.env.staging',
    'node_modules/x/index.js',
    'server/node_modules/y.js',
    '.git/HEAD',
    '.personal-denylist',
    'src-tauri/target/release/app.exe',
    'src-tauri/binaries/app-x86_64.exe',
    'src-tauri/gen/schemas/a.json',
    'src-tauri/resources/migrations/001.sql',
    'src-tauri/tauri.dev.build.json',
    '.sidecar-build/app.js',
    '.dev-build/out.txt',
    'dist/index.html',
    'dist-kit/kit.zip',
    'dist-ssr/server.js',
    'data/app.db',
    'logs/server.log',
    'server.log',
    'app.db',
    'app.db-wal',
    'app.db-shm',
    'backup.bak',
    'secrets.key',
    'keys/license.private.pem',
    'certs/server.pem',
    'certs/server.key',
    'certs/bundle.p12',
    'certs/bundle.pfx',
    'license-clock.json',
    'license-trial.json',
    'license-activation.json',
    '.claude/settings.local.json',
    'config.local',
    'coverage/lcov.info',
    'test-results/a.txt',
    'playwright-report/index.html',
    'blob-report/r.zip',
    '.vscode/settings.json',
    '.idea/workspace.xml',
    '.DS_Store',
    'src/.DS_Store',
    '.npmrc',
    'client/.npmrc',
    'data.sqlite',
    'db/app.sqlite3',
    'export.csv',
    'fixtures/rows.tsv',
    'report.xlsx',
    'CLAUDE.local.md',
    'docs/claude.local.md',
  ];
  const included = [
    '.env.example',
    'LICENSE',
    'CHANGELOG.md',
    'README.md',
    'package.json',
    'package-lock.json',
    'src/App.jsx',
    'src/data/sample.js',
    'src/pages/logs/LogView.jsx',
    'server/secrets/keyFile.js',
    'server/__tests__/secretsKeyFile.test.js',
    '.github/workflows/release.yml',
    '.github/CODEOWNERS',
    '.claude/commands/ship-feature.md',
    '.vscode/extensions.json',
    '.gitattributes',
    '.gitignore',
    '.gitleaks.toml',
    'scripts/package-kit.mjs',
    'evals/README.md',
    'e2e/app.spec.js',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
    'src-tauri/src/lib.rs',
    'src-tauri/icons/icon.ico',
    'src-tauri/tauri.conf.json',
    'src-tauri/tauri.dev.conf.json',
    'src-tauri/installer/hooks.nsh',
    'docs/LICENSING.md',
    'CLAUDE.md',
    'public/favicon.svg',
  ];

  it.each(excluded)('excludes %s', (p) => {
    expect(excludeRule(p), p).toEqual(expect.any(String));
    expect(isExcluded(p)).toBe(true);
  });

  it.each(included)('includes %s', (p) => {
    expect(excludeRule(p), p).toBeNull();
    expect(isExcluded(p)).toBe(false);
  });

  it('normalizes backslashes and a leading ./', () => {
    expect(isExcluded('.\\node_modules\\x')).toBe(true);
    expect(isExcluded('./src/App.jsx')).toBe(false);
  });
});

describe('resolveTag and formatting', () => {
  it('implies v<version> when no tag is given', () => {
    expect(resolveTag({ tagArg: undefined, version: '1.2.3' })).toEqual({ tag: 'v1.2.3', implied: true });
  });
  it('uses an explicit tag and marks it not implied', () => {
    expect(resolveTag({ tagArg: 'v2.0.0-rc.1', version: '1.2.3' })).toEqual({ tag: 'v2.0.0-rc.1', implied: false });
  });
  it('rejects tags that are not vX.Y.Z', () => {
    expect(() => resolveTag({ tagArg: '1.2.3', version: '1.0.0' })).toThrow(KitError);
    expect(() => resolveTag({ tagArg: 'v1.2.3/../x', version: '1.0.0' })).toThrow(/release tag/);
    expect(() => resolveTag({ tagArg: undefined, version: '' })).toThrow(KitError);
  });
  it('formats a sha256sum line', () => {
    const hex = 'a'.repeat(64);
    expect(formatSha256File(hex, 'kit.zip')).toBe(`${hex}  kit.zip\n`);
    expect(() => formatSha256File('nope', 'kit.zip')).toThrow(KitError);
  });
  it('formats sizes', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.00 KiB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.00 MiB');
  });
});

describe('third-party notices', () => {
  const lock = {
    packages: {
      '': { name: 'root-app', version: '1.0.0', license: 'UNLICENSED' },
      'node_modules/alpha': { version: '1.0.0', license: 'MIT' },
      'node_modules/beta-dev': { version: '2.0.0', license: 'ISC', dev: true },
      'node_modules/gamma-devopt': { version: '3.0.0', license: 'ISC', devOptional: true },
      'node_modules/alpha/node_modules/delta': { version: '4.0.0' },
      'node_modules/@scope/epsilon': { version: '5.0.0', license: 'Apache-2.0' },
    },
  };

  function fixtureProject() {
    const root = mkTmp('kit-notices-');
    write(root, 'node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '1.0.0', repository: { url: 'git+https://example.com/alpha.git' } }));
    write(root, 'node_modules/alpha/LICENSE', 'MIT License\r\n\r\nCopyright alpha authors\r\n');
    write(root, 'node_modules/alpha/node_modules/delta/package.json', JSON.stringify({ name: 'delta', version: '4.0.0', license: 'BSD-3-Clause', homepage: 'https://example.com/delta' }));
    write(root, 'node_modules/@scope/epsilon/package.json', JSON.stringify({ name: '@scope/epsilon', version: '5.0.0', repository: 'owner/epsilon' }));
    write(root, 'node_modules/@scope/epsilon/LICENCE.txt', 'Apache text');
    write(root, 'node_modules/@scope/epsilon/COPYING', 'Apache text');
    write(root, 'node_modules/beta-dev/package.json', JSON.stringify({ name: 'beta-dev', version: '2.0.0' }));
    write(root, 'node_modules/beta-dev/LICENSE', 'DEV ONLY LICENSE TEXT');
    return root;
  }

  it('lists production npm packages only, with license data from node_modules', () => {
    const root = fixtureProject();
    const npm = collectNpmPackages(lock, root);
    expect(npm.map((p) => `${p.name}@${p.version}`)).toEqual(['@scope/epsilon@5.0.0', 'alpha@1.0.0', 'delta@4.0.0']);
    const alpha = npm.find((p) => p.name === 'alpha');
    expect(alpha.license).toBe('MIT');
    expect(alpha.repository).toBe('https://example.com/alpha');
    expect(alpha.texts[0].text).toContain('Copyright alpha authors');
    expect(alpha.texts[0].text).not.toContain('\r');
    expect(npm.find((p) => p.name === 'delta')).toMatchObject({ license: 'BSD-3-Clause', repository: 'https://example.com/delta', texts: [] });
    expect(npm.find((p) => p.name === '@scope/epsilon').repository).toBe('https://github.com/owner/epsilon');
  });

  it('ignores an installed copy whose version differs from the lock', () => {
    const root = mkTmp('kit-notices-');
    write(root, 'node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '9.9.9' }));
    write(root, 'node_modules/alpha/LICENSE', 'WRONG VERSION TEXT');
    const [alpha] = collectNpmPackages({ packages: { 'node_modules/alpha': { version: '1.0.0', license: 'MIT' } } }, root);
    expect(alpha.texts).toEqual([]);
  });

  const rustFixture = (manifestDir) => ({
    packages: [
      { id: 'root 0.1.0', name: 'app-desktop', version: '0.1.0', source: null, license: null, manifest_path: path.join(manifestDir, 'root', 'Cargo.toml') },
      { id: 'serde 1.0.0', name: 'serde', version: '1.0.0', source: 'registry+x', license: 'MIT OR Apache-2.0', repository: 'https://example.com/serde', manifest_path: path.join(manifestDir, 'serde', 'Cargo.toml') },
      { id: 'winapi 0.3.0', name: 'winapi', version: '0.3.0', source: 'registry+x', license: null, license_file: 'LICENSE.md', manifest_path: path.join(manifestDir, 'winapi', 'Cargo.toml') },
      { id: 'devonly 1.0.0', name: 'devonly', version: '1.0.0', source: 'registry+x', license: 'MIT', manifest_path: path.join(manifestDir, 'devonly', 'Cargo.toml') },
    ],
    resolve: {
      root: 'root 0.1.0',
      nodes: [
        { id: 'root 0.1.0', deps: [{ pkg: 'serde 1.0.0', dep_kinds: [{ kind: null }] }, { pkg: 'winapi 0.3.0', dep_kinds: [{ kind: 'build' }] }, { pkg: 'devonly 1.0.0', dep_kinds: [{ kind: 'dev' }] }] },
        { id: 'serde 1.0.0', deps: [] },
        { id: 'winapi 0.3.0', deps: [] },
        { id: 'devonly 1.0.0', deps: [] },
      ],
    },
  });

  it('lists Rust crates, excluding the root crate and dev-only crates, unioned across targets', () => {
    const dir = mkTmp('kit-rust-');
    write(dir, 'serde/LICENSE-MIT', 'MIT serde text');
    const meta = rustFixture(dir);
    const second = { ...meta, packages: [...meta.packages, { id: 'extra 2.0.0', name: 'extra', version: '2.0.0', source: 'registry+x', license: 'Unlicense', manifest_path: path.join(dir, 'extra', 'Cargo.toml') }] };
    second.resolve = { ...meta.resolve, nodes: [{ ...meta.resolve.nodes[0], deps: [...meta.resolve.nodes[0].deps, { pkg: 'extra 2.0.0', dep_kinds: [{ kind: null }] }] }, ...meta.resolve.nodes.slice(1), { id: 'extra 2.0.0', deps: [] }] };
    const rust = collectRustPackages([meta, second]);
    expect(rust.map((r) => r.name)).toEqual(['extra', 'serde', 'winapi']);
    expect(rust.find((r) => r.name === 'serde')).toMatchObject({ license: 'MIT OR Apache-2.0', repository: 'https://example.com/serde' });
    expect(rust.find((r) => r.name === 'serde').texts[0].text).toBe('MIT serde text');
    expect(rust.find((r) => r.name === 'winapi').license).toBe('see LICENSE.md');
  });

  it('renders the notices document with dedupe, missing-text notes and no dev packages', () => {
    const root = fixtureProject();
    const rustDir = mkTmp('kit-rust-');
    write(rustDir, 'serde/LICENSE-APACHE', 'Apache text');
    const md = renderNotices({
      tag: 'v1.0.0',
      npm: collectNpmPackages(lock, root),
      rust: collectRustPackages([rustFixture(rustDir)]),
    });
    expect(md).toContain('## npm packages (3)');
    expect(md).toContain('also include the Node.js runtime');
    expect(md).toContain('https://github.com/nodejs/node/blob/v<version>/LICENSE');
    expect(md).not.toContain('nodejs/node/blob/main/LICENSE');
    expect(md).toContain('### alpha@1.0.0');
    expect(md).toContain('Copyright alpha authors');
    expect(md).not.toContain('beta-dev');
    expect(md).not.toContain('gamma-devopt');
    expect(md).not.toContain('DEV ONLY LICENSE TEXT');
    expect(md).toContain('## Rust crates (2)');
    expect(md).toContain('### serde@1.0.0');
    expect(md).not.toContain('app-desktop');
    expect(md).not.toContain('devonly');
    expect(md).toMatch(/delta@4\.0\.0[\s\S]*not included in the package/);
    // "Apache text" appears in epsilon (twice) and serde, but only once in the appendix.
    expect(md.match(/^Apache text$/gm)).toHaveLength(1);
    expect(md).not.toContain(String.fromCharCode(0x2014));
  });

  it('lists pdf.js (Apache-2.0, bundled inside unpdf) when unpdf is a production dependency, with its vendored text', () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
    const withUnpdf = { packages: { 'node_modules/unpdf': { version: '1.8.1', license: 'MIT' } } };
    const bundled = collectBundledComponents(withUnpdf, root);
    expect(bundled.map((b) => [b.name, b.version, b.license])).toEqual([['pdf.js (pdfjs-dist, bundled inside unpdf)', '6.1.200', 'Apache-2.0']]);
    expect(bundled[0].texts[0].text).toContain('Apache License');
    expect(collectBundledComponents({ packages: { 'node_modules/unpdf': { version: '1.8.1', dev: true } } }, root)).toEqual([]);
    expect(collectBundledComponents({ packages: {} }, root)).toEqual([]);
    expect(BUNDLED_COMPONENTS.every((c) => Object.isFrozen(c))).toBe(true);
    const md = renderNotices({ tag: 'v1.0.0', npm: collectNpmPackages(withUnpdf, root), rust: [], bundled });
    expect(md).toContain('## Components bundled inside npm packages (1)');
    expect(md).toContain('### pdf.js (pdfjs-dist, bundled inside unpdf)@6.1.200');
    expect(md).toContain('### unpdf@1.8.1');
    expect(md).toContain('Apache License');
  });

  it('refuses a lock file whose unpdf version is not the one the bundled pdf.js notice was checked against (L9)', () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
    const pdfjs = BUNDLED_COMPONENTS.find((c) => c.requiredBy === 'unpdf');
    expect(pdfjs.requiredByVersion).toBe('1.8.1');
    const locked = (version) => ({ packages: { 'node_modules/unpdf': { version, license: 'MIT' } } });
    expect(collectBundledComponents(locked(pdfjs.requiredByVersion), root)).toHaveLength(1);
    expect(() => collectBundledComponents(locked('1.9.0'), root)).toThrow(/unpdf is locked at 1\.9\.0.*requiredByVersion/s);
    // A dev-only copy does not ship, so it is not checked.
    expect(collectBundledComponents({ packages: { 'node_modules/unpdf': { version: '9.9.9', dev: true } } }, root)).toEqual([]);
  });

  it('the real lock file matches the unpdf version the bundled pdf.js notice names (L9)', () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    expect(() => collectBundledComponents(lock, root)).not.toThrow();
    expect(collectBundledComponents(lock, root).map((b) => b.version)).toEqual(['6.1.200', JSON.parse(fs.readFileSync(path.join(root, 'packages', 'runtime', 'package.json'), 'utf8')).version]);
  });

  it('lists the runtime package (MIT, a workspace link in the lock) with its version and a license text equal to packages/runtime/LICENSE', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'runtime', 'package.json'), 'utf8'));
    const withLink = { packages: { 'node_modules/@local-app-studio/runtime': { resolved: 'packages/runtime', link: true } } };
    const bundled = collectBundledComponents(withLink, root);
    expect(bundled).toHaveLength(1);
    expect([bundled[0].version, bundled[0].license]).toEqual([pkg.version, 'MIT']);
    expect(bundled[0].name).toContain('@local-app-studio/runtime');
    expect(collectNpmPackages(withLink, root)).toEqual([]);
    expect(bundled[0].texts).toHaveLength(1);
    expect(bundled[0].texts[0].text).toBe(fs.readFileSync(path.join(root, 'packages', 'runtime', 'LICENSE'), 'utf8').replaceAll('\r\n', '\n').trim());
    expect(pkg.license).toBe('MIT');
  });

  it('reads license files by the usual names only', () => {
    const dir = mkTmp('kit-lic-');
    write(dir, 'LICENSE-MIT', 'a');
    write(dir, 'license.md', 'b');
    write(dir, 'COPYING', 'c');
    write(dir, 'README.md', 'd');
    write(dir, 'licensing-notes.txt', 'e');
    expect(readLicenseFiles(dir).map((f) => f.file)).toEqual(['COPYING', 'LICENSE-MIT', 'license.md']);
    expect(readLicenseFiles(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('scanFileSet', () => {
  const clean = () =>
    new Map([
      ['src/App.jsx', enc('export const a = 1;\n')],
      ['logo.png', new Uint8Array([0, 1, 2, 3])],
    ]);

  it('passes a clean set', () => {
    expect(scanFileSet(clean(), { denylist: ['zzforbiddenterm'] })).toEqual([]);
  });

  it('flags a denylist term in content (case-insensitive) without echoing it', () => {
    const files = clean();
    files.set('docs/notes.md', enc('hello ZZForbiddenTerm here'));
    const hits = scanFileSet(files, { denylist: ['zzforbiddenterm'] });
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe('docs/notes.md');
    expect(hits[0].rule).toMatch(/forbidden term #1/);
    expect(JSON.stringify(hits).toLowerCase()).not.toContain('zzforbiddenterm');
  });

  it('flags a denylist term in a file path', () => {
    const files = clean();
    files.set('docs/zzforbiddenterm.md', enc('ok'));
    const hits = scanFileSet(files, { denylist: ['zzforbiddenterm'] });
    expect(hits.some((h) => h.file === 'docs/zzforbiddenterm.md' && /file path/.test(h.rule))).toBe(true);
  });

  it('flags a private key block', () => {
    const files = clean();
    files.set('deploy/notes.txt', enc(`before\n${PEM_BLOCK}`));
    const hits = scanFileSet(files, {});
    expect(hits).toEqual([{ file: 'deploy/notes.txt', rule: expect.stringMatching(/^private key \(pem-private-key, line 2\)/) }]);
  });

  it('scans SVG files for denylist terms', () => {
    const files = clean();
    files.set('public/logo.svg', enc('<svg><title>ZZForbiddenTerm</title></svg>'));
    const hits = scanFileSet(files, { denylist: ['zzforbiddenterm'] });
    expect(hits).toEqual([{ file: 'public/logo.svg', rule: expect.stringMatching(/^forbidden term #1/) }]);
  });

  it('skips binary files', () => {
    const files = clean();
    files.set('blob.bin', new Uint8Array([0, ...enc('zzforbiddenterm')]));
    expect(scanFileSet(files, { denylist: ['zzforbiddenterm'] })).toEqual([]);
  });
});

describe('findGitleaks', () => {
  it('honors GITLEAKS_BIN only when it exists', () => {
    const dir = mkTmp('kit-gl-');
    const bin = path.join(dir, 'gitleaks-fake');
    fs.writeFileSync(bin, '');
    expect(findGitleaks({ GITLEAKS_BIN: bin, PATH: '' })).toBe(bin);
    expect(findGitleaks({ GITLEAKS_BIN: path.join(dir, 'nope'), PATH: '' })).toBeNull();
  });
  it('returns null when nothing is on PATH', () => {
    expect(findGitleaks({ PATH: '' })).toBeNull();
  });
  it.skipIf(process.platform !== 'win32')('ignores .cmd shims, which Node cannot spawn without a shell', () => {
    const dir = mkTmp('kit-gl-');
    fs.writeFileSync(path.join(dir, 'gitleaks.cmd'), '');
    expect(findGitleaks({ PATH: dir })).toBeNull();
    const exe = path.join(dir, 'gitleaks.exe');
    fs.writeFileSync(exe, '');
    expect(findGitleaks({ PATH: dir })).toBe(exe);
  });
});

describe('packageKit (temp git repo)', () => {
  const GIT_ID = ['-c', 'user.name=Kit Test', '-c', 'user.email=kit@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
  const git = (cwd, ...args) => {
    const res = spawnSync('git', [...GIT_ID, ...args], { cwd, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
    return res.stdout;
  };
  const quiet = { log: () => {}, warn: () => {} };
  const NOTHING_ON_PATH = { PATH: '' };
  // The default test run waives the two required scans; the tests for those scans opt back in.
  const waived = { allowMissingGitleaks: true, allowEmptyDenylist: true };

  // Building a fixture repo costs about eight git processes. Each distinct set of extra files is built once
  // and every test works on its own copy, so a test that changes its repo never touches another test's.
  const templates = new Map();
  const templateDirs = [];
  afterAll(() => {
    for (const d of templateDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeRepo({ extra = {} } = {}) {
    const key = JSON.stringify(extra);
    if (!templates.has(key)) templates.set(key, buildRepo(extra));
    const root = mkTmp('kit-repo-');
    fs.cpSync(templates.get(key), root, { recursive: true });
    return root;
  }

  function buildRepo(extra) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-template-'));
    templateDirs.push(root);
    git(root, 'init', '-q');
    write(root, 'package.json', JSON.stringify({ name: 'fixture', version: '0.0.1' }));
    write(
      root,
      'package-lock.json',
      JSON.stringify({
        packages: {
          '': { name: 'fixture', version: '0.0.1' },
          'node_modules/prodpkg': { version: '1.0.0', license: 'MIT' },
          'node_modules/devpkg': { version: '1.0.0', license: 'MIT', dev: true },
        },
      }),
    );
    write(root, 'LICENSE', 'Commercial license text\n');
    write(root, 'CHANGELOG.md', '# Changelog\n');
    write(root, '.env.example', 'API_URL=http://localhost\n');
    write(root, '.env.production', 'SHOULD_NOT_SHIP=1\n');
    write(root, 'internal-notes.md', 'seller only\n');
    write(root, '.gitattributes', 'internal-notes.md export-ignore\n');
    write(root, 'src/app.js', 'export const x = 1;\n');
    write(root, '.claude/commands/ship.md', 'ship it\n');
    write(root, '.github/workflows/ci.yml', 'name: ci\n');
    write(root, 'node_modules/prodpkg/package.json', JSON.stringify({ name: 'prodpkg', version: '1.0.0' }));
    write(root, 'node_modules/prodpkg/LICENSE', 'Prodpkg license body\n');
    for (const [rel, content] of Object.entries(extra)) write(root, rel, content);
    git(root, 'add', '-f', '.');
    git(root, 'reset', '-q', 'node_modules');
    git(root, 'commit', '-q', '-m', 'init');
    git(root, 'tag', 'v0.0.1');
    return root;
  }

  const base = (root, extra = {}) => ({ repoRoot: root, env: NOTHING_ON_PATH, rustMetadata: () => [], ...waived, ...quiet, ...extra });

  /** A fake gitleaks run as `node script`: exits with the given code and echoes its argv to stdout. */
  function fakeGitleaks(exitCode) {
    const dir = mkTmp('kit-fakegl-');
    const script = path.join(dir, 'fake-gitleaks.js');
    fs.writeFileSync(script, `console.log('fake gitleaks ' + process.argv.slice(2).join(' '));\nprocess.exit(${exitCode});\n`);
    return [process.execPath, script];
  }
  const withTerms = (root) => write(root, '.personal-denylist', 'zzunrelatedterm\n');
  const required = { allowEmptyDenylist: false, allowMissingGitleaks: false };

  it('builds a ZIP with the expected layout, exclusions and checksum file', () => {
    const root = makeRepo();
    const warnings = [];
    const result = packageKit(base(root, { warn: (m) => warnings.push(m) }));

    expect(result.tag).toBe('v0.0.1');
    expect(path.basename(result.zipPath)).toBe('tauri-local-ai-starter-v0.0.1.zip');
    expect(path.dirname(result.zipPath)).toBe(path.join(root, 'dist-kit'));
    expect(warnings.some((w) => /gitleaks/.test(w) && /SKIPPED/.test(w))).toBe(true);

    const zipBytes = fs.readFileSync(result.zipPath);
    const entries = unzipSync(new Uint8Array(zipBytes));
    const names = Object.keys(entries);
    const prefix = 'tauri-local-ai-starter-v0.0.1/';
    expect(names.every((n) => n.startsWith(prefix))).toBe(true);
    const rel = names.map((n) => n.slice(prefix.length));
    expect([...rel]).toEqual([...rel].sort());
    expect(rel).toEqual(
      expect.arrayContaining(['LICENSE', 'CHANGELOG.md', '.env.example', 'src/app.js', '.claude/commands/ship.md', '.github/workflows/ci.yml', 'THIRD_PARTY_NOTICES.md', 'package.json']),
    );
    expect(rel).not.toContain('internal-notes.md');
    expect(rel).not.toContain('.env.production');
    expect(rel.some((n) => n.startsWith('node_modules/'))).toBe(false);
    expect(result.fileCount).toBe(rel.length);
    expect(result.excludedByPredicate.map((d) => d.name)).toEqual(['.env.production']);

    const notices = Buffer.from(entries[`${prefix}THIRD_PARTY_NOTICES.md`]).toString('utf8');
    expect(notices).toContain('prodpkg@1.0.0');
    expect(notices).toContain('Prodpkg license body');
    expect(notices).not.toContain('devpkg');

    const sha = fs.readFileSync(`${result.zipPath}.sha256`, 'utf8');
    expect(sha).toBe(`${result.sha256}  tauri-local-ai-starter-v0.0.1.zip\n`);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.size).toBe(zipBytes.length);
  });

  it('is deterministic for the same tag', () => {
    const root = makeRepo();
    const a = packageKit(base(root, { out: 'out-a' }));
    const b = packageKit(base(root, { out: 'out-b' }));
    expect(a.sha256).toBe(b.sha256);
  });

  it('adds the Rust crates from the metadata provider', () => {
    const root = makeRepo({
      extra: { 'src-tauri/Cargo.toml': '[package]\nname = "x"\n', 'src-tauri/src/main.rs': 'fn main() {}\n' },
    });
    git(root, 'tag', 'v0.0.2');
    const meta = { packages: [{ id: 'a', name: 'crate-a', version: '1.2.3', source: 'registry+x', license: 'MIT' }] };
    const result = packageKit(base(root, { tag: 'v0.0.2', rustMetadata: () => [meta] }));
    expect(result.rustCount).toBe(1);
    const entries = unzipSync(new Uint8Array(fs.readFileSync(result.zipPath)));
    const notices = Buffer.from(entries['tauri-local-ai-starter-v0.0.2/THIRD_PARTY_NOTICES.md']).toString('utf8');
    expect(notices).toContain('### crate-a@1.2.3');
  });

  it('fails when Rust metadata fails, unless allowed', () => {
    const root = makeRepo({ extra: { 'src-tauri/Cargo.toml': '[package]\nname = "x"\n' } });
    git(root, 'tag', 'v0.0.2');
    const broken = () => {
      throw new KitError('cargo is not available (spawn cargo ENOENT).');
    };
    expect(() => packageKit(base(root, { tag: 'v0.0.2', rustMetadata: broken }))).toThrow(/Rust notices are required/);
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
    const warnings = [];
    const result = packageKit(base(root, { tag: 'v0.0.2', rustMetadata: broken, allowMissingRustNotices: true, warn: (m) => warnings.push(m) }));
    expect(warnings.some((w) => /Rust notices skipped/.test(w))).toBe(true);
    expect(result.rustCount).toBe(0);
  });

  it('fails clearly when the tag does not exist', () => {
    const root = makeRepo();
    expect(() => packageKit(base(root, { tag: 'v9.9.9' }))).toThrow(/Tag v9\.9\.9 does not exist.*git tag -a v9\.9\.9/);
  });

  it('refuses a dirty tree when the tag is implied, but not with an explicit tag', () => {
    const root = makeRepo();
    write(root, 'src/app.js', 'export const x = 2;\n');
    expect(() => packageKit(base(root))).toThrow(/uncommitted changes/);
    expect(packageKit(base(root, { tag: 'v0.0.1' })).fileCount).toBeGreaterThan(0);
  });

  it('fails outside a git repository', () => {
    const dir = mkTmp('kit-nogit-');
    write(dir, 'package.json', JSON.stringify({ version: '0.0.1' }));
    expect(() => packageKit(base(dir))).toThrow(/git repository/);
  });

  it('fails when LICENSE or CHANGELOG.md is missing from the tag', () => {
    for (const missing of ['LICENSE', 'CHANGELOG.md']) {
      const root = makeRepo();
      git(root, 'rm', '-q', missing);
      git(root, 'commit', '-q', '-m', 'drop');
      git(root, 'tag', 'v0.0.3');
      expect(() => packageKit(base(root, { tag: 'v0.0.3' }))).toThrow(new RegExp(`${missing.replace('.', '\\.')} is missing`));
    }
  });

  it('aborts without writing a ZIP when the denylist matches', () => {
    const root = makeRepo({ extra: { 'docs/guide.md': 'Written by ZZForbiddenTerm Inc.\n' } });
    git(root, 'tag', 'v0.0.2');
    write(root, '.personal-denylist', '# private terms\nzzforbiddenterm\n');
    let error;
    try {
      packageKit(base(root, { tag: 'v0.0.2' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(KitError);
    expect(error.message).toMatch(/docs\/guide\.md: forbidden term #1/);
    expect(error.message.toLowerCase()).not.toContain('zzforbiddenterm');
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
  });

  it('aborts without writing a ZIP when a private key block is present', () => {
    const root = makeRepo({ extra: { 'docs/key.txt': PEM_BLOCK } });
    git(root, 'tag', 'v0.0.2');
    expect(() => packageKit(base(root, { tag: 'v0.0.2' }))).toThrow(/docs\/key\.txt: private key/);
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
  });

  it('aborts with no ZIP when gitleaks reports findings, and passes when it exits 0', () => {
    const root = makeRepo();
    withTerms(root);
    const logs = [];
    expect(() => packageKit(base(root, { ...required, gitleaksCommand: fakeGitleaks(1) }))).toThrow(/gitleaks reported findings \(exit 1\)/);
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
    const result = packageKit(base(root, { ...required, gitleaksCommand: fakeGitleaks(0), log: (m) => logs.push(m) }));
    expect(logs).toContain('gitleaks: no leaks found');
    expect(fs.existsSync(result.zipPath)).toBe(true);
  });

  it('aborts when gitleaks is missing, unless --allow-missing-gitleaks (then warns loudly)', () => {
    const root = makeRepo();
    withTerms(root);
    expect(() => packageKit(base(root, required))).toThrow(/gitleaks was not found.*--allow-missing-gitleaks/);
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
    const warnings = [];
    const result = packageKit(base(root, { ...required, allowMissingGitleaks: true, warn: (m) => warnings.push(m) }));
    expect(warnings.some((w) => /^WARNING: gitleaks not found.*SKIPPED/.test(w))).toBe(true);
    expect(fs.existsSync(result.zipPath)).toBe(true);
  });

  it('aborts when GITLEAKS_BIN points at a missing file, even with --allow-missing-gitleaks', () => {
    const root = makeRepo();
    withTerms(root);
    const env = { PATH: '', GITLEAKS_BIN: path.join(root, 'no-such-gitleaks.exe') };
    for (const allowMissingGitleaks of [false, true]) {
      expect(() => packageKit(base(root, { env, ...required, allowMissingGitleaks }))).toThrow(/GITLEAKS_BIN is set but that file does not exist/);
    }
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
  });

  it('aborts on an empty denylist unless --allow-empty-denylist (then warns loudly)', () => {
    const root = makeRepo();
    expect(() => packageKit(base(root, { allowEmptyDenylist: false }))).toThrow(/forbidden-term list is empty.*--allow-empty-denylist/);
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
    const warnings = [];
    packageKit(base(root, { warn: (m) => warnings.push(m) }));
    expect(warnings.some((w) => /^WARNING: the forbidden-term list is EMPTY/.test(w))).toBe(true);
  });

  it('accepts terms from PERSONAL_DENYLIST instead of the file', () => {
    const root = makeRepo();
    const env = { PATH: '', PERSONAL_DENYLIST: 'zzunrelatedterm' };
    expect(packageKit(base(root, { env, allowEmptyDenylist: false })).fileCount).toBeGreaterThan(0);
  });

  it('aborts when a denylist term sits inside an SVG', () => {
    const root = makeRepo({ extra: { 'public/logo.svg': '<svg><text>ZZForbiddenTerm</text></svg>\n' } });
    git(root, 'tag', 'v0.0.2');
    write(root, '.personal-denylist', 'zzforbiddenterm\n');
    expect(() => packageKit(base(root, { tag: 'v0.0.2' }))).toThrow(/public\/logo\.svg: forbidden term #1/);
    expect(fs.existsSync(path.join(root, 'dist-kit'))).toBe(false);
  });

  it('drops the new exclusions by predicate, keeps SVGs, and words the notices neutrally', () => {
    const root = makeRepo({
      extra: { '.npmrc': 'token=x\n', 'data.sqlite': 'x', 'export.csv': 'a,b\n', 'CLAUDE.local.md': 'notes\n', 'public/logo.svg': '<svg/>\n' },
    });
    git(root, 'tag', 'v0.0.2');
    const result = packageKit(base(root, { tag: 'v0.0.2' }));
    const entries = unzipSync(new Uint8Array(fs.readFileSync(result.zipPath)));
    const names = Object.keys(entries).map((n) => n.slice(n.indexOf('/') + 1));
    for (const gone of ['.npmrc', 'data.sqlite', 'export.csv', 'CLAUDE.local.md']) expect(names).not.toContain(gone);
    expect(names).toContain('public/logo.svg');
    expect(result.excludedByPredicate.map((d) => d.name).sort()).toEqual(['.env.production', '.npmrc', 'CLAUDE.local.md', 'data.sqlite', 'export.csv']);
    const notices = Buffer.from(entries['tauri-local-ai-starter-v0.0.2/THIRD_PARTY_NOTICES.md']).toString('utf8');
    expect(notices).toContain('depends on the third-party packages listed below');
    expect(notices).not.toMatch(/open[- ]source|bundles/i);
  });
});
