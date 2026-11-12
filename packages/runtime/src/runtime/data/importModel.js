// Client words and limits of the Import rows panel. The count lines and the row lines come from the server (`lines`).
export const IMPORT_DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const IMPORT_DEFAULT_MAX_ROWS = 200_000;
/** Under the Studio's 2 MB JSON parser, with room for the envelope (design 4.4). */
export const PREVIEW_IMPORT_MAX_BODY = 1_900_000;

export const IMPORT_WORDS = {
  tooLarge: 'This file is too large to import here. The limit is 16 MB.',
  tooLargePreview: 'This file is too large for Preview. In Preview a file can be up to about 2 MB and 5000 rows.',
  tooManyRowsPreview: 'In Preview a file can have up to 5000 rows. Split it, or import it in the built app.',
  timeout: 'If an import takes too long, some rows may already be added. Check the total before you import again.',
  automations: 'Automations do not run on imported rows unless you tick Apply automations.',
  practice: 'These are practice records. Reset preview data puts the sample back.',
};

/** The size in bytes of the JSON body as it is sent. */
export function encodedSize(body) {
  return new Blob([JSON.stringify(body)]).size;
}

/** The sentence for a body that is over the limit, or null when it fits. */
export function sizeProblem(body, maxBytes = IMPORT_DEFAULT_MAX_BYTES) {
  // At most 3 bytes a character: a text that small needs no encoding to be measured.
  if (typeof body?.csv === 'string' && body.csv.length * 3 <= maxBytes) return null;
  if (encodedSize(body) <= maxBytes) return null;
  return maxBytes < IMPORT_DEFAULT_MAX_BYTES ? IMPORT_WORDS.tooLargePreview : IMPORT_WORDS.tooLarge;
}

export const resumeLabel = (row) => `Import again from row ${row}`;
export const importLabel = (valid) => `Import ${valid} ${valid === 1 ? 'row' : 'rows'}`;
