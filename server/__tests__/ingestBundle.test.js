// The sidecar bundle with server/entry.js as its entry (what scripts/desktop/buildSidecar.js builds): the parser
// role runs from the bundle without evaluating server.js (esbuild wraps the lazily imported modules in __esm
// initializers), refuses a bad role, and the SEA-only spawn spec is the bundle's own executable.
// The bundle is built into a temp dir with the same settings as the sidecar (no minify, so the shape is readable).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDLE_BANNER, bundleDefine, channelBanner } from '../../scripts/desktop/workerBundle.js';
import { SAMPLE_PAGES, makePdf } from './helpers/ingestDocs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir;
let bundle;
let source;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-bundle-'));
  bundle = path.join(dir, 'server.cjs');
  await build({
    entryPoints: [path.join(ROOT, 'server', 'entry.js')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    logLevel: 'silent',
    define: { ...bundleDefine('0.0.0', { channel: 'stable', buildDate: '2026-01-01T00:00:00Z' }), __APP_BACKUP_WORKER_SRC__: '""' },
    banner: { js: channelBanner('stable') + BUNDLE_BANNER },
  });
  source = fs.readFileSync(bundle, 'utf8');
}, 120_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const job = (bytes, kind) => Buffer.concat([Buffer.from(`${JSON.stringify({ v: 1, kind, bytes: bytes.length })}\n`), bytes]);

describe('bundle with the dispatcher entry', () => {
  it('keeps the channel marker first and loads server.js and the child lazily, each in its own branch', () => {
    expect(source.startsWith('/*! APP_CHANNEL=stable */')).toBe(true);
    const at = source.indexOf('role = roleFromArgv(process.argv)');
    expect(at).toBeGreaterThan(0);
    const dispatch = source.slice(at);
    const parser = dispatch.indexOf('init_parserChild()');
    const server = dispatch.indexOf('init_server()');
    const elseAt = dispatch.indexOf('} else {');
    expect(parser).toBeGreaterThan(0);
    expect(elseAt).toBeGreaterThan(parser);
    expect(server).toBeGreaterThan(elseAt);
    // Neither initializer is called anywhere else in the bundle.
    expect(source.split('init_parserChild()').length - 1).toBe(1);
    expect(source.split('init_server()').length - 1).toBe(1);
  });

  it('runs the parser role from the bundle: one job in, one result out, data folder untouched', () => {
    const data = fs.mkdtempSync(path.join(dir, 'data-'));
    const run = spawnSync(process.execPath, [bundle, '--role', 'parser'], { input: job(makePdf(SAMPLE_PAGES), 'pdf'), env: { APP_DATA_DIR: data, APP_NO_DOTENV: '1' }, timeout: 60_000 });
    expect(run.status).toBe(0);
    expect(run.stderr.toString()).toBe('');
    const out = JSON.parse(run.stdout.toString());
    expect(out).toMatchObject({ ok: true, kind: 'pdf', meta: { pageCount: 2 } });
    expect(out.pages[0].runs).toHaveLength(4);
    expect(fs.readdirSync(data)).toEqual([]);
  }, 90_000);

  it('refuses an unknown role from the bundle with exit 2', () => {
    const run = spawnSync(process.execPath, [bundle, '--role', 'bogus'], { env: { APP_NO_DOTENV: '1' }, timeout: 60_000 });
    expect(run.status).toBe(2);
    expect(run.stdout.toString()).toBe('');
  });

  it('the bundle has a SEA branch that starts the executable itself with --role parser and the heap cap in NODE_OPTIONS', () => {
    expect(source).toMatch(/function defaultSpawnSpec\(\{ heapMb, sea = \(0, \w+\.isSea\)\(\)[^)]*\}\) \{\s*if \(sea\) \{/);
    expect(source).toContain('"--role", "parser"');
    expect(source).toContain('NODE_OPTIONS: `--max-old-space-size=${heapMb}`');
  });
});
