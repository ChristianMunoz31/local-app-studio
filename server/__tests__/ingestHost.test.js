// Parser host contract (server/ingest/parserHost.js) against FAKE children: timeout kill, crash mapping, single
// slot with FIFO order, queue cap, abort of in-flight and queued jobs, spawn failure, output validation, stderr cap.
// The children are `node -e <script>` processes; no PDF library is involved, so these tests are fast.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createParserHost, validateChildResult } from '../ingest/parserHost.js';
import { LIMITS, MESSAGES } from '../ingest/limits.js';

const TEXT_BYTES = Buffer.from('hello');
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-host-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A spawn spec running an inline script. */
const fake = (script, args = []) => () => ({ command: process.execPath, args: ['-e', script, ...args] });

const OK_TEXT = (text) => JSON.stringify({ ok: true, kind: 'text', pages: [{ page: null, text }], meta: { pageCount: null, paginated: false, truncated: false } });

/** Reads stdin to EOF, then runs `body` (which can use `input`, a Buffer of the whole frame). */
const withInput = (body) => `const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{const input=Buffer.concat(c);${body}});`;

const waitFor = async (check, ms = 10_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Child that records its pid in tmp and then hangs. */
const hangScript = (file) => `require('fs').writeFileSync(${JSON.stringify(file)}, String(process.pid));setInterval(()=>{},1000);`;
const readPid = (file) => () => (fs.existsSync(file) && fs.readFileSync(file, 'utf8') ? Number(fs.readFileSync(file, 'utf8')) : 0);

describe('parser host: results', () => {
  it('returns a valid child answer and passes the framed bytes on stdin', async () => {
    const host = createParserHost({
      spawnSpec: fake(withInput(`const nl=input.indexOf(10);const h=JSON.parse(input.subarray(0,nl));process.stdout.write(JSON.stringify({ok:true,kind:'text',pages:[{page:null,text:h.kind+':'+h.bytes+':'+input.subarray(nl+1).toString()}],meta:{pageCount:null,paginated:false,truncated:false}})+'\\n');`)),
    });
    const out = await host.run(TEXT_BYTES, 'text');
    expect(out).toMatchObject({ ok: true, kind: 'text' });
    expect(out.pages[0].text).toBe('text:5:hello');
  });

  it('keeps a content failure from the child but replaces its message with the fixed text', async () => {
    const host = createParserHost({
      spawnSpec: fake(withInput(`process.stdout.write(JSON.stringify({ok:false,code:'parse_failed',message:'pdf.js InvalidPDFException at C:\\\\secret\\\\path'})+'\\n');`)),
    });
    const out = await host.run(TEXT_BYTES, 'text');
    expect(out).toEqual({ ok: false, code: 'parse_failed', message: MESSAGES.parse_failed });
    expect(JSON.stringify(out)).not.toMatch(/pdf\.js|secret/);
  });

  it('input checks happen before any process is started', async () => {
    let spawned = 0;
    const host = createParserHost({
      maxInputBytes: 4,
      spawnSpec: () => {
        spawned += 1;
        return { command: process.execPath, args: ['-e', ''] };
      },
    });
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('too_large');
    expect((await host.run(Buffer.alloc(0), 'text')).code).toBe('empty');
    expect((await host.run(Buffer.from('ab'), 'exe')).code).toBe('unsupported');
    expect((await host.run(Buffer.from('ab'), 'text', { signal: AbortSignal.abort() })).code).toBe('aborted');
    expect(spawned).toBe(0);
  });
});

describe('parser host: child failures map to fixed codes', () => {
  const cases = [
    ['exits non-zero', 'process.exit(3);', 'doc_crashed'],
    ['aborts natively (process.abort)', 'process.abort();', 'doc_crashed'],
    ['is killed by a signal', "process.kill(process.pid, 'SIGKILL');", 'doc_crashed'],
    ['writes nothing and exits 0', 'process.exit(0);', 'doc_crashed'],
    ['writes text that is not JSON', "console.log('not json');", 'doc_crashed'],
    ['writes two result lines', `console.log(${JSON.stringify(OK_TEXT('a'))});console.log(${JSON.stringify(OK_TEXT('b'))});`, 'doc_crashed'],
    ['writes a result with the wrong shape', "console.log(JSON.stringify({ok:true,kind:'pdf',pages:[{page:1,text:'x'}],meta:{}}));", 'doc_crashed'],
    ['reports an unknown failure code', "console.log(JSON.stringify({ok:false,code:'weird',message:'x'}));", 'doc_crashed'],
    ['writes a valid result but exits non-zero', `console.log(${JSON.stringify(OK_TEXT('late crash'))});process.exitCode=1;`, 'doc_crashed'],
  ];
  it.each(cases)('child %s -> %s', async (_name, script, code) => {
    const seen = [];
    const host = createParserHost({ spawnSpec: fake(withInput(script)), onDiagnostic: (d) => seen.push(d) });
    const out = await host.run(TEXT_BYTES, 'text');
    expect(out).toEqual({ ok: false, code, message: MESSAGES[code] });
    expect(seen).toHaveLength(1);
    expect(seen[0].code).toBe(code);
  });

  it('stdout over the cap kills the child', async () => {
    const host = createParserHost({ maxStdoutBytes: 1000, spawnSpec: fake(withInput("process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000);")) });
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('doc_crashed');
  });

  it('stderr is captured up to its cap for diagnostics only, never returned', async () => {
    const seen = [];
    const host = createParserHost({
      maxStderrBytes: 100,
      spawnSpec: fake(withInput("console.error('SECRET-STDERR '.repeat(1000));process.exit(1);")),
      onDiagnostic: (d) => seen.push(d),
    });
    const out = await host.run(TEXT_BYTES, 'text');
    expect(JSON.stringify(out)).not.toContain('SECRET-STDERR');
    expect(seen[0].stderr.length).toBeLessThanOrEqual(100);
    expect(seen[0].stderr).toContain('SECRET-STDERR');
  });

  it('a command that cannot be started is doc_unavailable', async () => {
    const host = createParserHost({ spawnSpec: () => ({ command: path.join(tmp, 'no-such-binary.exe'), args: [] }) });
    expect(await host.run(TEXT_BYTES, 'text')).toEqual({ ok: false, code: 'doc_unavailable', message: MESSAGES.doc_unavailable });
    const throwing = createParserHost({
      spawnSpec: () => {
        throw new Error('boom');
      },
    });
    expect((await throwing.run(TEXT_BYTES, 'text')).code).toBe('doc_unavailable');
  });

  it('the timeout kills a hung child and answers doc_timeout (a separate code from doc_crashed)', async () => {
    const pidFile = path.join(tmp, 'pid');
    const host = createParserHost({ timeoutMs: 3000, spawnSpec: fake(hangScript(pidFile)) });
    const started = Date.now();
    const out = await host.run(TEXT_BYTES, 'text');
    expect(out).toEqual({ ok: false, code: 'doc_timeout', message: MESSAGES.doc_timeout });
    expect(Date.now() - started).toBeLessThan(15_000);
    const pid = readPid(pidFile)();
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid)).toBe(false);
    expect(host.busy()).toBe(false);
  });
});

describe('parser host: single slot, queue and abort', () => {
  it('runs one child at a time, in first-in first-out order', async () => {
    const host = createParserHost({
      spawnSpec: fake(
        withInput(
          `const s=Date.now();setTimeout(()=>{process.stdout.write(JSON.stringify({ok:true,kind:'text',pages:[{page:null,text:s+'-'+Date.now()}],meta:{pageCount:null,paginated:false,truncated:false}})+'\\n');},150);`,
        ),
      ),
    });
    const order = [];
    const jobs = [0, 1, 2, 3].map((i) => host.run(TEXT_BYTES, 'text').then((r) => (order.push(i), r)));
    expect(host.queued()).toBe(3);
    const results = await Promise.all(jobs);
    expect(order).toEqual([0, 1, 2, 3]);
    const spans = results.map((r) => r.pages[0].text.split('-').map(Number));
    for (let i = 1; i < spans.length; i += 1) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    expect(host.queued()).toBe(0);
    expect(host.busy()).toBe(false);
  });

  it('answers doc_busy when the queue is full', async () => {
    const pidFile = path.join(tmp, 'pid');
    const host = createParserHost({ maxQueued: 1, timeoutMs: 20_000, spawnSpec: fake(hangScript(pidFile)) });
    const a = new AbortController();
    const b = new AbortController();
    const running = host.run(TEXT_BYTES, 'text', { signal: a.signal });
    const waiting = host.run(TEXT_BYTES, 'text', { signal: b.signal });
    expect(host.queued()).toBe(1);
    expect(await host.run(TEXT_BYTES, 'text')).toEqual({ ok: false, code: 'doc_busy', message: MESSAGES.doc_busy });
    b.abort();
    a.abort();
    expect((await waiting).code).toBe('aborted');
    expect((await running).code).toBe('aborted');
  });

  it('aborting the in-flight job kills the child; the next queued job then runs', async () => {
    const pidFile = path.join(tmp, 'pid');
    let n = 0;
    const host = createParserHost({
      spawnSpec: () => {
        n += 1;
        return n === 1 ? fake(hangScript(pidFile))() : fake(withInput(`process.stdout.write(${JSON.stringify(OK_TEXT('second'))}+'\\n');`))();
      },
    });
    const ctl = new AbortController();
    const first = host.run(TEXT_BYTES, 'text', { signal: ctl.signal });
    const second = host.run(TEXT_BYTES, 'text');
    const pid = await waitFor(readPid(pidFile));
    ctl.abort();
    expect(await first).toEqual({ ok: false, code: 'aborted', message: MESSAGES.aborted });
    expect(alive(pid)).toBe(false);
    expect((await second).pages[0].text).toBe('second');
  });

  it('aborting a queued job removes it without ever starting a child for it', async () => {
    const pidFile = path.join(tmp, 'pid');
    let spawned = 0;
    const host = createParserHost({
      spawnSpec: () => {
        spawned += 1;
        return fake(hangScript(pidFile))();
      },
    });
    const run = new AbortController();
    const queued = new AbortController();
    const first = host.run(TEXT_BYTES, 'text', { signal: run.signal });
    const second = host.run(TEXT_BYTES, 'text', { signal: queued.signal });
    expect(host.queued()).toBe(1);
    queued.abort();
    expect((await second).code).toBe('aborted');
    expect(host.queued()).toBe(0);
    run.abort();
    expect((await first).code).toBe('aborted');
    expect(spawned).toBe(1);
  });

  it('a signal that is already aborted never queues', async () => {
    const host = createParserHost({ spawnSpec: fake('') });
    expect((await host.run(TEXT_BYTES, 'text', { signal: AbortSignal.abort() })).code).toBe('aborted');
    expect(host.queued()).toBe(0);
    expect(host.busy()).toBe(false);
  });
});

describe('validateChildResult', () => {
  const pdfOk = {
    ok: true,
    kind: 'pdf',
    pages: [{ page: 1, text: 'a', runs: [{ x: 1, y: 2, w: 3, h: 4, text: 'a' }], width: 612, height: 792, rotation: 0 }],
    meta: { pageCount: 1, paginated: true, truncated: false, producer: 'p', extra: 'dropped' },
  };
  it('accepts the contract and drops unknown fields', () => {
    const out = validateChildResult({ ...pdfOk, junk: 1 });
    expect(out).toEqual({ ...pdfOk, meta: { pageCount: 1, paginated: true, truncated: false, producer: 'p' } });
  });
  it.each([
    ['null', null],
    ['an array', []],
    ['a pdf page without runs', { ...pdfOk, pages: [{ page: 1, text: 'a' }] }],
    ['a pdf run with NaN', { ...pdfOk, pages: [{ page: 1, text: 'a', runs: [{ x: NaN, y: 2, w: 3, h: 4, text: 'a' }] }] }],
    ['page 0', { ...pdfOk, pages: [{ page: 0, text: 'a', runs: [] }] }],
    ['a docx result with a page number', { ok: true, kind: 'docx', pages: [{ page: 1, text: 'a' }], meta: { pageCount: null, paginated: false, truncated: false } }],
    ['a docx marked paginated', { ok: true, kind: 'docx', pages: [{ page: null, text: 'a' }], meta: { pageCount: null, paginated: true, truncated: false } }],
    ['two docx pages', { ok: true, kind: 'docx', pages: [{ page: null, text: 'a' }, { page: null, text: 'b' }], meta: { pageCount: null, paginated: false, truncated: false } }],
    ['an unknown kind', { ...pdfOk, kind: 'exe' }],
    ['no pages', { ...pdfOk, pages: [] }],
  ])('rejects %s', (_name, value) => {
    expect(validateChildResult(value)).toBeNull();
  });
});

/** A child whose pipes are in-memory streams. `kill` is a stub; 'close' is emitted only when the test says so. */
function fakeChild({ answer } = {}) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.finish = (exitCode = 0) => {
    if (answer) child.stdout.write(`${answer}\n`);
    child.emit('close', exitCode, null);
  };
  return child;
}

const UNUSED_SPEC = () => ({ command: 'unused', args: [] });

describe('kill grace (M1): a child that never closes does not hold the slot', () => {
  it('a timeout answers doc_timeout after the grace period, destroys the pipes and frees the slot', async () => {
    const hung = fakeChild();
    const diagnostics = [];
    let spawned = 0;
    const host = createParserHost({
      timeoutMs: 20,
      killGraceMs: 30,
      onDiagnostic: (d) => diagnostics.push(d.code),
      spawn: () => {
        spawned += 1;
        if (spawned === 1) return hung;
        const ok = fakeChild({ answer: OK_TEXT('second') });
        queueMicrotask(() => ok.finish(0));
        return ok;
      },
      spawnSpec: UNUSED_SPEC,
    });
    const first = await host.run(TEXT_BYTES, 'text');
    expect(first).toEqual({ ok: false, code: 'doc_timeout', message: MESSAGES.doc_timeout });
    expect(hung.kill).toHaveBeenCalledWith('SIGKILL');
    expect([hung.stdin.destroyed, hung.stdout.destroyed, hung.stderr.destroyed]).toEqual([true, true, true]);
    expect(host.busy()).toBe(false);
    expect(diagnostics).toEqual(['doc_timeout']);
    // The next job runs normally: no doc_busy, no stuck slot.
    expect(await host.run(TEXT_BYTES, 'text')).toMatchObject({ ok: true, pages: [{ text: 'second' }] });
    // A late close of the abandoned child changes nothing and reports nothing more.
    hung.emit('close', null, 'SIGKILL');
    expect(diagnostics).toEqual(['doc_timeout']);
  });

  it('the grace timer is cleared when close arrives in time', async () => {
    const child = fakeChild();
    child.kill = vi.fn(() => setTimeout(() => child.emit('close', null, 'SIGKILL'), 5));
    const diagnostics = [];
    const host = createParserHost({
      timeoutMs: 20,
      killGraceMs: 60,
      onDiagnostic: (d) => diagnostics.push(d.code),
      spawn: () => child,
      spawnSpec: UNUSED_SPEC,
    });
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('doc_timeout');
    await new Promise((r) => setTimeout(r, 120)); // past the grace period: the cleared timer must not report again
    expect(diagnostics).toEqual(['doc_timeout']);
    expect(child.stdout.destroyed).toBe(false);
  });

  it('an abort of a child that never closes answers aborted after the grace period', async () => {
    const hung = fakeChild();
    const host = createParserHost({ killGraceMs: 30, spawn: () => hung, spawnSpec: UNUSED_SPEC });
    const ac = new AbortController();
    const pending = host.run(TEXT_BYTES, 'text', { signal: ac.signal });
    ac.abort();
    expect((await pending).code).toBe('aborted');
    expect(host.busy()).toBe(false);
  });

  it('a kill that throws still frees the slot after the grace period', async () => {
    const hung = fakeChild();
    hung.kill = vi.fn(() => {
      throw new Error('EPERM');
    });
    const host = createParserHost({ timeoutMs: 20, killGraceMs: 30, spawn: () => hung, spawnSpec: UNUSED_SPEC });
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('doc_timeout');
    expect(host.busy()).toBe(false);
  });

  it('the default grace period is 5 seconds', () => {
    expect(LIMITS.killGraceMs).toBe(5000);
  });
});

describe('diagnostics (L1, L2) and spawn options (L4)', () => {
  it('a spawn failure reports one doc_unavailable diagnostic and no second doc_crashed', async () => {
    const diagnostics = [];
    const host = createParserHost({
      onDiagnostic: (d) => diagnostics.push(d.code),
      spawnSpec: () => ({ command: path.join(tmp, 'no-such-binary'), args: [] }),
    });
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('doc_unavailable');
    await new Promise((r) => setTimeout(r, 100)); // 'close' follows 'error' on a failed spawn
    expect(diagnostics).toEqual(['doc_unavailable']);
  });

  it('a throwing onDiagnostic hook neither escapes nor holds the slot', async () => {
    const host = createParserHost({
      onDiagnostic: () => {
        throw new Error('hook bug');
      },
      spawnSpec: fake('process.exit(3)'),
    });
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('doc_crashed');
    expect(host.busy()).toBe(false);
    expect((await host.run(TEXT_BYTES, 'text')).code).toBe('doc_crashed'); // still usable, no unhandled exception
  });

  it('the child starts in the folder of the running executable, not the parent cwd', async () => {
    let seen;
    const child = fakeChild({ answer: OK_TEXT('x') });
    const host = createParserHost({
      spawn: (_cmd, _args, options) => {
        seen = options;
        queueMicrotask(() => child.finish(0));
        return child;
      },
      spawnSpec: UNUSED_SPEC,
    });
    await host.run(TEXT_BYTES, 'text');
    expect(seen.cwd).toBe(path.dirname(process.execPath));
    expect(seen.stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });
});

describe('validateChildResult: stricter checks (L6)', () => {
  const run = { x: 1, y: 2, w: 3, h: 4, text: 'a' };
  const pdf = (over = {}, metaOver = {}) => ({
    ok: true,
    kind: 'pdf',
    pages: [{ page: 1, text: 'a', runs: [run], width: 612, height: 792, rotation: 0, ...over }],
    meta: { pageCount: 1, paginated: true, truncated: false, ...metaOver },
  });
  const docx = (page, metaOver = {}) => ({
    ok: true,
    kind: 'docx',
    pages: [{ page: null, ...page }],
    meta: { pageCount: null, paginated: false, truncated: false, ...metaOver },
  });

  it.each([
    ['a pdf with a fractional pageCount', pdf({}, { pageCount: 1.5 })],
    ['a pdf with fewer pageCount than pages', pdf({}, { pageCount: 0 })],
    ['a pdf with a null pageCount', pdf({}, { pageCount: null })],
    ['a docx with a pageCount', docx({ text: 'a' }, { pageCount: 1 })],
    ['a docx paragraph ending past the text', docx({ text: 'abc', paragraphs: [{ index: 0, start: 0, end: 4 }] })],
    ['a docx paragraph starting after its end', docx({ text: 'abc', paragraphs: [{ index: 0, start: 2, end: 1 }] })],
    ['a docx paragraph with a negative start', docx({ text: 'abc', paragraphs: [{ index: 0, start: -1, end: 2 }] })],
    ['more characters than the cap', docx({ text: 'x'.repeat(LIMITS.maxChars + 1) })],
    ['more runs than the cap', pdf({ runs: Array.from({ length: LIMITS.maxRuns + 1 }, () => run) })],
  ])('rejects %s', (_name, value) => {
    expect(validateChildResult(value)).toBeNull();
  });

  it('accepts a docx paragraph that ends exactly at the text length and a text at the cap', () => {
    expect(validateChildResult(docx({ text: 'abc', paragraphs: [{ index: 0, start: 0, end: 3 }] }))).not.toBeNull();
    expect(validateChildResult(docx({ text: 'x'.repeat(LIMITS.maxChars) }))).not.toBeNull();
  });
});
