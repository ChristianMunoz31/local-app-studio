// scripts/init-app.mjs: name derivation, validation and the rename itself, on a throwaway fixture tree.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRules,
  article,
  buildRules,
  checkIconFile,
  defaultIdentifier,
  deriveNames,
  glyphPath,
  isExcludedPath,
  isReplaceableIcon,
  letterFaviconSvg,
  letterIconSvg,
  storeConfigRel,
  pngIconSvg,
  readCurrent,
  readPngSize,
  rerunRisk,
  run,
  sortCargoLockRoot,
  validateCrate,
  validateExecutable,
  validateIdentifier,
  validateName,
  validateRepo,
  validateSupport,
} from '../../scripts/init-app.mjs';

describe('deriveNames', () => {
  it('derives every name from the display name', () => {
    expect(deriveNames('Acme Notes')).toEqual({
      display: 'Acme Notes',
      devDisplay: 'Acme Notes Dev',
      upper: 'ACME NOTES',
      kebab: 'acme-notes',
      compact: 'acmenotes',
      exe: 'AcmeNotes',
      installerPrefix: 'Acme-Notes',
      crate: 'acme-notes-desktop',
      sidecar: 'acme-notes-server',
      devSidecar: 'acme-notes-dev-server',
      dataDirWin: 'Acme Notes',
      dataDirDevWin: 'Acme Notes Dev',
      dataDirLinux: 'acme-notes',
      dataDirDevLinux: 'acme-notes-dev',
    });
  });

  it('normalizes spacing and handles one-word and mixed-case names', () => {
    expect(deriveNames('  Acme   Notes ').display).toBe('Acme Notes');
    expect(deriveNames('Zeta').kebab).toBe('zeta');
    expect(deriveNames('iPhone Notes')).toMatchObject({ kebab: 'iphone-notes', exe: 'IPhoneNotes', installerPrefix: 'iPhone-Notes' });
  });

  it('throws for an invalid name', () => {
    expect(() => deriveNames('1abc')).toThrow(/start with a letter/);
  });
});

describe('validation', () => {
  it('validates the app name', () => {
    for (const ok of ['Acme Notes', 'Zeta', 'App 2', 'AB']) expect(validateName(ok)).toBeNull();
    for (const bad of ['', '   ', 'A', '1App', 'Acme-Notes', 'Acme & Co', 'Café Notes', 'x'.repeat(41)]) expect(validateName(bad)).not.toBeNull();
  });

  it('validates the identifier', () => {
    for (const ok of ['com.acme.notes', 'io.github.acme-notes', 'com.a1.b2', 'dev.acme']) expect(validateIdentifier(ok)).toBeNull();
    const bad = ['', 'acme', 'com..notes', '.com.notes', 'com.notes.', 'com.1acme.notes', 'com.Acme.notes', 'com.acme.no_tes', 'com.acme.notes-',
      'com.acme.notes.dev', 'com.acme.notes.app', 'com.acme.no tes', `com.${'a'.repeat(120)}.x`];
    for (const id of bad) expect(validateIdentifier(id), id).not.toBeNull();
  });

  it('validates repositories like GitHub does', () => {
    for (const ok of ['acme/notes', 'Acme-Org/notes.v2', 'a/b', 'acme/my_repo-1']) expect(validateRepo(ok)).toBeNull();
    const bad = ['', 'acme', 'acme/', '/notes', 'acme/notes/x', '-acme/notes', 'acme-/notes', 'ac--me/notes', 'ac me/notes', 'acme/no tes', 'acme/..',
      'acme/notes.git', `${'a'.repeat(40)}/notes`, 'ac_me/notes'];
    for (const repo of bad) expect(validateRepo(repo), repo).not.toBeNull();
  });

  it('validates executable and crate names', () => {
    expect(validateExecutable('AcmeNotes')).toBeNull();
    expect(validateExecutable('Acme Notes')).not.toBeNull();
    expect(validateExecutable('1Acme')).not.toBeNull();
    expect(validateExecutable('')).not.toBeNull();
    expect(validateCrate('acme-notes-desktop')).toBeNull();
    expect(validateCrate('acme_notes')).toBeNull();
    expect(validateCrate('1acme')).not.toBeNull();
    expect(validateCrate('acme notes')).not.toBeNull();
    expect(validateCrate('a'.repeat(65))).not.toBeNull();
  });

  it('accepts an email or an http(s) URL as the support contact', () => {
    for (const ok of ['help@example.com', 'support+x@mail.example.co.uk', 'https://acme.dev/support', 'http://acme.dev']) expect(validateSupport(ok)).toBeNull();
    for (const bad of ['', 'help', 'help@acme', 'ftp://acme.dev', 'javascript:alert(1)', 'https://localhost', ' help@example.com', '[OWNER TODO: your support email or URL]']) {
      expect(validateSupport(bad), bad).not.toBeNull();
    }
  });

  it('builds a valid default identifier', () => {
    expect(defaultIdentifier('acme/notes', 'acmenotes')).toBe('com.acme.acmenotes');
    expect(defaultIdentifier('My-Org/x', 'zeta')).toBe('com.myorg.zeta');
    expect(validateIdentifier(defaultIdentifier('9lives/x', 'zeta'))).toBeNull();
  });
});

describe('replacement rules', () => {
  const cur = {
    display: 'Starter App', devDisplay: 'Starter App Dev', identifier: 'com.example.starterapp', kebab: 'starter-app', exe: 'StarterApp',
    crate: 'starter-app-desktop', installerPrefix: 'Starter-App', sourceRepo: 'your-github-user/your-app',
    releasesRepo: 'your-github-user/your-app-releases', support: 'x',
  };
  const next = { ...deriveNames('Acme Notes'), identifier: 'com.acme.notes', sourceRepo: 'acme/notes', releasesRepo: 'acme/notes-releases' };

  it('applies the most specific rule first and never rewrites its own output', () => {
    const rules = buildRules(cur, next);
    const text = [
      'https://github.com/your-github-user/your-app-releases/releases/latest/download/Starter-App-Setup-x64.exe',
      'repo your-github-user/your-app; @your-github-user; YOUR-GITHUB-USER',
      'com.example.starterapp.dev COM.EXAMPLE.STARTERAPP.DEV StarterApp.exe STARTER APP starter app',
      'starter-app-desktop starter-app-dev-server Starter App Dev',
    ].join('\n');
    const out = applyRules(text, rules).text;
    expect(out).toBe(
      [
        'https://github.com/acme/notes-releases/releases/latest/download/Acme-Notes-Setup-x64.exe',
        'repo acme/notes; @acme; ACME',
        'com.acme.notes.dev COM.ACME.NOTES.DEV AcmeNotes.exe ACME NOTES acme notes',
        'acme-notes-desktop acme-notes-dev-server Acme Notes Dev',
      ].join('\n'),
    );
  });

  it('replaces a bare owner only while it is the kit placeholder', () => {
    const rerun = { ...cur, display: 'Acme Notes', kebab: 'acme-notes', sourceRepo: 'app/notes', releasesRepo: 'app/notes-releases' };
    const to = { ...deriveNames('Zeta Cloud'), identifier: 'com.zeta.cloud', sourceRepo: 'zeta/cloud', releasesRepo: 'zeta/cloud-releases' };
    const rules = buildRules(rerun, to);
    expect(rules.some((r) => r.from === 'app')).toBe(false);
    const text = "const app = express(); import x from 'react'; // app/notes app/notes-releases * @app @app/pkg me@app.dev";
    expect(applyRules(text, rules).text).toBe("const app = express(); import x from 'react'; // zeta/cloud zeta/cloud-releases * @zeta @app/pkg me@app.dev");
  });

  it('leaves the placeholder detector intact after the rename, so a renamed app is not "not set up"', () => {
    const rules = buildRules(cur, next);
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const placeholder = readSrc('scripts/release/placeholder.js');
    const renamed = applyRules(placeholder, rules);
    expect(renamed.text).toBe(placeholder);
    expect(renamed.count).toBe(0);
    expect(applyRules(readSrc('scripts/release/releaseConfig.js'), rules).text).not.toContain('acme');
    // The stable build script is pro (a public build has only its stub, which holds no names).
    if (!PUBLIC_BUILD) expect(applyRules(readSrc('pro/scripts/desktop/build.js'), rules).text).not.toMatch(/productName\s*===\s*'Acme Notes'/);
    // Evaluate the renamed module text: the detector must still key on the kit owner, not the buyer's.
    const mod = new Function(`${renamed.text.replace(/^export /gm, '')}
return { PLACEHOLDER_REPO_OWNER, isPlaceholderRepo };`)();
    expect(mod.PLACEHOLDER_REPO_OWNER).toBe('your-github-user');
    expect(mod.isPlaceholderRepo('acme/notes-releases')).toBe(false);
    expect(mod.isPlaceholderRepo('Your-GitHub-User/x')).toBe(true);
  });

  it('skips rules whose old and new values match', () => {
    expect(buildRules(cur, { ...cur })).toEqual([]);
  });

  it('fixes the indefinite article for the new name, both ways', () => {
    expect(article('Acme Notes')).toBe('an');
    expect(article('Starter App')).toBe('a');
    const text = 'This is a Starter App Pro feature. A Starter App export. For a Starter App Dev build. via Starter App, data Starter App';
    expect(applyRules(text, buildRules(cur, next)).text).toBe(
      'This is an Acme Notes Pro feature. An Acme Notes export. For an Acme Notes Dev build. via Acme Notes, data Acme Notes',
    );
    const acme = { ...cur, display: 'Acme Notes', devDisplay: 'Acme Notes Dev' };
    const zeta = { ...next, display: 'Zeta Cloud', devDisplay: 'Zeta Cloud Dev' };
    expect(applyRules('This is an Acme Notes Pro feature. For an Acme Notes Dev build.', buildRules(acme, zeta)).text).toBe(
      'This is a Zeta Cloud Pro feature. For a Zeta Cloud Dev build.',
    );
  });

  it('keeps the exclusion list', () => {
    for (const rel of ['CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/init-app.mjs', 'server/__tests__/initApp.test.js', 'node_modules/x/y.js',
      'dist/index.html', 'dist-ssr/a.js', 'src-tauri/target/debug/x', 'src-tauri/binaries/x', 'src-tauri/gen/x', 'src-tauri/resources/x', 'data/app.db', '.git/config',
      'server/db/migrations/002_items.sql', 'server/db/migrations.lock.json']) {
      expect(isExcludedPath(rel), rel).toBe(true);
    }
    for (const rel of ['README.md', 'src/App.jsx', 'src-tauri/Cargo.toml', 'docs/CHANGELOG.md', 'server/data/x.js']) expect(isExcludedPath(rel), rel).toBe(false);
  });
});

describe('icon markers', () => {
  it('marks generated icons and detects replaceable ones', () => {
    expect(isReplaceableIcon(letterIconSvg('Acme Notes'))).toBe(true);
    expect(isReplaceableIcon(letterFaviconSvg('Acme Notes'))).toBe(true);
    expect(isReplaceableIcon(pngIconSvg('Acme Notes', makePng(512, 512)))).toBe(false);
    expect(isReplaceableIcon('<svg viewBox="0 0 32 32"></svg>')).toBe(false);
  });
});

describe('rerunRisk', () => {
  const base = { display: 'Starter App', kebab: 'starter-app', exe: 'StarterApp', crate: 'starter-app-desktop' };
  it('is null for the kit names and for names that do not change', () => {
    expect(rerunRisk(base, { display: 'Notes' })).toBeNull();
    expect(rerunRisk({ display: 'Notes', kebab: 'notes', exe: 'Notes', crate: 'notes-desktop' }, { display: 'Notes' })).toBeNull();
  });
  it('flags single-word and very short current names', () => {
    expect(rerunRisk({ display: 'Notes', kebab: 'notes', exe: 'Notes', crate: 'notes-desktop' }, { display: 'Field Notes' })).toMatch(/single word/);
    expect(rerunRisk({ display: 'A B', kebab: 'a-b', exe: 'AB', crate: 'a-b-desktop' }, { display: 'Field Notes' })).toMatch(/shorter than 4/);
    expect(rerunRisk({ display: 'Acme Notes', kebab: 'acme-notes', exe: 'AcmeNotes', crate: 'acme-notes-desktop' }, { display: 'Field Notes' })).toBeNull();
  });
});

describe('sortCargoLockRoot', () => {
  const pkg = (name, version, source) => ['[[package]]', `name = "${name}"`, `version = "${version}"`, ...(source ? [`source = "${source}"`] : [])].join('\n');
  const REG = 'registry+https://github.com/rust-lang/crates.io-index';
  const GIT = 'git+https://example.com/x.git#abc';
  const lock = (...blocks) => `# generated\nversion = 4\n\n${blocks.join('\n\n')}\n`;
  const order = (text) => [...text.matchAll(/^name = "([^"]+)"/gm)].map((m) => m[1]);

  it('moves the root block to its byte-order position among the other packages', () => {
    const text = lock(pkg('alpha', '1.0.0', REG), pkg('serde', '1.0.0', REG), pkg('zlib', '1.0.0', REG), pkg('starter-app-desktop', '0.1.0'));
    expect(order(sortCargoLockRoot(text.replace('starter-app-desktop', 'acme-notes-desktop'), 'acme-notes-desktop'))).toEqual(['acme-notes-desktop', 'alpha', 'serde', 'zlib']);
    expect(order(sortCargoLockRoot(text.replace('starter-app-desktop', 'mid-desktop'), 'mid-desktop'))).toEqual(['alpha', 'mid-desktop', 'serde', 'zlib']);
    expect(order(sortCargoLockRoot(text.replace('starter-app-desktop', 'zz-desktop'), 'zz-desktop'))).toEqual(['alpha', 'serde', 'zlib', 'zz-desktop']);
  });

  it('compares names as plain bytes: "-" before "_" before lower case, upper case before lower case', () => {
    const text = lock(pkg('a-b', '1.0.0', REG), pkg('a_b', '1.0.0', REG), pkg('aa', '1.0.0', REG), pkg('b', '0.1.0'));
    expect(order(sortCargoLockRoot(text.replace('name = "b"', 'name = "a-c"'), 'a-c'))).toEqual(['a-b', 'a-c', 'a_b', 'aa']);
    expect(order(sortCargoLockRoot(text.replace('name = "b"', 'name = "Zed"'), 'Zed'))).toEqual(['Zed', 'a-b', 'a_b', 'aa']);
  });

  it('orders same-name packages by version, then by source (git, path, registry)', () => {
    const text = lock(pkg('dup', '0.9.0', REG), pkg('dup', '1.2.0', REG), pkg('dup', '1.10.0', REG), pkg('dup', '2.0.0-rc.1', REG), pkg('dup', '1.5.0'));
    const out = sortCargoLockRoot(text, 'dup');
    expect([...out.matchAll(/^version = "([^"]+)"/gm)].map((m) => m[1])).toEqual(['0.9.0', '1.2.0', '1.5.0', '1.10.0', '2.0.0-rc.1']);
    const tie = lock(pkg('dup', '1.0.0', GIT), pkg('dup', '1.0.0', REG), pkg('dup', '1.0.0'));
    const sources = sortCargoLockRoot(tie, 'dup').split('[[package]]').slice(1).map((b) => /source = "([^"]+)"/.exec(b)?.[1] ?? 'path');
    expect(sources).toEqual([GIT, 'path', REG]);
  });

  it('keeps every block intact, is idempotent, and keeps CRLF line endings and a trailing [metadata] section', () => {
    const text = `${lock(pkg('beta', '1.0.0', REG), pkg('acme-notes-desktop', '0.1.0'))}\n[metadata]\nkey = "v"\n`;
    const out = sortCargoLockRoot(text, 'acme-notes-desktop');
    expect(order(out)).toEqual(['acme-notes-desktop', 'beta']);
    expect(out.endsWith('[metadata]\nkey = "v"\n')).toBe(true);
    expect(sortCargoLockRoot(out, 'acme-notes-desktop')).toBe(out);
    const outCrlf = sortCargoLockRoot(text.replace(/\n/g, '\r\n'), 'acme-notes-desktop');
    expect(outCrlf.replace(/\r\n/g, '\n')).toBe(out);
    expect(outCrlf.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('returns the text unchanged when the root crate is not found as a path package', () => {
    const text = lock(pkg('beta', '1.0.0', REG), pkg('acme-notes-desktop', '0.1.0', REG));
    expect(sortCargoLockRoot(text, 'acme-notes-desktop')).toBe(text);
    expect(sortCargoLockRoot('version = 4\n', 'x')).toBe('version = 4\n');
  });
});

describe('icon helpers', () => {
  it('draws a glyph for every letter and digit start', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(glyphPath(ch)).toMatch(/^M/);
    expect(letterIconSvg('Acme Notes')).toContain('<title>Acme Notes</title>');
    expect(letterIconSvg('Acme Notes')).not.toContain('<text');
    expect(() => glyphPath('!')).toThrow();
  });

  it('reads PNG headers and wraps a PNG as an SVG', () => {
    const png = makePng(512, 512);
    expect(readPngSize(png)).toEqual({ width: 512, height: 512 });
    expect(readPngSize(Buffer.from('not a png at all, definitely not'))).toBeNull();
    const svg = pngIconSvg('Acme Notes', png);
    expect(svg).toContain('viewBox="0 0 1024 1024"');
    expect(svg).toContain('data:image/png;base64,');
  });

  it('rejects a missing, non-PNG, non-square or tiny icon', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-app-icon-'));
    try {
      const write = (name, buf) => {
        const f = path.join(dir, name);
        fs.writeFileSync(f, buf);
        return f;
      };
      expect(checkIconFile(path.join(dir, 'nope.png')).error).toMatch(/not found/);
      expect(checkIconFile(write('a.png', Buffer.from('hello world, not a png'))).error).toMatch(/not a PNG/);
      expect(checkIconFile(write('b.png', makePng(512, 256))).error).toMatch(/square/);
      expect(checkIconFile(write('c.png', makePng(64, 64))).error).toMatch(/at least 256/);
      expect(checkIconFile(write('d.png', makePng(1024, 1024)))).toMatchObject({ error: null, warning: null });
      expect(checkIconFile(write('e.png', makePng(512, 512))).warning).toMatch(/1024/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A buffer with a valid PNG signature and IHDR size (enough for the header checks). */
function makePng(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Integration: a small fixture tree
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER_RE = /starter[ _-]?app|starterapp|your-github-user|your-app/i;

const PLACEHOLDER_SOURCE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">',
  '  <!-- init-app:placeholder -->',
  '  <title>Starter App</title>',
  '  <rect width="32" height="32" rx="8" fill="#334155"/>',
  '</svg>',
  '',
].join('\n');
const PLACEHOLDER_FAVICON_SVG = PLACEHOLDER_SOURCE_SVG.replace('rx="8" fill="#334155"', 'rx="7" fill="#863bff"');

const FILES = {
  'package.json': `${JSON.stringify({ name: 'starter-app', private: true, version: '0.1.0', description: 'Starter App - a local-first desktop app.' }, null, 2)}\n`,
  'package-lock.json': `${JSON.stringify({ name: 'starter-app', version: '0.1.0', lockfileVersion: 3, packages: { '': { name: 'starter-app', version: '0.1.0' } } }, null, 2)}\n`,
  'src-tauri/tauri.conf.json': `${JSON.stringify({
    productName: 'Starter App', version: '../package.json', mainBinaryName: 'StarterApp', identifier: 'com.example.starterapp',
    bundle: { publisher: 'Starter App', externalBin: ['binaries/starter-app-server'] },
  }, null, 2)}\n`,
  'src-tauri/tauri.dev.conf.json': `${JSON.stringify({
    productName: 'Starter App Dev', mainBinaryName: 'AppDev', identifier: 'com.example.starterapp.dev',
    bundle: { shortDescription: 'Starter App Dev: a test build of Starter App', externalBin: ['binaries/starter-app-dev-server'] },
  }, null, 2)}\n`,
  'src-tauri/Cargo.toml': [
    '[package]', 'name = "starter-app-desktop"', 'version = "0.1.0"', 'description = "Starter App desktop shell"', '',
    '[lib]', 'name = "app_desktop_lib"', '', '[[bin]]', 'name = "StarterApp"', 'path = "src/main.rs"', '',
  ].join('\n'),
  'src-tauri/Cargo.lock': ['[[package]]', 'name = "other"', 'version = "1.0.0"', '', '[[package]]', 'name = "starter-app-desktop"', 'version = "0.1.0"', ''].join('\n'),
  'src-tauri/src/channel.rs': [
    'pub const STABLE_IDENTIFIER: &str = "com.example.starterapp";',
    'pub const DEV_IDENTIFIER: &str = "com.example.starterapp.dev";',
    'fn t() { from_identifier("COM.EXAMPLE.STARTERAPP.DEV"); from_identifier("com.example.starterapp.dev2"); }',
    '',
  ].join('\n'),
  'config/release.json': '{ "sourceRepo": "your-github-user/your-app", "releasesRepo": "your-github-user/your-app-releases" }\n',
  'config/store.json': `${JSON.stringify({ _help: 'Starter App licensing', supportContact: '[OWNER TODO: your support email or URL]', gumroad: { proProductId: '' } }, null, 2)}\n`,
  '.github/CODEOWNERS': '# Replace @your-github-user with your own GitHub handle or team.\n* @your-github-user\n',
  'server/paths.js': [
    "export const dirName = (win, dev) => (win ? (dev ? 'Starter App Dev' : 'Starter App') : (dev ? 'starter-app-dev' : 'starter-app'));", '',
  ].join('\n'),
  'docs/INSTALL.md': '[Starter-App-Setup-x64.exe](https://github.com/your-github-user/your-app-releases/releases/latest/download/Starter-App-Setup-x64.exe)\r\nInstall Starter App.\r\n',
  'README.md': '<!-- init-app:keep -->\n# Starter App\nThe placeholder is starter-app by your-github-user.\n',
  'CHANGELOG.md': '# Changelog\n- Starter App 0.1.0 by your-github-user\n',
  'LICENSE': 'Starter App license, your-github-user\n',
  'THIRD_PARTY_NOTICES.md': 'Starter App notices\n',
  'src-tauri/target/debug/log.txt': 'Starter App build output\n',
  'server/db/migrations/002_items.sql': 'CREATE TABLE items (id INTEGER PRIMARY KEY, notes TEXT);\nCREATE TABLE item_notes (id INTEGER, notes TEXT);\n',
  'server/db/migrations.lock.json': '{ "002_items.sql": "notes-hash" }\n',
  'server/items.js': "export const list_item_notes = () => 'notes'; // item_notes\n",
  'src/server.js': "import express from 'react';\nconst app = express();\nexport default app; // maintained by your-github-user\n",
  'src-tauri/icons/source.svg': PLACEHOLDER_SOURCE_SVG,
  'public/favicon.svg': PLACEHOLDER_FAVICON_SVG,
  'src-tauri/icons/blob.png': Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), Buffer.from('Starter App')]),
};

let dir;
let lines;

function mkIo() {
  lines = [];
  return { out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`), interactive: false };
}

function go(argv) {
  return run(argv, { root: dir, ...mkIo() });
}

function read(rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function snapshot() {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = fs.readFileSync(abs).toString('base64');
    }
  };
  walk(dir);
  return out;
}

const ACME = ['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes', '--support', 'help@example.com'];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-app-test-'));
  for (const [rel, content] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readCurrent', () => {
  it('reads the placeholder names from the tree', () => {
    expect(readCurrent(dir)).toEqual({
      display: 'Starter App',
      devDisplay: 'Starter App Dev',
      identifier: 'com.example.starterapp',
      kebab: 'starter-app',
      exe: 'StarterApp',
      crate: 'starter-app-desktop',
      installerPrefix: 'Starter-App',
      sourceRepo: 'your-github-user/your-app',
      releasesRepo: 'your-github-user/your-app-releases',
      support: '[OWNER TODO: your support email or URL]',
    });
  });

  it('fails clearly outside the kit', () => {
    fs.rmSync(path.join(dir, 'config'), { recursive: true });
    expect(() => readCurrent(dir)).toThrow(/config\/release\.json/);
  });
});

describe('init-app run', () => {
  it('renames the tree and leaves the excluded files alone', async () => {
    expect(await go(ACME)).toBe(0);

    const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
    expect(conf).toMatchObject({ productName: 'Acme Notes', mainBinaryName: 'AcmeNotes', identifier: 'com.acme.acmenotes' });
    expect(conf.bundle.externalBin).toEqual(['binaries/acme-notes-server']);
    const dev = JSON.parse(read('src-tauri/tauri.dev.conf.json'));
    expect(dev).toMatchObject({ productName: 'Acme Notes Dev', mainBinaryName: 'AppDev', identifier: 'com.acme.acmenotes.dev' });
    expect(dev.bundle.externalBin).toEqual(['binaries/acme-notes-dev-server']);
    expect(JSON.parse(read('package.json')).name).toBe('acme-notes');
    expect(JSON.parse(read('package-lock.json'))).toMatchObject({ name: 'acme-notes', packages: { '': { name: 'acme-notes' } } });
    expect(read('src-tauri/Cargo.toml')).toContain('name = "acme-notes-desktop"');
    expect(read('src-tauri/Cargo.toml')).toContain('name = "AcmeNotes"');
    expect(read('src-tauri/Cargo.toml')).toContain('name = "app_desktop_lib"');
    expect(read('src-tauri/Cargo.lock')).toContain('name = "acme-notes-desktop"');
    expect(read('src-tauri/Cargo.lock')).toContain('name = "other"');
    // cargo would write "acme-notes-desktop" before "other", so it must not be left at the old position.
    expect(read('src-tauri/Cargo.lock')).toBe(['[[package]]', 'name = "acme-notes-desktop"', 'version = "0.1.0"', '', '[[package]]', 'name = "other"', 'version = "1.0.0"', ''].join('\n'));
    expect(read('src-tauri/src/channel.rs')).toContain('"COM.ACME.ACMENOTES.DEV"');
    expect(read('src-tauri/src/channel.rs')).toContain('"com.acme.acmenotes.dev2"');
    expect(JSON.parse(read('config/release.json'))).toEqual({ sourceRepo: 'acme/notes', releasesRepo: 'acme/notes-releases' });
    expect(read('config/release.json')).toBe('{ "sourceRepo": "acme/notes", "releasesRepo": "acme/notes-releases" }\n');
    expect(JSON.parse(read('config/store.json')).supportContact).toBe('help@example.com');
    expect(read('.github/CODEOWNERS')).toBe('* @acme\n');
    expect(read('server/paths.js')).toContain("'Acme Notes Dev' : 'Acme Notes') : (dev ? 'acme-notes-dev' : 'acme-notes')");
    expect(read('docs/INSTALL.md')).toBe(
      '[Acme-Notes-Setup-x64.exe](https://github.com/acme/notes-releases/releases/latest/download/Acme-Notes-Setup-x64.exe)\r\nInstall Acme Notes.\r\n',
    );

    // Excluded or kept files are byte-identical to the fixture.
    for (const rel of ['README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'src-tauri/target/debug/log.txt', 'src-tauri/icons/blob.png']) {
      expect(fs.readFileSync(path.join(dir, rel)).equals(Buffer.isBuffer(FILES[rel]) ? FILES[rel] : Buffer.from(FILES[rel])), rel).toBe(true);
    }

    // No placeholder survives outside the exclusions.
    const kept = new Set(['README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'src-tauri/target/debug/log.txt', 'src-tauri/icons/blob.png']);
    for (const [rel, b64] of Object.entries(snapshot())) {
      if (kept.has(rel.split(path.sep).join('/'))) continue;
      expect(Buffer.from(b64, 'base64').toString('utf8'), rel).not.toMatch(PLACEHOLDER_RE);
    }
  });

  it('is a no-op the second time', async () => {
    expect(await go(ACME)).toBe(0);
    const before = snapshot();
    expect(await go(ACME)).toBe(0);
    expect(lines.join('\n')).toContain('Nothing to change.');
    expect(snapshot()).toEqual(before);
    // Optional values left out keep what the first run chose.
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes'])).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it('renames again from the current names', async () => {
    expect(await go(ACME)).toBe(0);
    expect(await go(['--yes', '--skip-icons', '--name', 'Zeta Cloud', '--repo', 'zeta-org/cloud', '--releases-repo', 'zeta-org/cloud-downloads', '--identifier', 'io.zeta.cloud'])).toBe(0);
    expect(JSON.parse(read('src-tauri/tauri.conf.json'))).toMatchObject({ productName: 'Zeta Cloud', mainBinaryName: 'ZetaCloud', identifier: 'io.zeta.cloud' });
    expect(JSON.parse(read('config/release.json'))).toEqual({ sourceRepo: 'zeta-org/cloud', releasesRepo: 'zeta-org/cloud-downloads' });
    expect(read('.github/CODEOWNERS')).toBe('* @zeta-org\n');
    expect(read('src-tauri/Cargo.toml')).toContain('name = "zeta-cloud-desktop"');
    expect(read('src-tauri/src/channel.rs')).toContain('"IO.ZETA.CLOUD.DEV"');
    expect(JSON.parse(read('config/store.json')).supportContact).toBe('help@example.com');
    for (const [rel, b64] of Object.entries(snapshot())) {
      if (['README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'blob.png', 'log.txt', 'store.json', 'server.js'].includes(path.basename(rel))) continue;
      expect(Buffer.from(b64, 'base64').toString('utf8'), rel).not.toMatch(/acme/i);
    }
  });

  it('--dry-run prints the plan and writes nothing', async () => {
    const before = snapshot();
    expect(await go([...ACME, '--dry-run'])).toBe(0);
    expect(snapshot()).toEqual(before);
    const out = lines.join('\n');
    expect(out).toContain('dry run');
    expect(out).toMatch(/ package\.json: 2 replacement/);
    expect(out).toContain('supportContact');
    expect(out).toContain('Left alone');
  });

  it('fails on missing required values and on bad values with --yes', async () => {
    expect(await go(['--yes', '--skip-icons', '--repo', 'acme/notes'])).toBe(1);
    expect(lines.join('\n')).toMatch(/--name is required/);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes'])).toBe(1);
    expect(await go(['--yes', '--skip-icons', '--name', '1bad', '--repo', 'acme/notes'])).toBe(1);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes', '--identifier', 'nodots'])).toBe(1);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes', '--releases-repo', 'acme/notes'])).toBe(1);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes', '--support', 'nope'])).toBe(1);
    expect(await go(['--yes', '--name', 'Acme Notes', '--repo', 'acme/notes', '--icon', path.join(dir, 'missing.png')])).toBe(1);
    expect(await go(['--bogus'])).toBe(1);
    expect(JSON.parse(read('package.json')).name).toBe('starter-app');
  });

  it('keeps the placeholder support contact when none is given, and says so', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes'])).toBe(0);
    expect(JSON.parse(read('config/store.json')).supportContact).toBe('[OWNER TODO: your support email or URL]');
    expect(lines.join('\n')).toContain('still the placeholder');
    expect(read('config/store.json')).toContain('Acme Notes licensing');
  });

  it('names the store config this tree has: config/ at the root, pro/config/ when the pro folder holds it', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes'])).toBe(0);
    let text = lines.join(String.fromCharCode(10));
    expect(text).toContain('Set it in config/store.json');
    expect(text).toContain('5. Fill in config/store.json,');
    expect(storeConfigRel(dir)).toBe('config/store.json');

    fs.mkdirSync(path.join(dir, 'pro', 'config'), { recursive: true });
    fs.renameSync(path.join(dir, 'config', 'store.json'), path.join(dir, 'pro', 'config', 'store.json'));
    lines = [];
    expect(await go(['--yes', '--skip-icons', '--name', 'Beta Notes', '--repo', 'acme/notes', '--force'])).toBe(0);
    text = lines.join(String.fromCharCode(10));
    expect(text).toContain('Set it in pro/config/store.json');
    expect(text).toContain('5. Fill in pro/config/store.json,');
    expect(storeConfigRel(dir)).toBe('pro/config/store.json');
  });

  it('prints help', async () => {
    expect(await go(['--help'])).toBe(0);
    expect(lines.join('\n')).toContain('--releases-repo');
  });

  it('prompts for missing values and asks for confirmation', async () => {
    const answers = ['Acme Notes', 'acme/notes', '', '', 'help@example.com', 'y'];
    const asked = [];
    const code = await run(['--skip-icons'], {
      root: dir,
      out: (l) => lines.push(l),
      err: (l) => lines.push(`ERR ${l}`),
      interactive: true,
      ask: async (q) => {
        asked.push(q);
        return answers.shift() ?? '';
      },
    });
    expect(code).toBe(0);
    expect(asked.some((q) => q.startsWith('App name'))).toBe(true);
    expect(asked[asked.length - 1]).toContain('Apply these changes?');
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).identifier).toBe('com.acme.acmenotes');
    expect(JSON.parse(read('config/store.json')).supportContact).toBe('help@example.com');
  });

  it('writes nothing when the confirmation is declined', async () => {
    const before = snapshot();
    const answers = ['Acme Notes', 'acme/notes', '', '', '', 'n'];
    const code = await run(['--skip-icons'], {
      root: dir,
      out: (l) => lines.push(l),
      err: (l) => lines.push(`ERR ${l}`),
      interactive: true,
      ask: async () => answers.shift() ?? '',
    });
    expect(code).toBe(1);
    expect(snapshot()).toEqual(before);
  });
});

describe('git safety', () => {
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });

  it('refuses a dirty work tree unless --force', async () => {
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'uncommitted');

    const before = snapshot();
    expect(await go(ACME)).toBe(1);
    expect(lines.join('\n')).toMatch(/uncommitted changes/);
    expect(snapshot()).toEqual(before);

    expect(await go([...ACME, '--force'])).toBe(0);
    expect(JSON.parse(read('package.json')).name).toBe('acme-notes');
  });

  it('proceeds on a clean work tree and honors .gitignore', async () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'Starter App secret notes\n');
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    expect(await go(ACME)).toBe(0);
    expect(read('ignored.txt')).toBe('Starter App secret notes\n');
    expect(JSON.parse(read('package.json')).name).toBe('acme-notes');
  });

  it('works without git and prints a tip', async () => {
    expect(await go(ACME)).toBe(0);
    expect(lines.join('\n')).toContain('git init');
  });
});

describe('re-run safety', () => {
  const NOTES = ['--yes', '--skip-icons', '--name', 'Notes', '--repo', 'acme/notes', '--support', 'help@example.com'];
  const FIELD = ['--yes', '--skip-icons', '--name', 'Field Notes', '--repo', 'acme/notes'];

  it('never edits migrations, even on a first run', async () => {
    expect(await go(ACME)).toBe(0);
    for (const rel of ['server/db/migrations/002_items.sql', 'server/db/migrations.lock.json']) {
      expect(read(rel)).toBe(FILES[rel]);
    }
  });

  it('warns on a single-word first run and then refuses a rename without --force', async () => {
    expect(await go(NOTES)).toBe(0);
    expect(lines.join('\n')).toMatch(/single word.*--force/);
    expect(JSON.parse(read('package.json')).name).toBe('notes');

    const before = snapshot();
    expect(await go(FIELD)).toBe(1);
    expect(lines.join('\n')).toMatch(/risky.*single word.*--force/s);
    expect(snapshot()).toEqual(before);
  });

  it('with --force still leaves the migrations untouched', async () => {
    expect(await go(NOTES)).toBe(0);
    expect(await go([...FIELD, '--force'])).toBe(0);
    expect(JSON.parse(read('package.json')).name).toBe('field-notes');
    expect(read('server/db/migrations/002_items.sql')).toBe(FILES['server/db/migrations/002_items.sql']);
    expect(read('server/db/migrations.lock.json')).toBe(FILES['server/db/migrations.lock.json']);
  });

  it('a dry run of a risky rename prints a note instead of refusing', async () => {
    expect(await go(NOTES)).toBe(0);
    const before = snapshot();
    expect(await go([...FIELD, '--dry-run'])).toBe(0);
    expect(lines.join('\n')).toMatch(/Note: Renaming again is risky/);
    expect(snapshot()).toEqual(before);
  });

  it('a common-word owner never rewrites ordinary code on a re-run', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'app/notes', '--support', 'help@example.com'])).toBe(0);
    const code = "import express from 'react';\nconst app = express();\nexport default app; // maintained by app\n";
    fs.writeFileSync(path.join(dir, 'src/server.js'), code);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'zeta/notes'])).toBe(0);
    expect(read('src/server.js')).toBe(code);
    expect(read('.github/CODEOWNERS')).toBe('* @zeta\n');
    expect(JSON.parse(read('config/release.json'))).toEqual({ sourceRepo: 'zeta/notes', releasesRepo: 'zeta/notes-releases' });
  });

  it('the first run still replaces the placeholder owner as a bare word', async () => {
    expect(await go(ACME)).toBe(0);
    expect(read('src/server.js')).toContain('maintained by acme');
  });

  it('a re-run rewrites slugs but leaves a bare owner next to them alone', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'acme/notes', '--support', 'help@example.com'])).toBe(0);
    // A test or doc that spells the owner both bare and inside a slug: after a re-run only the slug follows the repo.
    fs.writeFileSync(path.join(dir, 'src/owner.js'), "const OWNER = 'acme';\nconst REPO = 'acme/notes';\nconst OWNER_FROM_SLUG = REPO.split('/')[0];\n");
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'zeta/cloud'])).toBe(0);
    expect(read('src/owner.js')).toBe("const OWNER = 'acme';\nconst REPO = 'zeta/cloud';\nconst OWNER_FROM_SLUG = REPO.split('/')[0];\n");
  });

  it('applies the @owner handle rule to CODEOWNERS only, never to CSS at-rules or JSDoc', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'media/notes', '--support', 'help@example.com'])).toBe(0);
    const css = '@media (min-width: 600px) { .a { color: red; } }\n/** @param {string} x */\n';
    fs.writeFileSync(path.join(dir, 'src/style.css'), css);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'zeta/notes'])).toBe(0);
    expect(read('src/style.css')).toBe(css);
    expect(read('.github/CODEOWNERS')).toBe('* @zeta\n');
  });

  it('gives a real slug boundaries so a path like src/app/pages/x.js is not rewritten', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'app/pages', '--support', 'help@example.com'])).toBe(0);
    fs.mkdirSync(path.join(dir, 'src/app/pages'), { recursive: true });
    const body = "import x from 'src/app/pages/x.js'; // repo app/pages, app/pages.git, \"app/pages\", app/pages-extra\n" +
      '// https://github.com/app/pages#readme and https://api.github.com/repos/app/pages/issues\n';
    fs.writeFileSync(path.join(dir, 'src/app/pages/x.js'), body);
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', 'zeta/cloud'])).toBe(0);
    expect(read('src/app/pages/x.js')).toBe(
      "import x from 'src/app/pages/x.js'; // repo zeta/cloud, zeta/cloud.git, \"zeta/cloud\", app/pages-extra\n" +
        '// https://github.com/zeta/cloud#readme and https://api.github.com/repos/zeta/cloud/issues\n',
    );
    expect(JSON.parse(read('config/release.json'))).toEqual({ sourceRepo: 'zeta/cloud', releasesRepo: 'zeta/cloud-releases' });
  });

  describe('embedded names on a re-run', () => {
    const ITEM = ['--yes', '--skip-icons', '--name', 'Item Notes', '--repo', 'acme/notes', '--support', 'help@example.com'];
    const ZETA = ['--yes', '--skip-icons', '--name', 'Zeta Cloud', '--repo', 'zeta/cloud'];
    const CODE = "export const listItemNotes = () => [];\n// Your item notes stay on this PC.\n";

    it('refuses "Item Notes" -> "Zeta Cloud", listing the embedded identifier, and --force proceeds', async () => {
      expect(await go(ITEM)).toBe(0);
      fs.writeFileSync(path.join(dir, 'src/list.js'), CODE);
      const before = snapshot();
      expect(await go(ZETA)).toBe(1);
      const out = lines.join('\n');
      expect(out).toContain('listItemNotes');
      expect(out).toContain('src/list.js:1');
      expect(out).toMatch(/lower-case name/);
      expect(out).toContain('--force');
      expect(snapshot()).toEqual(before);

      expect(await go([...ZETA, '--dry-run'])).toBe(0);
      expect(lines.join('\n')).toMatch(/Note: Renaming again would also rewrite/);
      expect(snapshot()).toEqual(before);

      expect(await go([...ZETA, '--force'])).toBe(0);
      expect(JSON.parse(read('package.json')).name).toBe('zeta-cloud');
    });

    it('proceeds without --force when the names only appear in their normal derived forms', async () => {
      expect(await go(ACME)).toBe(0);
      const derived = [
        'acme-notes-desktop acme-notes-server acme-notes-dev-server acme-notes-dev AcmeNotes.exe',
        'Acme-Notes-Setup-x64.exe Acme Notes_${version}_${ARCH}-setup.exe Acme Notes_0.1.0_x64-setup.exe',
        'Acme Notes Dev ACME NOTES com.acme.acmenotes.dev COM.ACME.ACMENOTES',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(dir, 'docs/derived.md'), derived);
      expect(await go(ZETA)).toBe(0);
      expect(read('docs/derived.md')).toBe(
        [
          'zeta-cloud-desktop zeta-cloud-server zeta-cloud-dev-server zeta-cloud-dev ZetaCloud.exe',
          'Zeta-Cloud-Setup-x64.exe Zeta Cloud_${version}_${ARCH}-setup.exe Zeta Cloud_0.1.0_x64-setup.exe',
          'Zeta Cloud Dev ZETA CLOUD com.zeta.zetacloud.dev COM.ZETA.ZETACLOUD',
          '',
        ].join('\n'),
      );
    });

    it('does not scan on a first run from the placeholders', async () => {
      fs.writeFileSync(path.join(dir, 'src/list.js'), 'export const listStarterApp = () => [];\n// starter app\n');
      expect(await go(ACME)).toBe(0);
      expect(read('src/list.js')).toBe('export const listAcmeNotes = () => [];\n// acme notes\n');
    });
  });
});

describe('defaults are validated', () => {
  it('refuses a default identifier that ends in ".app"', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'App', '--repo', 'acme/notes'])).toBe(1);
    expect(lines.join('\n')).toMatch(/--identifier: the default "com\.acme\.app" is not usable/);
  });

  it('refuses a default releases repo name over 100 characters', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Acme Notes', '--repo', `acme/${'n'.repeat(95)}`])).toBe(1);
    expect(lines.join('\n')).toMatch(/--releases-repo: the default/);
  });

  it('compares the releases repo and the repo case-insensitively', async () => {
    expect(await go([...ACME, '--releases-repo', 'ACME/Notes'])).toBe(1);
    expect(lines.join('\n')).toMatch(/must differ/);
  });

  it('never defaults to a com.example identifier when only the repo changes', async () => {
    expect(await go(['--yes', '--skip-icons', '--name', 'Starter App', '--repo', 'acme/notes', '--support', 'help@example.com'])).toBe(0);
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).identifier).toBe('com.acme.starterapp');
  });

  it('validates a default accepted with Enter in the prompts', async () => {
    const answers = ['App', 'acme/notes', '', '', 'com.acme.appx', 'y'];
    const code = await run(['--skip-icons', '--support', 'help@example.com'], {
      root: dir,
      out: (l) => lines.push(l),
      err: (l) => lines.push(`ERR ${l}`),
      interactive: true,
      ask: async () => answers.shift() ?? 'com.acme.appx',
    });
    expect(lines.join('\n')).toMatch(/must not end in "\.app"/);
    expect(code).toBe(0);
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).identifier).toBe('com.acme.appx');
  });
});

describe('icon preservation', () => {
  const ICONS = ['--yes', '--name', 'Acme Notes', '--repo', 'acme/notes', '--support', 'help@example.com'];
  const CUSTOM = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="10"/></svg>\n';

  it('replaces the shipped placeholder with a letter icon and favicon', async () => {
    expect(await go(ICONS)).toBe(0);
    expect(read('src-tauri/icons/source.svg')).toBe(letterIconSvg('Acme Notes'));
    expect(read('public/favicon.svg')).toBe(letterFaviconSvg('Acme Notes'));
  });

  it('preserves custom artwork and says so', async () => {
    fs.writeFileSync(path.join(dir, 'src-tauri/icons/source.svg'), CUSTOM);
    fs.writeFileSync(path.join(dir, 'public/favicon.svg'), CUSTOM);
    expect(await go(ICONS)).toBe(0);
    expect(read('src-tauri/icons/source.svg')).toBe(CUSTOM);
    expect(read('public/favicon.svg')).toBe(CUSTOM);
    expect(lines.join('\n')).toMatch(/source\.svg is your own artwork/);
  });

  it('regenerates a previously generated letter icon for a new name', async () => {
    expect(await go(ICONS)).toBe(0);
    expect(await go(['--yes', '--name', 'Zeta Cloud', '--repo', 'acme/notes', '--support', 'help@example.com'])).toBe(0);
    expect(read('src-tauri/icons/source.svg')).toBe(letterIconSvg('Zeta Cloud'));
    expect(read('public/favicon.svg')).toBe(letterFaviconSvg('Zeta Cloud'));
  });

  it('--icon replaces even custom artwork and leaves the favicon alone', async () => {
    fs.writeFileSync(path.join(dir, 'src-tauri/icons/source.svg'), CUSTOM);
    const png = path.join(dir, 'icon.png');
    fs.writeFileSync(png, makePng(1024, 1024));
    expect(await go([...ICONS, '--icon', png])).toBe(0);
    expect(read('src-tauri/icons/source.svg')).toContain('data:image/png;base64,');
    expect(read('public/favicon.svg')).not.toContain('init-app:generated');
  });
});
