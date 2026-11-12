// AI summarizes, code calculates: a number in the reply must come from this turn's tool results or from the person's own
// message. A small model sometimes adds filtered rows itself ("25 (24 + 1)") or quotes a count it never read. Every sentence of
// the reply that holds a number outside that set is replaced (once per reply) by one fixed sentence. Sentences with only
// grounded numbers stay. Pure: no I/O.

export const UNGROUNDED_NUMBER_NOTE = 'I could not get that number from your data.';

// A number token: digits with optional thousands commas and an optional decimal part ("1,234.50", "2026", "09").
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/;
// One sentence: up to a . ! ? run (a point before a digit is a decimal point), or the unterminated tail.
const SENTENCE_RE = /(?:[^.!?\n]|\.(?=\d))+[.!?]*|[.!?]+/g;
// What a line starts with that is not part of a sentence: a bullet or a list number ("1." / "2)").
const LINE_LEAD_RE = /^(\s*(?:[-*\u2022]\s+|\d{1,3}[.)]\s+)?)/;

/**
 * Canonical form of a number token: commas removed, leading zeros dropped, trailing zeros of a decimal dropped.
 * @param {string} token
 * @returns {string}
 */
export function normalizeNumber(token) {
  let s = String(token).replace(/,/g, '');
  const [int, dec] = s.split('.');
  const intPart = int.replace(/^0+(?=\d)/, '');
  const decPart = dec === undefined ? '' : dec.replace(/0+$/, '');
  s = decPart ? `${intPart}.${decPart}` : intPart;
  return s;
}

const numbersIn = (text) => (typeof text === 'string' ? (text.match(NUMBER_RE) ?? []).map(normalizeNumber) : []);

function collect(value, set, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return;
    for (const n of numbersIn(String(value))) set.add(n);
    // A float from a stat (3.3333333333333335) is quoted rounded: "3.3", "3.33", "$3.30". Never toFixed(0): that would ground a
    // whole number the tool did not give.
    if (!Number.isInteger(value)) {
      for (const form of [value.toFixed(1), value.toFixed(2), value.toPrecision(12)]) if (!/e/i.test(form)) for (const n of numbersIn(form)) set.add(n);
    }
    return;
  }
  if (typeof value === 'string') {
    // An id carries no number the person can read; a timestamp keeps its date and drops the clock time.
    if (UUID_RE.test(value.trim())) return;
    const ts = TIMESTAMP_RE.exec(value);
    for (const n of numbersIn(ts ? ts[1] : value)) set.add(n);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, set, depth + 1);
    return;
  }
  if (typeof value === 'object') for (const v of Object.values(value)) collect(v, set, depth + 1);
}

/**
 * The numbers a reply may use: those in this turn's tool results and in the person's message.
 * @param {unknown[]} results tool results of this turn (objects, or JSON text)
 * @param {string} [prompt] the person's message
 * @returns {Set<string>}
 */
export function groundedNumbers(results, prompt = '') {
  const set = new Set(numbersIn(prompt));
  for (const r of Array.isArray(results) ? results : []) {
    let value = r;
    if (typeof r === 'string') {
      try {
        value = JSON.parse(r);
      } catch {
        value = r;
      }
    }
    collect(value, set);
  }
  return set;
}

/**
 * @param {string} text the final answer text
 * @param {{ results?: unknown[], prompt?: string }} turn this turn's tool results and the person's message
 * @returns {string} the text with each sentence that holds an ungrounded number replaced (once) by the fixed sentence
 */
export function withNumberGround(text, { results = [], prompt = '' } = {}) {
  if (typeof text !== 'string' || !/\d/.test(text)) return text;
  const grounded = groundedNumbers(results, prompt);
  // A reply that already holds the note (the model copied it) still gets its ungrounded sentences dropped, with no second note.
  let replaced = text.includes(UNGROUNDED_NUMBER_NOTE);
  let changedAny = false;
  const lines = text.split('\n').map((line) => {
    const lead = LINE_LEAD_RE.exec(line)[1];
    const body = line.slice(lead.length);
    if (!/\d/.test(body)) return line;
    let changed = false;
    const out = body.replace(SENTENCE_RE, (sentence) => {
      if (!numbersIn(sentence).some((n) => !grounded.has(n))) return sentence;
      changed = true;
      changedAny = true;
      const space = /^\s*/.exec(sentence)[0];
      if (replaced) return '';
      replaced = true;
      return `${space}${UNGROUNDED_NUMBER_NOTE}`;
    });
    if (!changed) return line;
    return out.trim() === '' ? null : `${lead}${out.trimStart()}`;
  });
  return changedAny ? lines.filter((l) => l !== null).join('\n').trim() : text;
}
