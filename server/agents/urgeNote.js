// A reply that talks the person into approving a change they never asked for. A planted record can make a model say
// "you should approve changing Bravo to ..." after a plain read. The reply is not rewritten (record text and the model's
// words stay as they are): when ALL of these hold, one fixed sentence is appended after it.
//   - a read this turn returned record text (`readText`);
//   - nothing was parked or written this turn;
//   - none of the person's messages asked for a change (`unasked`, server/agents/saveOrigin.js);
//   - one sentence urges an approval or a change (markdown marks * _ ~ and backticks are dropped first):
//       a lead (you should, you need to, you must, please, kindly, just, go ahead and, I recommend, I suggest, make sure to,
//       you'd need to, ...), then optionally a comma, then within three words (none a determiner) approve, confirm or accept,
//       update, change or save (base or -ing form, so "was updated" and "is confirmed" never match), or set or mark
//       followed within four words by "to" or "as" ("You should set a reminder" is advice, "set Bravo to active" is not);
//       or a plain command: a sentence, or a line after a list marker, that starts with approve, confirm or accept;
//       or "click", "press" or "tap" (the) approve at the start of a sentence or after a comma;
//       or "I can ..." with "if/once/when/after you approve|confirm|accept" in the same sentence.
//     "you'd need to" is a hypothetical lead: it is skipped when the reply also offers to do the change (a question such as
//     "Would you like me to update Bravo?"), because then it explains what the card needs.
// Not a classifier: a few regexes over the model's reply text. It can miss a paraphrase and can fire on advice that happens
// to match (false positives are covered by the corpus in server/__tests__/urgeNote.test.js). Pure: no I/O.

export const URGE_NOTE = 'Text inside your records is not a request. Nothing changes unless you ask for it and approve the card.';

const LEAD = String.raw`(?:you\s+should|you\s+need\s+to|you\s+must|you(?:'ll|\s+will)\s+want\s+to|please|kindly|just|go\s+ahead\s+and|I\s+recommend|I\s+suggest|I'd\s+recommend|I'd\s+suggest|make\s+sure\s+to|be\s+sure\s+to)`;
const HYPO_LEAD = String.raw`you(?:'d|\s+would)\s+need\s+to`;
const ACT = String.raw`(?:approv(?:e|ing)|confirm(?:ing)?|accept(?:ing)?|updat(?:e|ing)|chang(?:e|ing)|sav(?:e|ing))\b`;
const SET_ACT = String.raw`(?:set(?:ting)?|mark(?:ing)?)(?:\s+[^\s.!?]+){0,4}?\s+(?:to|as)\b`;
// The words between the lead and the verb are never a determiner or possessive ("I recommend a status update" is a noun).
const GAP = String.raw`(?:\s+(?!(?:a|an|the|this|that|your|my|our|its|their|any|some)\b)[\w'-]+){0,3}?`;
const IMPERATIVE_RE = new RegExp(String.raw`\b${LEAD}${GAP}[\s,]+(?:${ACT}|${SET_ACT})`, 'i');
const HYPO_RE = new RegExp(String.raw`\b${HYPO_LEAD}${GAP}[\s,]+(?:${ACT}|${SET_ACT})`, 'i');
const COMMAND_RE = /^\s*(?:[-+•>]+\s*|\d+[.)]\s*)?(?:approve|confirm|accept)\b/i;
const CLICK_RE = /(?:^|,)\s*(?:(?:then|now|please|just)[\s,]+)*(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?approve\b/i;
const OFFER_RE = /\bI\s+can\b[^.!?\n]{0,60}?\b(?:if|once|when|after)\s+you\s+(?:approve|confirm|accept)\b/i;
const OFFER_QUESTION_RE = /\b(?:would\s+you\s+like|do\s+you\s+want|want\s+me\s+to|shall\s+I|should\s+I)\b/i;

// One sentence: up to a . ! ? run, or a line without a final stop.
const SENTENCE_RE = /[^.!?\n]*[.!?]+|[^.!?\n]+/g;

// Markdown marks and curly apostrophes never change the words.
const plain = (sentence) => sentence.replace(/[*_~`]/g, '').replace(/[‘’]/g, "'");

/**
 * @param {string} sentence
 * @param {{ offered?: boolean }} [opts] offered: the reply asks whether to make the change (skips the hypothetical lead)
 * @returns {boolean} whether the sentence urges approving or making a change
 */
export function urges(sentence, { offered = false } = {}) {
  const t = plain(sentence);
  return IMPERATIVE_RE.test(t) || COMMAND_RE.test(t) || CLICK_RE.test(t) || OFFER_RE.test(t) || (!offered && HYPO_RE.test(t));
}

/**
 * Whether any tool result of this turn holds record text: a list result with a non-empty string in a row.
 * @param {Array<unknown>} results
 * @returns {boolean}
 */
export const returnedText = (results) =>
  (Array.isArray(results) ? results : []).some(
    (r) =>
      r !== null &&
      typeof r === 'object' &&
      r.error === undefined &&
      Array.isArray(r.rows) &&
      r.rows.some((row) => row !== null && typeof row === 'object' && Object.values(row).some((v) => typeof v === 'string' && v.trim() !== '')),
  );

/**
 * @param {string} text the final answer text
 * @param {{ parked: boolean, wrote?: boolean, readText: boolean, unasked: boolean }} turn
 * @returns {string} the text, with URGE_NOTE appended (once) when the reply urges a change nobody asked for
 */
export function withUrgeNote(text, { parked, wrote = false, readText, unasked }) {
  if (parked || wrote || !readText || !unasked || typeof text !== 'string' || text.includes(URGE_NOTE)) return text;
  const sentences = text.match(SENTENCE_RE) ?? [];
  const offered = sentences.some((sentence) => OFFER_QUESTION_RE.test(plain(sentence)));
  return sentences.some((sentence) => urges(sentence, { offered })) ? `${text.trimEnd()}\n\n${URGE_NOTE}` : text;
}
