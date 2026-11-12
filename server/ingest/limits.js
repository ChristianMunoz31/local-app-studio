// Limits, result codes and fixed messages of the document parser (docs/INGEST.md). Shared by the host
// (parent process) and the child; this file imports nothing.

export const KINDS = Object.freeze(['pdf', 'docx', 'text']);

export const LIMITS = Object.freeze({
  /** Largest document accepted (25 MB, as Burrow's maxDocBytes: a 300 page scanned production stays under it). */
  maxInputBytes: 25 * 1024 * 1024,
  /** Pages read from a PDF; more pages set meta.truncated. */
  maxPages: 200,
  /** Characters of text across all pages (JS string length). */
  maxChars: 2_000_000,
  /** Positioned runs across all pages; bounds the JSON the child writes (about 80 bytes per run). */
  maxRuns: 150_000,
  /** Wall clock per parse, then the child is killed. */
  timeoutMs: 20_000,
  /** After SIGKILL, how long the host waits for the child's stdio to close before it frees the slot anyway. */
  killGraceMs: 5000,
  /** V8 old-space cap for the child (MB). Typed arrays are not counted, see docs/INGEST.md. */
  heapMb: 512,
  /** Jobs waiting for the single parse slot. */
  maxQueued: 8,
  /** Child stdout is dropped (and the child killed) beyond this. */
  maxStdoutBytes: 32 * 1024 * 1024,
  /** Child stderr is kept for diagnostics up to this many characters. */
  maxStderrBytes: 16 * 1024,
  /** Stdin job header (one JSON line) cap. */
  maxHeaderBytes: 256,
  /** DOCX zip-bomb guards (as Burrow). */
  docxMaxEntries: 5000,
  docxMaxEntryBytes: 20 * 1024 * 1024,
  docxMaxTotalBytes: 40 * 1024 * 1024,
});

/** Codes the child itself can answer with (the document is the problem). */
export const CONTENT_CODES = Object.freeze(['unsupported', 'encrypted', 'empty', 'parse_failed']);

/** Codes only the host produces (the machine or the caller is the problem). */
export const HOST_CODES = Object.freeze(['too_large', 'doc_busy', 'doc_timeout', 'doc_crashed', 'doc_unavailable', 'aborted']);

/** Fixed texts. Library, provider and OS error text is never copied into a result. */
export const MESSAGES = Object.freeze({
  unsupported: 'This file type is not supported.',
  encrypted: 'This document is password protected.',
  empty: 'No text was found in this document.',
  parse_failed: 'This document could not be read.',
  too_large: 'This document is too large to read.',
  doc_busy: 'Too many documents are waiting to be read. Try again in a moment.',
  doc_timeout: 'Reading this document took too long.',
  doc_crashed: 'The document reader stopped unexpectedly.',
  doc_unavailable: 'The document reader could not be started.',
  aborted: 'Reading was cancelled.',
});

/**
 * @param {keyof typeof MESSAGES} code
 * @returns {{ ok: false, code: string, message: string }}
 */
export function failure(code) {
  return { ok: false, code, message: MESSAGES[code] };
}
