// A small model sometimes writes "I have deleted the records" or "I'll proceed with adding it" when no write tool ran.
// Records change only after the user presses Approve, so a final text that claims a change without a write run or
// parked this turn has the claiming sentence replaced by one fixed sentence (never appended after it, so nobody reads
// the claim next to its denial). Pure: no I/O.

export const NO_CHANGE_NOTE = 'Nothing was changed. Records change only after you press Approve.';

// Delete-like claims. A first-person or future lead ("I have removed", "will be deleted") is a claim whatever was read.
// A passive or "now" lead ("have been created", "is now clear") is also what a true answer about data sounds like, so it
// counts only when no read succeeded this turn.
const DELETE_STRONG_RE = /\b(?:will|I am|I have|I've)\b[^.!?\n:]{0,40}?\b(?:delet|remov|eras|wip|clear)\w*/i;
const DELETE_WEAK_RE = /\b(?:now|has been|have been|had been)\b[^.!?\n:]{0,40}?\b(?:delet|remov|eras|wip|clear)\w*/i;
// A save or add that did not happen, and an invitation to confirm that no card backs.
const SAVE_STRONG_RE = /\bI'll proceed with (?:add|sav|creat)\w*|\bI(?:'ve| have)? (?:added|saved|created)\b|\badded it\b|\bPlease confirm if you want to proceed/i;
const SAVE_WEAK_RE = /\b(?:has|have|had) been (?:added|saved|created)\b/i;

const isClaim = (sentence, readOk) =>
  DELETE_STRONG_RE.test(sentence) ||
  SAVE_STRONG_RE.test(sentence) ||
  (!readOk && (DELETE_WEAK_RE.test(sentence) || SAVE_WEAK_RE.test(sentence)));

// One sentence: up to a . ! ? run or a newline, or the unterminated tail. Leading whitespace stays with the sentence.
const SENTENCE_RE = /\s*[^.!?\n]*[.!?]+|\s*[^.!?\n]+$/g;

/**
 * @param {string} text the final answer text
 * @param {{ wrote: boolean, parked: boolean, readOk?: boolean, approved?: boolean }} turn whether a write tool ran or was
 * parked this turn, whether a read succeeded this turn, and whether a pending action of this conversation was approved
 * since the previous turn (the change happened outside the loop, so a claim about it can be true)
 * @returns {string} the text, with each sentence that claims a change nothing made replaced (once) by the fixed sentence
 */
export function withNoChangeNote(text, { wrote, parked, readOk = false, approved = false }) {
  if (wrote || parked || approved || typeof text !== 'string' || text.includes(NO_CHANGE_NOTE)) return text;
  let replaced = false;
  const out = text.replace(SENTENCE_RE, (sentence) => {
    if (!isClaim(sentence, readOk)) return sentence;
    const lead = /^\s*/.exec(sentence)[0];
    if (replaced) return '';
    replaced = true;
    return `${lead}${NO_CHANGE_NOTE}`;
  });
  return replaced ? out.trim() : text;
}
