// Synthetic PDF and DOCX bytes for the ingest tests. Generated in code: no fixture files, no personal data.
import { strToU8, zipSync } from 'fflate';

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * A minimal valid text PDF (Helvetica, one content stream per page, every run placed with an absolute
 * text matrix so its position is known).
 * @param {{ runs: { x: number, y: number, size?: number, text: string }[] }[]} pages
 * @param {{ encrypted?: boolean, width?: number, height?: number, title?: string, mediaBox?: number[], cropBox?: number[] }} [opts]
 *   `encrypted` adds a standard-handler /Encrypt entry that no empty password opens; `mediaBox` / `cropBox` are
 *   [x0, y0, x1, y1] and replace the default 0 0 width height box
 * @returns {Buffer}
 */
export function makePdf(pages, { encrypted = false, width = 612, height = 792, title, mediaBox, cropBox } = {}) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = pages.map(({ runs }) => {
    const ops = ['BT', ...runs.map((r) => `/F1 ${r.size ?? 12} Tf 1 0 0 1 ${r.x} ${r.y} Tm (${esc(r.text)}) Tj`), 'ET'].join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [${(mediaBox ?? [0, 0, width, height]).join(' ')}]${cropBox ? ` /CropBox [${cropBox.join(' ')}]` : ''} /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let infoId = 0;
  if (title) infoId = add(`<< /Title (${esc(title)}) /Producer (ingest-test) >>`);
  let encryptId = 0;
  const hex32 = '00'.repeat(32);
  if (encrypted) encryptId = add(`<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -4 >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  const idEntry = encrypted ? ' /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]' : '';
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ''}${encryptId ? ` /Encrypt ${encryptId} 0 R` : ''}${idEntry} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A minimal DOCX (a zip with the content types, the main document and optional header/footer parts).
 * @param {string[]} paragraphs
 * @param {{ header?: string, footer?: string, extraEntries?: Record<string, Uint8Array> }} [opts]
 * @returns {Buffer}
 */
export function makeDocx(paragraphs, { header, footer, extraEntries = {} } = {}) {
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${ns}><w:body>${paragraphs.map(para).join('')}</w:body></w:document>`),
    ...extraEntries,
  };
  if (header) files['word/header1.xml'] = strToU8(`<w:hdr ${ns}>${para(header)}</w:hdr>`);
  if (footer) files['word/footer1.xml'] = strToU8(`<w:ftr ${ns}>${para(footer)}</w:ftr>`);
  return Buffer.from(zipSync(files));
}

/** A standard two page fixture with known positions. */
export const SAMPLE_PAGES = [
  {
    runs: [
      { x: 72, y: 720, size: 14, text: 'Panel Report' },
      { x: 72, y: 700, size: 10, text: 'Glucose' },
      { x: 220, y: 700, size: 10, text: '92' },
      { x: 300, y: 700, size: 10, text: 'mg/dL' },
    ],
  },
  { runs: [{ x: 100, y: 500, size: 12, text: 'Second page text' }] },
];
