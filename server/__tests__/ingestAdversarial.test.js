// Adversarial pass over the ingest contract (docs/INGEST.md): the real child's frame handling, host slot and
// output hygiene against fake children, parser edge cases, and the privacy invariant. Documents are generated here.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Unzip, UnzipInflate, strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, MESSAGES, parseDocument, sniffKind } from '../ingest/index.js';
import { parseDocx } from '../ingest/docx.js';
import { parsePdf } from '../ingest/pdf.js';
import { parseText } from '../ingest/text.js';
import { createParserHost } from '../ingest/parserHost.js';
import { SAMPLE_PAGES, makeDocx, makePdf } from './helpers/ingestDocs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = path.join(ROOT, 'server', 'entry.js');
const FIXED_MESSAGES = Object.values(MESSAGES);

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-adv-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const fake = (script) => () => ({ command: process.execPath, args: ['-e', script] });
const TEXT = Buffer.from('hello');
const OK_TEXT = (text) => JSON.stringify({ ok: true, kind: 'text', pages: [{ page: null, text }], meta: { pageCount: null, paginated: false, truncated: false } });
const withInput = (body) => `const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{const input=Buffer.concat(c);${body}});`;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (check, ms = 15_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
};
const readPid = (file) => () => (fs.existsSync(file) && fs.readFileSync(file, 'utf8') ? Number(fs.readFileSync(file, 'utf8')) : 0);
const hang = (file) => `require('fs').writeFileSync(${JSON.stringify(file)}, String(process.pid));setInterval(()=>{},1000);`;

describe('real child: every bad frame ends in one parse_failed line and exit 0', () => {
  const header = (obj) => Buffer.from(`${JSON.stringify(obj)}\n`);
  const padded = (bytesBeforeNewline, obj) => {
    const json = JSON.stringify(obj);
    return Buffer.from(`${json}${' '.repeat(bytesBeforeNewline - json.length)}\n`);
  };
  const run = (input) => spawnSync(process.execPath, [ENTRY, '--role', 'parser'], { input, env: {}, timeout: 60_000, windowsHide: true });
  const expectParseFailed = (r) => {
    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    const lines = r.stdout.toString().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ ok: false, code: 'parse_failed' });
    expect(r.stderr.toString()).toBe('');
  };

  it.each([
    ['a header over 256 bytes (newline present)', () => Buffer.concat([padded(LIMITS.maxHeaderBytes + 1, { v: 1, kind: 'text', bytes: 3 }), Buffer.from('abc')])],
    ['a header line of 1 MB with no newline', () => Buffer.alloc(1024 * 1024, 0x41)],
    ['malformed header JSON', () => Buffer.from('{"v":1,"kind":\n')],
    ['a header that is a JSON array', () => Buffer.from('[1,2,3]\n')],
    ['a header that is JSON null', () => Buffer.from('null\n')],
    ['bytes given as a string', () => Buffer.concat([header({ v: 1, kind: 'text', bytes: '3' }), Buffer.from('abc')])],
    ['an unknown kind', () => Buffer.concat([header({ v: 1, kind: 'exe', bytes: 3 }), Buffer.from('abc')])],
    ['a declared length above the input cap', () => Buffer.concat([header({ v: 1, kind: 'text', bytes: LIMITS.maxInputBytes + 1 }), Buffer.from('abc')])],
    ['a negative length', () => Buffer.concat([header({ v: 1, kind: 'text', bytes: -3 }), Buffer.from('abc')])],
    ['fewer bytes than declared (truncated stdin)', () => Buffer.concat([header({ v: 1, kind: 'text', bytes: 100 }), Buffer.from('abc')])],
    ['extra bytes after the payload', () => Buffer.concat([header({ v: 1, kind: 'text', bytes: 3 }), Buffer.from('abcXYZ')])],
    ['a stray newline after the payload', () => Buffer.concat([header({ v: 1, kind: 'text', bytes: 3 }), Buffer.from('abc\n')])],
    ['an empty stdin', () => Buffer.alloc(0)],
  ])('%s', (_name, build) => {
    expectParseFailed(run(build()));
  });

  it('header size boundary: exactly 256 bytes before the newline is accepted, 257 is not', () => {
    const body = Buffer.from('abc');
    const ok = run(Buffer.concat([padded(LIMITS.maxHeaderBytes, { v: 1, kind: 'text', bytes: 3 }), body]));
    expect(JSON.parse(ok.stdout.toString())).toMatchObject({ ok: true, kind: 'text', pages: [{ text: 'abc' }] });
    expectParseFailed(run(Buffer.concat([padded(LIMITS.maxHeaderBytes + 1, { v: 1, kind: 'text', bytes: 3 }), body])));
  });

  it('a valid frame whose payload is not the declared kind answers a content code, not a crash', () => {
    const r = run(Buffer.concat([header({ v: 1, kind: 'pdf', bytes: 9 }), Buffer.from('not a pdf')]));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual({ ok: false, code: 'parse_failed' });
  }, 60_000);
});

describe('host: slots, output and stdin hygiene', () => {
  it('the slot is released after a crash, a timeout and an abort: the next job succeeds', async () => {
    const pidFile = path.join(tmp, 'pid');
    const behaviours = [withInput('process.exit(7);'), hang(pidFile), hang(pidFile), withInput(`process.stdout.write(${JSON.stringify(OK_TEXT('after'))}+'\\n');`)];
    let n = 0;
    const host = createParserHost({ timeoutMs: 2500, spawnSpec: () => fake(behaviours[n++])() });
    expect((await host.run(TEXT, 'text')).code).toBe('doc_crashed');
    expect(host.busy()).toBe(false);
    expect((await host.run(TEXT, 'text')).code).toBe('doc_timeout');
    expect(host.busy()).toBe(false);
    fs.rmSync(pidFile, { force: true });
    const ctl = new AbortController();
    const aborted = host.run(TEXT, 'text', { signal: ctl.signal });
    await waitFor(readPid(pidFile));
    ctl.abort();
    expect((await aborted).code).toBe('aborted');
    expect(host.busy()).toBe(false);
    expect((await host.run(TEXT, 'text')).pages[0].text).toBe('after');
  }, 60_000);

  it('stdout past the cap is killed (not left running) and mapped to doc_crashed', async () => {
    const pidFile = path.join(tmp, 'pid');
    const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));const big='x'.repeat(65536);setInterval(()=>{process.stdout.write(big)},1);`;
    const host = createParserHost({ maxStdoutBytes: 100_000, spawnSpec: fake(script) });
    const out = await host.run(TEXT, 'text');
    expect(out).toEqual({ ok: false, code: 'doc_crashed', message: MESSAGES.doc_crashed });
    expect(alive(readPid(pidFile)())).toBe(false);
    expect(host.busy()).toBe(false);
  }, 60_000);

  it('stderr never appears in a successful result either', async () => {
    const host = createParserHost({
      spawnSpec: fake(withInput(`console.error('STDERR-CANARY');process.stdout.write(${JSON.stringify(OK_TEXT('fine'))}+'\\n');`)),
    });
    const out = await host.run(TEXT, 'text');
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out)).not.toContain('STDERR-CANARY');
  });

  it('a child that never reads stdin and exits at once does not crash the host (EPIPE) on a large input', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const host = createParserHost({ spawnSpec: fake('process.exit(0);') });
    expect((await host.run(big, 'text')).code).toBe('doc_crashed');
    expect(host.busy()).toBe(false);
  }, 60_000);

  it('a child that answers without reading its stdin still gives its valid answer', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const host = createParserHost({ spawnSpec: fake(`process.stdout.write(${JSON.stringify(OK_TEXT('early'))}+'\\n',()=>process.exit(0));`) });
    const out = await host.run(big, 'text');
    expect(out).toMatchObject({ ok: true, kind: 'text', pages: [{ text: 'early' }] });
  }, 60_000);

  const tooManyPages = JSON.stringify({
    ok: true,
    kind: 'pdf',
    pages: Array.from({ length: LIMITS.maxPages + 1 }, (_, i) => ({ page: i + 1, text: 'a', runs: [] })),
    meta: { pageCount: LIMITS.maxPages + 1, paginated: true, truncated: false },
  });
  it.each([
    ['a result that is a JSON string', JSON.stringify('ok')],
    ['a result that is a JSON array', '[]'],
    ['a pdf run with a string coordinate', JSON.stringify({ ok: true, kind: 'pdf', pages: [{ page: 1, text: 'a', runs: [{ x: '1', y: 2, w: 3, h: 4, text: 'a' }] }], meta: { pageCount: 1, paginated: true, truncated: false } })],
    ['more pages than the cap', tooManyPages],
    ['a failure with a host-only code', JSON.stringify({ ok: false, code: 'doc_timeout', message: 'x' })],
  ])('exit 0 with %s is doc_crashed', async (_name, line) => {
    const host = createParserHost({ spawnSpec: fake(withInput(`process.stdout.write(${JSON.stringify(line)}+'\\n');`)) });
    expect(await host.run(TEXT, 'text')).toEqual({ ok: false, code: 'doc_crashed', message: MESSAGES.doc_crashed });
  });

  it('unknown fields in a valid answer are dropped', async () => {
    const line = JSON.stringify({ ...JSON.parse(OK_TEXT('t')), leak: 'C:\\secret', meta: { pageCount: null, paginated: false, truncated: false, extra: 'x' } });
    const host = createParserHost({ spawnSpec: fake(withInput(`process.stdout.write(${JSON.stringify(line)}+'\\n');`)) });
    const out = await host.run(TEXT, 'text');
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/secret|extra|leak/);
  });
});

describe('parsers: caps and edge cases', () => {
  it('a bomb that LIES about its size (local header says 100 bytes) is still refused by counting inflated bytes', async () => {
    const honest = Buffer.from(zipSync({ 'word/document.xml': new Uint8Array(LIMITS.docxMaxEntryBytes + 4096) }));
    const bomb = Buffer.from(honest);
    bomb.writeUInt32LE(100, 22); // fflate keeps the uncompressed size at offset 22 of the local header
    // Sanity: the lie is what a streaming reader sees.
    let declared = null;
    const probe = new Unzip((f) => {
      declared = f.originalSize;
    });
    probe.register(UnzipInflate);
    probe.push(bomb.subarray(0, 1024), false);
    expect(declared).toBe(100);
    expect(bomb.length).toBeLessThan(200_000);
    expect(parseDocx(bomb)).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('entries that each stay under the per-entry cap but together pass the total cap are refused', () => {
    const each = Math.floor(LIMITS.docxMaxEntryBytes * 0.75);
    expect(each * 3).toBeGreaterThan(LIMITS.docxMaxTotalBytes);
    const zip = zipSync({
      'word/document.xml': new Uint8Array(each),
      'word/header1.xml': new Uint8Array(each),
      'word/footer1.xml': new Uint8Array(each),
    });
    expect(parseDocx(zip)).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('a huge entry that is not a wanted part is never inflated (an image bomb is harmless)', () => {
    const zip = makeDocx(['kept'], { extraEntries: { 'word/media/image1.png': new Uint8Array(LIMITS.docxMaxEntryBytes * 2) } });
    expect(parseDocx(zip)).toMatchObject({ ok: true, pages: [{ text: 'kept' }] });
  });

  it('a zip that is not a DOCX is "unsupported" from parseDocument and never starts a child', async () => {
    let calls = 0;
    const host = {
      run: async () => {
        calls += 1;
        return null;
      },
    };
    const plainZip = zipSync({ 'notes.txt': strToU8('hello'), 'data/a.csv': strToU8('1,2') });
    expect(sniffKind(plainZip)).toBeNull();
    expect(await parseDocument(plainZip, { host })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(await parseDocument(plainZip, { kind: 'docx', host })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(calls).toBe(0);
  });

  it('a zip that only mentions word/document.xml passes the sniff, then the parser answers parse_failed', () => {
    const decoy = Buffer.from(zipSync({ 'readme.txt': [strToU8('see word/document.xml'), { level: 0 }] }));
    expect(sniffKind(decoy)).toBe('docx');
    expect(parseDocx(decoy)).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('a PDF whose only text is whitespace is "empty"', async () => {
    const out = await parsePdf(makePdf([{ runs: [{ x: 72, y: 700, text: '   ' }, { x: 72, y: 680, text: ' ' }] }]));
    expect(out).toEqual({ ok: false, code: 'empty' });
  });

  it('a PDF where only one page has text keeps both pages, numbered', async () => {
    const out = await parsePdf(makePdf([{ runs: [] }, { runs: [{ x: 72, y: 700, text: 'only page two' }] }]));
    expect(out.ok).toBe(true);
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.pages[0].text).toBe('');
    expect(out.pages[1].text).toBe('only page two');
  });

  it('text: a BOM alone is "empty"; UTF-16 and broken UTF-8 are "unsupported"', () => {
    expect(parseText(Buffer.from([0xef, 0xbb, 0xbf]))).toEqual({ ok: false, code: 'empty' });
    expect(parseText(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toEqual({ ok: false, code: 'unsupported' });
    expect(parseText(Buffer.from([0xc3, 0x28]))).toEqual({ ok: false, code: 'unsupported' });
    expect(parseText(Buffer.from('\u00e9\u00e9\u00e9').subarray(0, 5))).toEqual({ ok: false, code: 'unsupported' });
  });

  it('text: the leading BOM is dropped, an inner U+FEFF is kept, a lone CR becomes a newline', () => {
    expect(parseText(Buffer.from('\uFEFFa\uFEFFb\rc')).pages[0].text).toBe('a\uFEFFb\nc');
  });

  it('text with a NUL byte or binary data is "unsupported" before any child starts', async () => {
    let calls = 0;
    const host = {
      run: async () => {
        calls += 1;
        return null;
      },
    };
    expect(await parseDocument(Buffer.from('abc\u0000def'), { kind: 'text', host })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(await parseDocument(Buffer.from([0xff, 0xfe, 0x00, 0x80]), { host })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(calls).toBe(0);
  });

  it('text: output over the character cap is cut on a code point boundary and flagged', () => {
    const out = parseText(Buffer.from('\u{1F600}'.repeat(LIMITS.maxChars / 2 + 10)));
    expect(out.meta.truncated).toBe(true);
    const text = out.pages[0].text;
    expect(text.length).toBeLessThanOrEqual(LIMITS.maxChars);
    const last = text.charCodeAt(text.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });
});

describe('privacy: library error text never reaches a result', () => {
  it('a malformed PDF header plus garbage yields a fixed message and none of the garbage', async () => {
    const marker = 'SECRET-DOC-CONTENT-4711';
    const out = await parseDocument(Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R /${marker} >>\n${marker}\n`));
    expect(out.ok).toBe(false);
    expect(FIXED_MESSAGES).toContain(out.message);
    expect(JSON.stringify(out)).not.toContain(marker);
    expect(Object.keys(out).sort()).toEqual(['code', 'message', 'ok']);
  }, 60_000);

  it('a corrupt DOCX and a truncated real PDF also answer with fixed messages only', async () => {
    const results = [
      await parseDocument(Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('word/document.xml SECRET-ZIP-7')]), { kind: 'docx' }),
      await parseDocument(makePdf(SAMPLE_PAGES).subarray(0, 300), { kind: 'pdf' }),
    ];
    for (const out of results) {
      expect(out.ok).toBe(false);
      expect(FIXED_MESSAGES).toContain(out.message);
      expect(JSON.stringify(out)).not.toContain('SECRET-ZIP');
    }
  }, 60_000);
});
