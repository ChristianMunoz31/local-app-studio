// Smoke test for the document parser inside the built sidecar executable (Node SEA self-spawn):
//   1. the exe started directly with `--role parser`, one generated PDF on stdin (exit code, time, result);
//   2. the same exe through createParserHost with the SEA spawn spec forced (execPath = the exe);
//   3. the heap cap really applies to the exe: with NODE_OPTIONS=--max-old-space-size=8 the parse dies with a
//      V8 out-of-memory exit, which the host reports as doc_crashed.
// Every run gets a throwaway APP_DATA_DIR that must still be empty afterwards. Needs `npm run build` and
// `npm run desktop:sidecar` first.
//
// Usage: node scripts/desktop/smokeParser.js [--sidecar <exe>]   (default: .sidecar-build/<package name>-server[.exe])
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LIMITS } from '../../server/ingest/limits.js';
import { findStraySidecars, sidecarExeName } from '../lib/sidecarName.js';
import { createParserHost, defaultSpawnSpec, minimalChildEnv } from '../../server/ingest/parserHost.js';
import { SAMPLE_PAGES, makePdf } from '../../server/__tests__/helpers/ingestDocs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values } = parseArgs({ options: { sidecar: { type: 'string' } } });
const exe = path.resolve(values.sidecar ?? path.join(ROOT, '.sidecar-build', sidecarExeName({ root: ROOT })));
if (!fs.existsSync(exe)) {
  const strays = values.sidecar ? [] : findStraySidecars(path.dirname(exe), path.basename(exe));
  const hint = strays.length > 0 ? `\nFound ${strays.join(', ')} instead: the sidecar name is package.json name + "-server".` : '';
  console.error(`sidecar not found: ${exe}${hint}\nRun npm run build and npm run desktop:sidecar first.`);
  process.exit(1);
}

const pdf = makePdf(SAMPLE_PAGES, { title: 'smoke' });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-smoke-'));
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

/** Runs the exe directly: returns exit info and the captured streams. */
function direct(heapMb) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(exe, ['--role', 'parser'], {
      env: { ...minimalChildEnv(), APP_DATA_DIR: dataDir, NODE_OPTIONS: `--max-old-space-size=${heapMb}` },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, signal) => resolve({ code, signal, ms: Date.now() - started, stdout, stderr }));
    child.stdin.end(Buffer.concat([Buffer.from(`${JSON.stringify({ v: 1, kind: 'pdf', bytes: pdf.length })}\n`), pdf]));
  });
}

try {
  console.log(`sidecar: ${exe}`);
  const first = await direct(LIMITS.heapMb);
  const result = JSON.parse(first.stdout.trim() || 'null');
  console.log(`direct: exit ${first.code}, ${first.ms} ms, stdout ${first.stdout.length} bytes`);
  check(first.code === 0 && result?.ok === true, 'direct run exits 0 with an ok result');
  check(result?.pages?.length === 2 && result.pages[0].runs.length === 4, 'result has 2 pages and 4 positioned runs on page 1');

  const host = createParserHost({
    spawnSpec: () => {
      const spec = defaultSpawnSpec({ heapMb: LIMITS.heapMb, sea: true, execPath: exe });
      return { ...spec, env: { ...spec.env, APP_DATA_DIR: dataDir } };
    },
  });
  const started = Date.now();
  const viaHost = await host.run(pdf, 'pdf');
  console.log(`via parserHost (SEA branch forced): ok=${viaHost.ok} in ${Date.now() - started} ms`);
  check(viaHost.ok === true && viaHost.pages.length === 2, 'parserHost with the SEA spawn spec returns the same contract');

  const tiny = await direct(8);
  console.log(`heap 8 MB: exit ${tiny.code}${tiny.signal ? ` signal ${tiny.signal}` : ''}, ${tiny.ms} ms, "${(/heap out of memory|Allocation failed/i.exec(tiny.stderr) ?? [''])[0]}"`);
  check(tiny.code !== 0 && /out of memory|Allocation failed/i.test(tiny.stderr), 'a tiny NODE_OPTIONS heap cap is honored by the exe (V8 out of memory)');

  check(fs.readdirSync(dataDir).length === 0, 'APP_DATA_DIR is still empty');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nparser smoke ok');
