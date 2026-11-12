// Result shapes. Documentation only (JSDoc); the host validates the real thing in parserHost.js.

/**
 * @typedef {object} Run One text run with its position, PDF pages only. Units and origin: docs/INGEST.md.
 * @property {number} x left edge of the run's baseline origin, from the left edge of the visible page box
 * @property {number} y baseline height above the bottom edge of the visible page box
 * @property {number} w advance width of the run
 * @property {number} h font height of the run
 * @property {string} text
 *
 * @typedef {object} Page
 * @property {number | null} page 1-based page number; null for formats without pages (DOCX, text)
 * @property {string} text
 * @property {Run[]} [runs] PDF only
 * @property {number} [width] PDF only, width of the visible page box (CropBox within MediaBox) in user space units
 * @property {number} [height] PDF only, height of the visible page box
 * @property {number} [rotation] PDF only, page /Rotate in degrees (runs are NOT rotated)
 * @property {{ index: number, start: number, end: number }[]} [paragraphs] DOCX only: offsets into `text`
 *
 * @typedef {object} Meta
 * @property {number | null} pageCount pages in the file (PDF); null when the format has no pages
 * @property {boolean} paginated false for DOCX and text: never show a page number for them
 * @property {boolean} truncated true when a page, character or run cap cut the output
 * @property {string} [producer]
 * @property {string} [title]
 * @property {number} [unreadablePages] PDF pages that failed to read (their text is empty)
 *
 * @typedef {{ ok: true, kind: 'pdf' | 'docx' | 'text', pages: Page[], meta: Meta }} ParseSuccess
 * @typedef {{ ok: false, code: 'unsupported' | 'encrypted' | 'empty' | 'parse_failed' }} ParseOutcomeFailure
 * @typedef {ParseSuccess | ParseOutcomeFailure} ParseOutcome
 */
export {};
