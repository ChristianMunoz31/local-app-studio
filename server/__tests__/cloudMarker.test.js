// scripts/checks/cloudMarker.js: the scanner behind check:cloud-marker, and the ties that keep the markers real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOUD_PROVIDER_MARKER, CLOUD_UI_MARKER, CLOUD_WIRE_TEXT, checkDistDir, checkServerArtifact, defaultTargets, main } from '../../scripts/checks/cloudMarker.js';
import { OPENAI_COMPAT_PROVIDER_MARKER } from '../ai/providers/openaiCompat.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir;
let n = 0;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-marker-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const tree = (extra) => {
  const files = { 'package.json': JSON.stringify({ name: 'local-app-studio' }), ...extra };
  const root = path.join(dir, `t${(n += 1)}`);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
};
const io = () => {
  const out = { log: [], error: [] };
  return { out, io: { log: (m) => out.log.push(m), error: (m) => out.error.push(m) } };
};
const run = (argv) => {
  const { out, io: sink } = io();
  return { code: main(argv, sink), ...out };
};

describe('checkServerArtifact', () => {
  const withMarker = `var x = "${CLOUD_PROVIDER_MARKER}";`;
  const withWire = `fetch(base + "/${CLOUD_WIRE_TEXT}");`;

  it('present needs the marker', () => {
    expect(checkServerArtifact(withMarker, 'present')).toEqual([]);
    expect(checkServerArtifact('var x = 1;', 'present')).toHaveLength(1);
  });

  it('absent forbids the marker and the wire path, each reported', () => {
    expect(checkServerArtifact('var x = 1;', 'absent')).toEqual([]);
    expect(checkServerArtifact(withMarker, 'absent')).toHaveLength(1);
    expect(checkServerArtifact(withWire, 'absent')).toHaveLength(1);
    expect(checkServerArtifact(withMarker + withWire, 'absent')).toHaveLength(2);
  });

  it('reads a Buffer as latin1, so bytes around the text do not matter', () => {
    const bytes = Buffer.concat([Buffer.from([0, 255, 128, 7]), Buffer.from(withMarker), Buffer.from([200, 0])]);
    expect(checkServerArtifact(bytes, 'present')).toEqual([]);
    expect(checkServerArtifact(bytes, 'absent')).toHaveLength(1);
  });
});

describe('checkDistDir', () => {
  it('present needs at least one hit; absent lists the offenders, at most five', () => {
    const files = {};
    for (let i = 0; i < 7; i += 1) files[`assets/a${i}.js`] = `x="${CLOUD_UI_MARKER}"`;
    const dist = tree({ 'index.html': '<html></html>', ...files });
    expect(checkDistDir(dist, 'present')).toEqual([]);
    const problems = checkDistDir(dist, 'absent');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('and 2 more');
    expect(problems[0].match(/assets\/a\d\.js/g)).toHaveLength(5);
  });

  it('a clean folder passes absent and fails present', () => {
    const dist = tree({ 'index.html': '<html></html>', 'assets/app.js': 'console.log(1)' });
    expect(checkDistDir(dist, 'absent')).toEqual([]);
    expect(checkDistDir(dist, 'present')).toHaveLength(1);
  });

  it('scans css, html, json and map files too, and ignores other extensions', () => {
    for (const ext of ['css', 'html', 'json', 'map']) {
      expect(checkDistDir(tree({ [`f.${ext}`]: CLOUD_UI_MARKER }), 'absent'), ext).toHaveLength(1);
    }
    expect(checkDistDir(tree({ 'f.png': CLOUD_UI_MARKER }), 'absent')).toEqual([]);
  });

  it('a folder that does not exist is a problem', () => {
    expect(checkDistDir(path.join(dir, 'missing'), 'absent')).toHaveLength(1);
  });
});

describe('main', () => {
  it('needs exactly one of --require-absent and --require-present', () => {
    const file = path.join(tree({ 'b.cjs': 'x' }), 'b.cjs');
    expect(run(['--bundle', file]).code).toBe(1);
    expect(run(['--require-absent', '--require-present', '--bundle', file]).code).toBe(1);
  });

  it('rejects unknown flags and flags without a value', () => {
    expect(run(['--require-absent', '--nope']).error.join('\n')).toContain('Unknown argument: --nope');
    expect(run(['--require-absent', '--bundle']).error.join('\n')).toContain('--bundle needs a value');
  });

  it('exits 0 when every target matches and 1 when any does not', () => {
    const root = tree({ 'with.cjs': CLOUD_PROVIDER_MARKER, 'without.cjs': 'x', 'dist/index.html': 'x' });
    const w = path.join(root, 'with.cjs');
    const wo = path.join(root, 'without.cjs');
    expect(run(['--require-present', '--bundle', w]).code).toBe(0);
    expect(run(['--require-absent', '--bundle', wo, '--binary', wo, '--dist-dir', path.join(root, 'dist')]).code).toBe(0);
    const bad = run(['--require-absent', '--bundle', w, '--bundle', wo]);
    expect(bad.code).toBe(1);
    expect(bad.error.join('\n')).toContain('cloud marker check failed');
    expect(run(['--require-present', '--bundle', wo]).code).toBe(1);
    expect(run(['--require-present', '--bundle', path.join(root, 'missing.cjs')]).code).toBe(1);
  });

  it('with no target flags it checks the default build outputs, and says so when there are none', () => {
    const empty = tree({});
    expect(defaultTargets(empty)).toEqual({ bundles: [], binaries: [], distDirs: [] });
    const root = tree({ '.sidecar-build/server.cjs': 'x', 'src-tauri/binaries/app-server-x.exe': 'x', 'dist/index.html': 'x' });
    const found = defaultTargets(root);
    expect(found.bundles).toHaveLength(1);
    expect(found.binaries).toHaveLength(1);
    expect(found.distDirs).toHaveLength(1);
  });

  it('finds the renamed sidecar exe in .sidecar-build by the package name', () => {
    const renamed = tree({ 'package.json': JSON.stringify({ name: 'session-ledger' }), '.sidecar-build/session-ledger-server.exe': 'x', '.sidecar-build/session-ledger-server': 'x' });
    expect(defaultTargets(renamed).binaries.map((b) => path.basename(b)).sort()).toEqual(['session-ledger-server', 'session-ledger-server.exe']);
    const stale = tree({ 'package.json': JSON.stringify({ name: 'session-ledger' }), '.sidecar-build/local-app-studio-server.exe': 'x' });
    expect(defaultTargets(stale).binaries).toEqual([]);
  });

  it('fails loudly for a requested bundle, binary or folder that does not exist', () => {
    const root = tree({ 'ok.cjs': CLOUD_PROVIDER_MARKER });
    for (const flag of ['--bundle', '--binary']) {
      const r = run(['--require-present', flag, path.join(root, 'nope.exe')]);
      expect(r.code).toBe(1);
      expect(r.error.join('\n')).toContain('does not exist');
    }
    const d = run(['--require-absent', '--dist-dir', path.join(root, 'nodist')]);
    expect(d.code).toBe(1);
    expect(d.error.join('\n')).toContain('does not exist');
  });

  it('also scans the UI copy bundled for the desktop shell', () => {
    const root = tree({ 'dist/index.html': 'x', 'src-tauri/resources/dist/index.html': 'x' });
    const found = defaultTargets(root);
    expect(found.distDirs.map((d) => path.relative(root, d).split(path.sep).join('/'))).toEqual(['dist', 'src-tauri/resources/dist']);
    expect(defaultTargets(tree({ 'src-tauri/resources/dist/index.html': 'x' })).distDirs).toHaveLength(1);
  });
});

describe('the markers are tied to real code', () => {
  const walk = (start, skip) => {
    const out = [];
    for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
      const full = path.join(start, entry.name);
      if (entry.isDirectory()) {
        if (!skip.includes(entry.name)) out.push(...walk(full, skip));
      } else if (/\.(js|jsx|cjs|mjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
  const withText = (start, text) => walk(start, ['__tests__', 'node_modules']).filter((f) => fs.readFileSync(f, 'utf8').includes(text)).map(rel);

  it.skipIf(PUBLIC_BUILD)('the server marker constant is the transport marker (the transport is pro, which is not in a public build)', () => {
    expect(CLOUD_PROVIDER_MARKER).toBe(OPENAI_COMPAT_PROVIDER_MARKER);
  });

  // The real transport and the cloud block are pro twins (docs/ARCHITECTURE.md, 'The pro seam'): the open tree carries no marker
  // and the pro tree carries each marker once. A source scan, so it holds in a public run too; it needs the pro folder in the checkout.
  const PRO_PRESENT = fs.existsSync(path.join(ROOT, 'pro', 'server'));

  it('no open server or src file carries a marker', () => {
    expect(withText(path.join(ROOT, 'server'), CLOUD_PROVIDER_MARKER)).toEqual([]);
    expect(withText(path.join(ROOT, 'src'), CLOUD_UI_MARKER)).toEqual([]);
  });

  it.skipIf(!PRO_PRESENT)('exactly one server file carries the server marker: the real transport (a pro twin)', () => {
    expect(withText(path.join(ROOT, 'pro', 'server'), CLOUD_PROVIDER_MARKER)).toEqual(['pro/server/ai/providers/openaiCompat.js']);
  });

  it.skipIf(!PRO_PRESENT)('exactly one src file carries the UI marker: the cloud block (a pro twin)', () => {
    expect(withText(path.join(ROOT, 'pro', 'src'), CLOUD_UI_MARKER)).toEqual(['pro/src/components/settings/CloudAiBlock.jsx']);
  });

  it('the markers do not contain the template slug that init-app rewrites', () => {
    expect(CLOUD_PROVIDER_MARKER).not.toContain('local-app-studio');
    expect(CLOUD_UI_MARKER).not.toContain('local-app-studio');
  });

  it('the server stub contains neither marker nor wire text, and the UI stub no marker', () => {
    const stub = fs.readFileSync(path.join(ROOT, 'server', 'ai', 'providers', 'openaiCompat.disabled.js'), 'utf8');
    expect(stub).not.toContain(CLOUD_PROVIDER_MARKER);
    expect(stub).not.toContain(CLOUD_WIRE_TEXT);
    const ui = fs.readFileSync(path.join(ROOT, 'src', 'components', 'settings', 'cloudUi.disabled.js'), 'utf8');
    expect(ui).not.toContain(CLOUD_UI_MARKER);
  });

  it('the public stubs at the seam paths carry the bytes of the disabled twins', () => {
    const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
    expect(read('server', 'ai', 'providers', 'openaiCompat.js')).toBe(read('server', 'ai', 'providers', 'openaiCompat.disabled.js'));
    expect(read('src', 'components', 'settings', 'cloudUi.js')).toBe(read('src', 'components', 'settings', 'cloudUi.disabled.js'));
  });
});
