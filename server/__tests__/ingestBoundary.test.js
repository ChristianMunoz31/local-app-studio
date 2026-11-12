// Static architecture guard (fs + regex over the source tree, no process started), modeled on aiBoundary.test.js:
// server/ingest/ is the only place that imports the PDF library (unpdf) or the streaming ZIP reader used for DOCX,
// the rest of the app reaches it through server/ingest/index.js, the child-side modules touch no file system,
// network, database or environment, and the dispatcher entry imports nothing but ./role.js statically.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.sidecar-build']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const CODE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/;
const isTest = (p) => /(?:^|\/)__tests__\//.test(p) || /\.test\.[jt]sx?$/.test(p);
const read = (abs) => fs.readFileSync(abs, 'utf8');

/** Every static/dynamic import specifier and require() in a file. */
function specifiers(source) {
  const out = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (const m of source.matchAll(re)) out.push(m[2]);
  return out;
}
/** Only static `import ... from` / `import 'x'` specifiers. */
function staticSpecifiers(source) {
  const out = [];
  for (const m of source.matchAll(/^\s*import\s+(?:[^'"\n;]*?\s+from\s+)?(['"])([^'"\n]+)\1/gm)) out.push(m[2]);
  return out;
}

const allCode = [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'packages', 'runtime')), ...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'pro', 'server')), ...walk(path.join(ROOT, 'pro', 'src')), ...walk(path.join(ROOT, 'pro', 'scripts')), path.join(ROOT, 'server.js')]
  .filter((f) => fs.existsSync(f) && CODE.test(f) && !isTest(rel(f)));
const ingestFiles = walk(path.join(ROOT, 'server', 'ingest')).filter((f) => CODE.test(f));
const insideIngest = (r) => r.startsWith('server/ingest/');

describe('document ingest boundary', () => {
  it('scans a non-trivial file set (the guard is not vacuous)', () => {
    expect(allCode.length).toBeGreaterThan(50);
    expect(ingestFiles.map(rel).sort()).toEqual(
      expect.arrayContaining(['server/ingest/index.js', 'server/ingest/parserChild.js', 'server/ingest/parserHost.js', 'server/ingest/pdf.js', 'server/ingest/docx.js']),
    );
  });

  it('only server/ingest/ imports unpdf', () => {
    const offenders = allCode.filter((f) => !insideIngest(rel(f)) && specifiers(read(f)).some((s) => s === 'unpdf' || s.startsWith('unpdf/')));
    expect(offenders.map(rel)).toEqual([]);
    expect(ingestFiles.filter((f) => specifiers(read(f)).some((s) => s.startsWith('unpdf'))).map(rel)).toEqual(['server/ingest/pdf.js']);
  });

  it('only server/ingest/docx.js uses the streaming ZIP reader (Unzip, UnzipInflate) for DOCX', () => {
    const offenders = allCode.filter((f) => rel(f) !== 'server/ingest/docx.js' && /\bUnzip(?:Inflate)?\b/.test(read(f)) && specifiers(read(f)).some((s) => s === 'fflate' || s.startsWith('fflate/')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('outside code reaches the parser only through server/ingest/index.js (entry.js loads the child by role)', () => {
    const offenders = [];
    for (const f of allCode) {
      const r = rel(f);
      if (insideIngest(r)) continue;
      for (const spec of specifiers(read(f)).filter((s) => s.startsWith('.'))) {
        const target = rel(path.resolve(path.dirname(f), spec));
        if (!/^server\/ingest(?:\/|$)/.test(target)) continue;
        if (/^server\/ingest(?:\/index(?:\.js)?)?$/.test(target)) continue;
        if (r === 'server/entry.js' && target === 'server/ingest/parserChild.js') continue;
        // The SEA smoke script drives the host with the built exe as spawn target, so it needs the host internals.
        if (r === 'scripts/desktop/smokeParser.js' && (target === 'server/ingest/limits.js' || target === 'server/ingest/parserHost.js')) continue;
        offenders.push(`${r} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the parent-side modules never load a format parser (the sidecar parent does not pay for pdf.js)', () => {
    for (const name of ['index.js', 'parserHost.js', 'limits.js']) {
      const specs = specifiers(read(path.join(ROOT, 'server', 'ingest', name)));
      expect(specs.filter((s) => /unpdf|fflate|\.\/(pdf|docx|text|parserChild)(?:\.js)?$/.test(s)), name).toEqual([]);
    }
  });

  it('ingest imports nothing outside its folder except a short list of Node built-ins and the two libraries', () => {
    const allowed = new Set(['unpdf/pdfjs', 'fflate', 'node:child_process', 'node:sea', 'node:path', 'node:url', 'node:buffer']);
    for (const f of ingestFiles) {
      for (const spec of specifiers(read(f))) {
        if (spec.startsWith('./')) continue;
        expect(allowed.has(spec), `${rel(f)} imports ${spec}`).toBe(true);
      }
    }
  });

  it('the child-side modules touch no file system, network, worker, child process, database or environment', () => {
    const childSide = ['parserChild.js', 'pdf.js', 'docx.js', 'text.js', 'clean.js', 'limits.js', 'result.js'];
    for (const name of childSide) {
      const src = read(path.join(ROOT, 'server', 'ingest', name));
      expect(specifiers(src).filter((s) => s.startsWith('node:') && !['node:buffer'].includes(s)), name).toEqual([]);
      expect(src, name).not.toMatch(/\bprocess\.env\b|\brequire\s*\(|\bfs\.|\bfetch\s*\(|\bXMLHttpRequest\b|\bnew WebSocket\b|\bchild_process\b|\bworker_threads\b/);
    }
    expect(read(path.join(ROOT, 'server', 'ingest', 'parserChild.js'))).toMatch(/globalThis\.fetch = \(\) => Promise\.reject/);
  });

  it('no ingest module reads the environment, and only parserHost.js spawns', () => {
    for (const f of ingestFiles) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/\bprocess\.env\b/);
      if (rel(f) !== 'server/ingest/parserHost.js') expect(src, rel(f)).not.toMatch(/\bspawn\(|\bfork\(|\bexec(?:File)?\(/);
    }
    expect(read(path.join(ROOT, 'server', 'ingest', 'parserHost.js'))).toMatch(/stdio: \['pipe', 'pipe', 'pipe'\]/);
  });

  it('the dispatcher entry imports only ./role.js statically and server.js never imports the child', () => {
    const entry = read(path.join(ROOT, 'server', 'entry.js'));
    expect(staticSpecifiers(entry)).toEqual(['./role.js']);
    expect(entry).toMatch(/import\('\.\/ingest\/parserChild\.js'\)/);
    expect(entry).toMatch(/import\('\.\.\/server\.js'\)/);
    expect(read(path.join(ROOT, 'server.js'))).not.toMatch(/parserChild/);
  });

  it('the sidecar bundle starts at entry.js', () => {
    expect(read(path.join(ROOT, 'scripts', 'desktop', 'buildSidecar.js'))).toMatch(/entryPoints: \[path\.join\(ROOT, 'server', 'entry\.js'\)\]/);
  });
});
