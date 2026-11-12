// Text PDF extraction with positions (pdf.js through unpdf). Runs inside the parser child only.
//
// Coordinates (docs/INGEST.md): pdf.js "user space", the PDF default coordinate system with the page's
// unrotated orientation. Units are PDF points (1/72 inch). The origin is the bottom-left, x grows right and
// y grows UP. Each text item has a transform [a, b, c, d, e, f]; (e, f) is the origin of the first glyph's
// baseline, so x = e - x0 and y = f - y0, where (x0, y0) is the bottom-left corner of the visible page box
// (page.view: the CropBox clipped to the MediaBox, so it need not start at 0,0). Runs are therefore relative to
// that corner and line up with `width` x `height`. h is the font height in user space (the vertical scale of the text matrix),
// w is the advance width pdf.js measured for the whole run. Rotated text keeps these definitions; pages with
// /Rotate report `rotation` and their runs are NOT rotated. Scanned pages have no text items (see "empty").
import { getDocument } from 'unpdf/pdfjs';
import { LIMITS } from './limits.js';
import { cleanText, cutAt, round2 } from './clean.js';

const METADATA_MAX = 200;
const cleanMeta = (v) => (typeof v === 'string' ? cleanText(v).trim().slice(0, METADATA_MAX) : '');

/**
 * Positioned runs of one page's text content, plus the page text (items joined, a newline where pdf.js saw a line
 * end). `ends[i]` is where run i ends in the page text, so a character cut can drop the runs it removed.
 * `runsDropped` is true only when a valid run was left out because the run budget was used up.
 * @param {object[]} items pdf.js text items
 * @param {number} runBudget runs this page may still add
 * @param {number[]} view page.view: [x0, y0, x1, y1], the visible page box in user space
 */
export function readItems(items, runBudget, [x0, y0]) {
  const runs = [];
  const ends = [];
  const parts = [];
  let offset = 0;
  let runsDropped = false;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const str = cleanText(item.str);
    const piece = str + (item.hasEOL ? '\n' : '');
    const start = offset;
    parts.push(piece);
    offset += piece.length;
    if (str.trim() === '' || !Array.isArray(item.transform) || item.transform.length < 6) continue;
    const [a, b, c, d, e, f] = item.transform;
    const h = Number.isFinite(item.height) && item.height > 0 ? item.height : Math.hypot(c, d);
    const w = Number.isFinite(item.width) && item.width >= 0 ? item.width : Math.hypot(a, b) * item.str.length;
    if (![e, f, w, h, x0, y0].every(Number.isFinite)) continue;
    if (runs.length >= runBudget) {
      runsDropped = true;
      continue;
    }
    runs.push({ x: round2(e - x0), y: round2(f - y0), w: round2(w), h: round2(h), text: str });
    ends.push(start + str.length);
  }
  return { text: parts.join(''), runs, ends, runsDropped };
}

/**
 * Fits one page's text and runs into the characters that remain under the cap. A run whose text the cut removed
 * (even in part) is dropped with it.
 * @param {{ text: string, runs: object[], ends: number[], runsDropped: boolean }} read from readItems
 * @param {number} room characters still allowed
 * @returns {{ text: string, runs: object[], truncated: boolean }} truncated: text was cut or a valid run was left out
 */
export function fitPage(read, room) {
  const text = cutAt(read.text, Math.max(0, room));
  const textCut = text.length < read.text.length;
  const runs = textCut ? read.runs.filter((_, k) => read.ends[k] <= text.length) : read.runs;
  return { text, runs, truncated: textCut || read.runsDropped };
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<import('./result.js').ParseOutcome>}
 */
export async function parsePdf(bytes) {
  const task = getDocument({
    // pdf.js wants a plain Uint8Array, not a Buffer (a view over the same memory).
    data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    // No script, no network, no fonts or character maps loaded from anywhere: text only.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    verbosity: 0,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      return { ok: false, code: err?.name === 'PasswordException' ? 'encrypted' : 'parse_failed' };
    }
    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, LIMITS.maxPages);
    const pages = [];
    let chars = 0;
    let runCount = 0;
    let unreadable = 0;
    let truncated = pageCount > limit;
    for (let i = 1; i <= limit; i += 1) {
      let page;
      try {
        page = await doc.getPage(i);
        const content = await page.getTextContent();
        const read = readItems(content.items, LIMITS.maxRuns - runCount, page.view);
        const [x0, y0, x1, y1] = page.view;
        const { text, runs, truncated: pageCut } = fitPage(read, LIMITS.maxChars - chars);
        if (pageCut) truncated = true;
        chars += text.length + 1;
        runCount += runs.length;
        pages.push({
          page: i,
          text,
          runs,
          width: round2(x1 - x0),
          height: round2(y1 - y0),
          rotation: Number.isInteger(page.rotate) ? page.rotate : 0,
        });
        page.cleanup();
      } catch {
        unreadable += 1;
        pages.push({ page: i, text: '', runs: [] });
      }
      if (chars > LIMITS.maxChars || runCount >= LIMITS.maxRuns) {
        truncated = truncated || i < limit;
        break;
      }
    }
    if (unreadable === pages.length) return { ok: false, code: 'parse_failed' };
    if (pages.every((p) => p.text.trim() === '')) return { ok: false, code: 'empty' };
    const meta = { pageCount, paginated: true, truncated };
    try {
      const info = (await doc.getMetadata())?.info ?? {};
      const producer = cleanMeta(info.Producer);
      const title = cleanMeta(info.Title);
      if (producer) meta.producer = producer;
      if (title) meta.title = title;
    } catch {
      // Metadata is optional.
    }
    if (unreadable > 0) meta.unreadablePages = unreadable;
    return { ok: true, kind: 'pdf', pages, meta };
  } finally {
    await task.destroy().catch(() => {});
  }
}
