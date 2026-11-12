// Format parsers (server/ingest/pdf.js, docx.js, text.js) and the job frame reader, called in-process, plus
// kind sniffing in index.js. Documents are generated here (helpers/ingestDocs.js): no fixture files.
import { PassThrough } from 'node:stream';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../ingest/limits.js';
import { fitPage, parsePdf, readItems } from '../ingest/pdf.js';
import { parseDocx, wordXmlToParagraphs } from '../ingest/docx.js';
import { parseText } from '../ingest/text.js';
import { readJob } from '../ingest/parserChild.js';
import { sniffKind, supportedKinds } from '../ingest/index.js';
import { SAMPLE_PAGES, makeDocx, makePdf } from './helpers/ingestDocs.js';

const near = (actual, expected, tol = 0.5) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('parsePdf', () => {
  it('returns page text and runs with positions in PDF user space (origin bottom-left, y up)', async () => {
    const out = await parsePdf(makePdf(SAMPLE_PAGES, { title: 'Panel' }));
    expect(out.ok).toBe(true);
    expect(out.kind).toBe('pdf');
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.meta).toMatchObject({ pageCount: 2, paginated: true, truncated: false, title: 'Panel', producer: 'ingest-test' });
    const [p1, p2] = out.pages;
    expect(p1.text).toContain('Glucose');
    expect(p1.text).toContain('mg/dL');
    expect(p2.text).toBe('Second page text');
    expect(p1.runs.map((r) => r.text)).toEqual(['Panel Report', 'Glucose', '92', 'mg/dL']);
    // x and y are the baseline origin the PDF placed the run at; h is the font size; w the measured advance.
    const expected = [
      [72, 720, 14],
      [72, 700, 10],
      [220, 700, 10],
      [300, 700, 10],
    ];
    p1.runs.forEach((run, i) => {
      near(run.x, expected[i][0]);
      near(run.y, expected[i][1]);
      near(run.h, expected[i][2]);
      expect(run.w).toBeGreaterThan(0);
    });
    // Helvetica "Glucose" at 10 pt is about 36.7 pt wide: w is in the same units as x.
    near(p1.runs[1].w, 36.68, 1);
    // The row of a lab table is rebuilt from y: the three runs on y=700 share it, and x orders them.
    const row = p1.runs.filter((r) => Math.abs(r.y - 700) < 1).sort((a, b) => a.x - b.x);
    expect(row.map((r) => r.text)).toEqual(['Glucose', '92', 'mg/dL']);
    near(p2.runs[0].x, 100);
    near(p2.runs[0].y, 500);
    expect([p1.width, p1.height, p1.rotation]).toEqual([612, 792, 0]);
  });

  it('reports the page size of a non-letter page', async () => {
    const out = await parsePdf(makePdf([{ runs: [{ x: 10, y: 20, text: 'tiny' }] }], { width: 300, height: 400 }));
    expect([out.pages[0].width, out.pages[0].height]).toEqual([300, 400]);
  });

  it('stops at the page cap and says so', async () => {
    const pages = Array.from({ length: LIMITS.maxPages + 2 }, (_, i) => ({ runs: [{ x: 72, y: 700, text: `P${i + 1}` }] }));
    const out = await parsePdf(makePdf(pages));
    expect(out.pages).toHaveLength(LIMITS.maxPages);
    expect(out.meta).toMatchObject({ pageCount: LIMITS.maxPages + 2, truncated: true });
  }, 60_000);

  it('a PDF with no text is "empty" (a scan needs OCR, which this module does not do)', async () => {
    expect(await parsePdf(makePdf([{ runs: [] }]))).toEqual({ ok: false, code: 'empty' });
  });

  it('an encrypted PDF is "encrypted"', async () => {
    expect(await parsePdf(makePdf(SAMPLE_PAGES, { encrypted: true }))).toEqual({ ok: false, code: 'encrypted' });
  });

  it.each([
    ['random bytes', Buffer.from('%PDF-1.4 this is not a pdf at all, just some words')],
    ['a truncated PDF', makePdf(SAMPLE_PAGES).subarray(0, 120)],
  ])('%s is "parse_failed" with no library text', async (_name, bytes) => {
    expect(await parsePdf(bytes)).toEqual({ ok: false, code: 'parse_failed' });
  });
});

describe('parseDocx', () => {
  it('returns one unpaginated page with paragraph offsets (page is null, never a page number)', () => {
    const out = parseDocx(makeDocx(['Fish & chips', '', 'Second <paragraph>'], { header: 'Head', footer: 'Foot' }));
    expect(out.ok).toBe(true);
    expect(out.kind).toBe('docx');
    expect(out.meta).toEqual({ pageCount: null, paginated: false, truncated: false });
    expect(out.pages).toHaveLength(1);
    const [page] = out.pages;
    expect(page.page).toBeNull();
    expect(page.runs).toBeUndefined();
    expect(page.text).toBe('Fish & chips\n\nSecond <paragraph>\nFoot\nHead');
    for (const p of page.paragraphs) expect(page.text.slice(p.start, p.end)).toBe(page.text.split('\n')[p.index]);
    expect(page.paragraphs.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a zip without word/document.xml is "parse_failed"', () => {
    const bytes = zipSync({ 'readme.txt': strToU8('x') });
    expect(parseDocx(bytes)).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('a document with no text is "empty"', () => {
    expect(parseDocx(makeDocx(['', '  ']))).toEqual({ ok: false, code: 'empty' });
  });

  it('garbage that is not a zip is "parse_failed"', () => {
    expect(parseDocx(Buffer.from('PK\u0003\u0004 this is not a zip'))).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('refuses a zip bomb (an entry that inflates past the cap)', () => {
    const big = new Uint8Array(LIMITS.docxMaxEntryBytes + 1024);
    const bomb = zipSync({ 'word/document.xml': big, 'word/header1.xml': strToU8('<a/>') });
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(parseDocx(bomb)).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('refuses a zip with too many entries', () => {
    const files = { 'word/document.xml': strToU8('<w:p><w:t>x</w:t></w:p>') };
    for (let i = 0; i <= LIMITS.docxMaxEntries; i += 1) files[`pad/${i}.txt`] = new Uint8Array(0);
    expect(parseDocx(zipSync(files))).toEqual({ ok: false, code: 'parse_failed' });
  });

  it('wordXmlToParagraphs reads runs, tabs, breaks and decodes only the predefined entities', () => {
    const xml =
      '<w:body><w:p><w:r><w:t>Fish &amp; chips</w:t><w:tab/><w:t xml:space="preserve"> &lt;hot&gt; &#65;&#x42; &bogus;</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Line</w:t><w:br/><w:t>two</w:t><w:delText>gone</w:delText></w:r></w:p></w:body><!DOCTYPE x [<!ENTITY a "b">]>';
    expect(wordXmlToParagraphs(xml, 10_000)).toEqual(['Fish & chips\t <hot> AB &bogus;', 'Line\ntwo']);
  });
});

describe('parseText', () => {
  it('decodes UTF-8, drops the BOM, normalizes line ends and reports no page', () => {
    const out = parseText(Buffer.from('﻿café\r\nline two\rthree\u0000'));
    expect(out).toEqual({ ok: true, kind: 'text', pages: [{ page: null, text: 'café\nline two\nthree' }], meta: { pageCount: null, paginated: false, truncated: false } });
  });
  it('invalid UTF-8 is "unsupported", blank text is "empty"', () => {
    expect(parseText(Buffer.from([0xff, 0xfe, 0xfd]))).toEqual({ ok: false, code: 'unsupported' });
    expect(parseText(Buffer.from('  \n '))).toEqual({ ok: false, code: 'empty' });
  });
});

describe('sniffKind', () => {
  it('knows the three kinds by their bytes', () => {
    expect(supportedKinds()).toEqual(['pdf', 'docx', 'text']);
    expect(sniffKind(makePdf(SAMPLE_PAGES))).toBe('pdf');
    expect(sniffKind(makeDocx(['x']))).toBe('docx');
    expect(sniffKind(Buffer.from('just words\n'))).toBe('text');
  });
  it('rejects a plain zip, binary data and a lone ZIP magic', () => {
    expect(sniffKind(zipSync({ 'a.txt': strToU8('x') }))).toBeNull();
    expect(sniffKind(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull();
    expect(sniffKind(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBeNull();
  });
});

describe('readJob (stdin frame)', () => {
  const frame = (header, body = Buffer.alloc(0)) => Buffer.concat([Buffer.from(`${typeof header === 'string' ? header : JSON.stringify(header)}\n`), body]);
  const feed = async (chunks) => {
    const stdin = new PassThrough();
    const job = readJob(stdin);
    for (const c of chunks) stdin.write(c);
    stdin.end();
    return job;
  };

  it('reads a header line and exactly the declared bytes, even when split across chunks', async () => {
    const body = Buffer.from('0123456789');
    const all = frame({ v: 1, kind: 'text', bytes: 10 }, body);
    const job = await feed([all.subarray(0, 7), all.subarray(7, 30), all.subarray(30)]);
    expect(job.kind).toBe('text');
    expect(job.bytes.toString()).toBe('0123456789');
  });

  it.each([
    ['not JSON', frame('nope', Buffer.from('x'))],
    ['an unknown kind', frame({ v: 1, kind: 'exe', bytes: 1 }, Buffer.from('x'))],
    ['a wrong version', frame({ v: 2, kind: 'text', bytes: 1 }, Buffer.from('x'))],
    ['zero bytes', frame({ v: 1, kind: 'text', bytes: 0 })],
    ['a size over the input cap', frame({ v: 1, kind: 'text', bytes: LIMITS.maxInputBytes + 1 }, Buffer.from('x'))],
    ['a fractional size', frame({ v: 1, kind: 'text', bytes: 1.5 }, Buffer.from('xx'))],
    ['fewer bytes than declared', frame({ v: 1, kind: 'text', bytes: 5 }, Buffer.from('abc'))],
    ['more bytes than declared', frame({ v: 1, kind: 'text', bytes: 2 }, Buffer.from('abcdef'))],
    ['no header line at all', Buffer.from('x'.repeat(LIMITS.maxHeaderBytes + 50))],
    ['an empty stream', Buffer.alloc(0)],
  ])('answers null for %s', async (_name, data) => {
    expect(await feed(data.length ? [data] : [])).toBeNull();
  });
});

describe('PDF coordinates relative to the visible page box (M3)', () => {
  const runAt = (out, text) => out.pages[0].runs.find((r) => r.text === text);

  it('a MediaBox that starts at 36,36 gives runs relative to its corner and width/height of the box', async () => {
    const out = await parsePdf(makePdf([{ runs: [{ x: 136, y: 236, size: 12, text: 'Anchor' }] }], { mediaBox: [36, 36, 576, 756] }));
    expect([out.pages[0].width, out.pages[0].height]).toEqual([540, 720]);
    near(runAt(out, 'Anchor').x, 100);
    near(runAt(out, 'Anchor').y, 200);
  });

  it('a CropBox inside the MediaBox is the visible box', async () => {
    const out = await parsePdf(
      makePdf([{ runs: [{ x: 150, y: 300, size: 12, text: 'Cropped' }] }], { mediaBox: [0, 0, 612, 792], cropBox: [50, 100, 450, 700] }),
    );
    expect([out.pages[0].width, out.pages[0].height]).toEqual([400, 600]);
    near(runAt(out, 'Cropped').x, 100);
    near(runAt(out, 'Cropped').y, 200);
  });

  it('a page box at the origin leaves coordinates unchanged', async () => {
    const out = await parsePdf(makePdf([{ runs: [{ x: 72, y: 700, text: 'Home' }] }]));
    near(runAt(out, 'Home').x, 72);
    near(runAt(out, 'Home').y, 700);
  });
});

describe('PDF run caps (L5)', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ str: `r${i}`, transform: [1, 0, 0, 10, 5, 5], width: 4, height: 10, hasEOL: false }));
  const VIEW = [0, 0, 612, 792];

  it('a run budget that is met exactly drops nothing', () => {
    const read = readItems(items(3), 3, VIEW);
    expect([read.runs.length, read.runsDropped]).toEqual([3, false]);
  });

  it('one run over the budget is a real drop', () => {
    const read = readItems(items(4), 3, VIEW);
    expect([read.runs.length, read.runsDropped]).toEqual([3, true]);
  });

  it('subtracts the page box origin from run positions', () => {
    const read = readItems(items(1), 5, [2, 3, 612, 792]);
    expect([read.runs[0].x, read.runs[0].y]).toEqual([3, 2]);
  });

  it('a character cap that cuts a page drops the runs it removed and reports truncation', () => {
    const read = readItems(
      [
        { str: 'alpha', transform: [1, 0, 0, 10, 5, 5], width: 4, height: 10, hasEOL: true },
        { str: 'beta', transform: [1, 0, 0, 10, 5, 20], width: 4, height: 10, hasEOL: false },
        { str: 'gamma', transform: [1, 0, 0, 10, 5, 35], width: 4, height: 10, hasEOL: false },
      ],
      10,
      VIEW,
    );
    expect(read.text).toBe('alpha\nbetagamma');
    const cutInsideBeta = fitPage(read, 8);
    expect(cutInsideBeta.text).toBe('alpha\nbe');
    expect(cutInsideBeta.runs.map((r) => r.text)).toEqual(['alpha']);
    expect(cutInsideBeta.truncated).toBe(true);
    const cutAfterBeta = fitPage(read, 10);
    expect(cutAfterBeta.runs.map((r) => r.text)).toEqual(['alpha', 'beta']);
    const fits = fitPage(read, 15);
    expect([fits.runs.length, fits.truncated]).toEqual([3, false]);
    expect(fitPage({ ...read, runsDropped: true }, 15).truncated).toBe(true);
  });
});

describe('DOCX paragraph over the character cap (M2)', () => {
  it('keeps the cut prefix of a first paragraph that alone exceeds the cap', () => {
    const out = parseDocx(makeDocx(['x'.repeat(LIMITS.maxChars + 500)]));
    expect(out.ok).toBe(true);
    expect(out.pages[0].text).toHaveLength(LIMITS.maxChars);
    expect(out.meta.truncated).toBe(true);
    expect(out.pages[0].paragraphs).toEqual([{ index: 0, start: 0, end: LIMITS.maxChars }]);
  }, 60_000);

  it('does not split a surrogate pair at the cut', () => {
    const emoji = '\u{1F600}'; // two UTF-16 units
    const out = parseDocx(makeDocx([emoji.repeat(Math.ceil(LIMITS.maxChars / 2) + 10)]));
    expect(out.ok).toBe(true);
    const text = out.pages[0].text;
    expect(text.length).toBeLessThanOrEqual(LIMITS.maxChars);
    const last = text.charCodeAt(text.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(out.meta.truncated).toBe(true);
  }, 60_000);

  it('a later paragraph over the cap keeps its prefix after the earlier ones', () => {
    const out = parseDocx(makeDocx(['first', 'y'.repeat(LIMITS.maxChars)]));
    expect(out.ok).toBe(true);
    expect(out.pages[0].text.startsWith('first\nyyy')).toBe(true);
    expect(out.pages[0].text.length).toBeLessThanOrEqual(LIMITS.maxChars);
    expect(out.pages[0].paragraphs).toHaveLength(2);
    expect(out.meta.truncated).toBe(true);
  }, 60_000);
});
