// Pure helper for the save confirmation card. The pending action does not say whether a value came
// from a record, so the card judges the text itself: a value that reads like an instruction (or
// carries a web address) gets one line asking the person to check it before saving.

export const RECORD_TEXT_NOTICE = 'This text came from a record. Check it before you save.';

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
 * True when any text reads like an instruction to the assistant or the reader.
 * @param {unknown[]} texts
 * @returns {boolean}
 */
export function readsLikeInstruction(texts) {
  return (Array.isArray(texts) ? texts : []).some(
    (t) => typeof t === 'string' && PATTERNS.some((re) => re.test(t)),
  );
}
