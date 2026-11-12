// Public API of the document parser (docs/INGEST.md). This is the only file outside server/ingest/ may import.
// Parsing runs in a child process, never in this one: this module imports no PDF or ZIP library.
import { isUtf8 } from 'node:buffer';
import { KINDS, LIMITS, failure } from './limits.js';
import { createParserHost } from './parserHost.js';

export { KINDS, LIMITS, MESSAGES, failure } from './limits.js';

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOCX_MAIN_PART = Buffer.from('word/document.xml');

/**
 * True when the parse queue is full, so a new document would be answered doc_busy. A cheap check for a route to make
 * before it spends memory decoding a request body (the answer can still change before the job is queued).
 * @param {ReturnType<typeof createParserHost>} [hostOverride] for tests
 * @returns {boolean}
 */
export function isParserBusy(hostOverride) {
  const h = hostOverride ?? host();
  return h.busy() && h.queued() >= LIMITS.maxQueued;
}

/** Kinds `parseDocument` accepts. @returns {string[]} */
export function supportedKinds() {
  return [...KINDS];
}

/**
 * Which kind the bytes look like, or null. A PDF header may follow up to 1024 bytes of junk (as pdf.js allows); a
 * DOCX is a ZIP that names word/document.xml; text is valid UTF-8 without NUL bytes. A cheap guard: the child parses
 * the file for real and can still answer parse_failed.
 * @param {Uint8Array} bytes
 * @returns {'pdf' | 'docx' | 'text' | null}
 */
export function sniffKind(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.subarray(0, 1024).includes(PDF_MAGIC)) return 'pdf';
  if (buf.subarray(0, 4).equals(ZIP_MAGIC)) return buf.includes(DOCX_MAIN_PART) ? 'docx' : null;
  return looksLikeText(buf) ? 'text' : null;
}

const looksLikeText = (buf) => !buf.includes(0) && isUtf8(buf);

let sharedHost = null;
const host = () => (sharedHost ??= createParserHost({ onDiagnostic: logFailure }));

/** Logs the code and exit status only. stderr stays out of the log too: it can quote document content. */
function logFailure({ code, exitCode, signal }) {
  console.warn(`ingest: parser child failed (${code}, exit ${exitCode ?? 'none'}, signal ${signal ?? 'none'})`);
}

/**
 * Parses a PDF, DOCX or text document in a child process. Never rejects: failures are `{ ok: false, code, message }`.
 * @param {Uint8Array} bytes the document
 * @param {{ kind?: 'pdf' | 'docx' | 'text', signal?: AbortSignal, host?: ReturnType<typeof createParserHost> }} [opts]
 *   `kind` is optional (sniffed from the bytes); when given it must match them. `host` is for tests.
 * @returns {Promise<object>} the contract in docs/INGEST.md
 */
export async function parseDocument(bytes, { kind, signal, host: hostOverride } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return failure('empty');
  if (bytes.length > LIMITS.maxInputBytes) return failure('too_large');
  if (kind !== undefined && !KINDS.includes(kind)) return failure('unsupported');
  // A caller that says "text" is trusted over the PDF header sniff (a note may quote "%PDF-"), but still checked.
  const sniffed = kind === 'text' ? (looksLikeText(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)) ? 'text' : null) : sniffKind(bytes);
  if (sniffed === null || (kind !== undefined && kind !== sniffed)) return failure('unsupported');
  return (hostOverride ?? host()).run(bytes, sniffed, { signal });
}
