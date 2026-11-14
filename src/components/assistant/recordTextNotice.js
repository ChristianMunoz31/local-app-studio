// Pure helper for the save confirmation card. Two checks run on the card: the server's origin mark (the pending action
// carries `origin`, decided in server/agents/saveOrigin.js) and this file's regex guess. The guess judges the text itself:
// a value that reads like an instruction (or carries a web address) gets one line asking the person to check it before
// saving. It shows unless the server already said fromRecord. With an origin present the line is hedged
// (INSTRUCTION_TEXT_NOTICE), because the server may have checked and found no record match.

export const RECORD_TEXT_NOTICE = 'This text came from a record. Check it before you save.';
export const INSTRUCTION_TEXT_NOTICE = 'This text reads like an instruction. Check it before you save.';

// The server's own words (server/agents/saveOrigin.js decides them; the pending action carries `origin`). They show
// beside the guess above, not instead of it.
const FROM_RECORD_HEAD = 'This change matches text inside a record, not words you typed';
const FROM_RECORD_TAIL = 'Check it before you approve.';
export const ORIGIN_FROM_RECORD_NOTICE = `${FROM_RECORD_HEAD}. ${FROM_RECORD_TAIL}`;
export const ORIGIN_UNASKED_NOTICE = 'You did not ask for a change in this conversation.';
const MAX_FIELDS_SHOWN = 3;
const MAX_FIELD_CHARS = 40;

const PATTERNS = [
  /\bhttps?:\/\//i,
  /\bwww\.[a-z0-9-]+\./i,
  /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|instructions?|rules?)\b/i,
  /\b(you must|you should|you will|you are now|do not tell|don'?t tell|pretend to be|act as)\b/i,
  /\b(system|assistant|developer)\s*:/i,
  /\bclick\b/i,
  /(^|[.!?]\s+)(visit|open|run|call|email|send|delete|reply|tell|respond|forward|download)\b/i,
];

/**
 * The lines the card shows for the server's origin mark.
 * @param {unknown} origin `{ fromRecord, unasked, fields? }` from the confirm.required payload
 * @returns {string[] | null} null when the payload has no origin (an older payload: use the guess); an empty list when the
 * server checked and found nothing to say
 */
export function originNotices(origin) {
  if (origin === null || typeof origin !== 'object' || Array.isArray(origin)) return null;
  const fields = Array.isArray(origin.fields)
    ? origin.fields.filter((f) => typeof f === 'string' && f !== '').slice(0, MAX_FIELDS_SHOWN).map((f) => f.slice(0, MAX_FIELD_CHARS))
    : [];
  const lines = [];
  if (origin.fromRecord === true) {
    lines.push(fields.length > 0 ? `${FROM_RECORD_HEAD} (${fields.join(', ')}). ${FROM_RECORD_TAIL}` : ORIGIN_FROM_RECORD_NOTICE);
  }
  if (origin.unasked === true) lines.push(ORIGIN_UNASKED_NOTICE);
  return lines;
}

/**
 * True when any text reads like an instruction to the assistant or the reader.
 * @param {unknown[]} texts
 * @returns {boolean}
 */
export function readsLikeInstruction(texts) {
  return (Array.isArray(texts) ? texts : []).some(
    (t) => typeof t === 'string' && PATTERNS.some((re) => re.test(t)),
  );
}
