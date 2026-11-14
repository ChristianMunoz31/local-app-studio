// Where a parked save came from, decided on the server from data the model cannot alter. Pure: no I/O.
//
// A built app's Assistant reads records into the model's prompt (list_records results, role "tool"). A planted record
// can ask the model to talk the person into one specific save. The approval card therefore says, in the server's
// words, whether the values being saved match text found in a record read in this conversation and whether the
// person ever asked for a change. Inputs are the run's message list (user messages and read tool results the server
// stored) and the parked values. Nothing here reads model text, tool arguments or flags the model could set.
//
// The rule (constants below):
//   1. Read results: tool messages whose call (matched by tool_call_id through the assistant tool_calls) was a
//      list_records__<table> read. The content is parsed as JSON (never substring-matched as raw text); results with
//      an error or a parked-save placeholder are skipped. The string leaves of `rows` are the record text.
//   2. Normalization (norm): NFKC, format characters removed (\p{Cf}: zero width, joiners, bidi marks), lowercase,
//      every run of whitespace, punctuation and symbols becomes one space, trim.
//   3. A saved string value "came from a record" when its normalized form has at least MIN_VALUE_CHARS (12)
//      characters, so "active", "paused" and short names never flag, and either (a) it is a substring of one
//      normalized record leaf, or (b) some run of RUN_WORDS (5) consecutive normalized words of the value is also a run
//      of one record leaf.
//   4. Typed text clears only what it covers: (a) clears only when one of the person's messages contains the WHOLE
//      value; (b) is cleared per run, so a run that is in a record and not in anything they typed still flags the value
//      even when other runs of it were typed. On an update whose new value contains the whole stored value of the same
//      field (a resend plus an addition), a run or value already in the stored text does not count either; a value that
//      keeps only part of the stored text gets no such exclusion.
//   5. On an update, a value equal to the stored one is skipped (`unchanged`: a small model resends unchanged fields).
//      A value shaped like an id (a link) is skipped: an id is not record text. So is a field with spec-defined options
//      (`optionFields`, select fields): its option text cannot be planted and repeats in every record.
//   6. `unasked` is true when none of the person's messages in this conversation holds a change request word
//      (CHANGE_REQUEST_RE). "yes", "ok", "sure" and "go ahead" alone are not a request.
//
// Known misses (documented in docs/ARCHITECTURE.md, "Assistant threat model"): a paraphrase that shares no 5-word run
// with the record; a value split across fields so that no single value is long enough; look-alike letters from another
// script (NFKC folds compatibility forms, not cross-script confusables); a read in an earlier conversation or outside
// the history window; a change word in an unrelated sentence of the person's message makes `unasked` false.
// Known false alarms: a long value the person did not type that repeats text already stored in a record (for example
// copying a record's note into a new record on their behalf).

export const MIN_VALUE_CHARS = 12;
export const RUN_WORDS = 5;
const MAX_LEAVES = 5000;
const MAX_DEPTH = 4;

// Words that make a message a request to change data. The nouns "record" and "log" count only as verbs ("record a ...").
export const CHANGE_REQUEST_RE =
  /\b(?:add|change|update|set|save|mark|rename|edit|create|put|move|assign|make|fix|delete|remove|enter)\b|\b(?:record|log)\s+(?:a|an|the|this|that|my|our|it|these|those)\b/i;

const READ_NAME_RE = /^list_records__/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} text
 * @returns {string} the comparison form (see the header)
 */
export const norm = (text) =>
  String(text)
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();

/** @param {string[]} words @returns {string[]} every run of RUN_WORDS consecutive words, joined by one space */
function shingles(words) {
  const out = [];
  for (let i = 0; i + RUN_WORDS <= words.length; i += 1) out.push(words.slice(i, i + RUN_WORDS).join(' '));
  return out;
}

/** The normalized texts and every run of RUN_WORDS words in them. */
function haystack(texts) {
  const normed = texts.map(norm).filter((t) => t !== '');
  const runs = new Set();
  for (const t of normed) for (const s of shingles(t.split(' '))) runs.add(s);
  return {
    /** Whether the whole normalized value is inside one of the texts. */
    contains: (valueNorm) => normed.some((t) => t.includes(valueNorm)),
    /** Whether the run is one of the texts' runs. */
    hasRun: (run) => runs.has(run),
  };
}

function collectLeaves(value, out, depth = 0) {
  if (out.length >= MAX_LEAVES || depth > MAX_DEPTH) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectLeaves(v, out, depth + 1);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) collectLeaves(v, out, depth + 1);
}

const textOf = (m) => (typeof m?.content === 'string' ? m.content : '');

/**
 * The string leaves of the rows of every list_records read in the messages.
 * @param {Array<object>} messages the run's model messages
 * @returns {string[]}
 */
export function readLeaves(messages) {
  const names = new Map();
  for (const m of messages) {
    if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const c of m.tool_calls) if (typeof c?.id === 'string' && typeof c?.function?.name === 'string') names.set(c.id, c.function.name);
  }
  const leaves = [];
  // Newest first: the cap keeps the most recent reads, so this turn's read is never the one dropped.
  for (let i = messages.length - 1; i >= 0 && leaves.length < MAX_LEAVES; i -= 1) {
    const m = messages[i];
    if (m?.role !== 'tool' || !READ_NAME_RE.test(names.get(m.tool_call_id) ?? '')) continue;
    let parsed;
    try {
      parsed = JSON.parse(textOf(m));
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || parsed.error !== undefined || parsed.status === 'awaiting_confirmation') continue;
    collectLeaves(parsed.rows, leaves);
  }
  return leaves;
}

/**
 * The person's own messages. The last user message of the list is this turn's, which may carry a page hint, so the
 * bare prompt replaces it.
 * @param {Array<object>} messages
 * @param {string} [prompt]
 * @returns {string[]}
 */
export function userTexts(messages, prompt) {
  const texts = messages.filter((m) => m?.role === 'user').map(textOf);
  if (typeof prompt === 'string' && texts.length > 0) texts[texts.length - 1] = prompt;
  return texts;
}

/**
 * Whether none of the person's messages in the conversation asks for a change (the `unasked` flag).
 * @param {Array<object>} messages
 * @param {string} [prompt] this turn's bare prompt
 * @returns {boolean}
 */
export const isUnasked = (messages, prompt) => !userTexts(messages, prompt).some((t) => CHANGE_REQUEST_RE.test(t));

/**
 * @param {{ messages: Array<object>, prompt?: string, values: Record<string, unknown>, display?: Array<{ label?: string }>,
 *   unchanged?: readonly string[], stored?: Record<string, unknown>, optionFields?: readonly string[] }} input `values` are
 *   the parked values (field id to value); `display` the card rows in the same order (their labels name the matched fields);
 *   `unchanged` the field ids equal to the stored value; `stored` (an update) the stored value of each changed text field;
 *   `optionFields` the field ids whose rule has spec-defined options
 * @returns {{ fromRecord: boolean, unasked: boolean, fields?: string[] }}
 */
export function computeSaveOrigin({ messages, prompt, values, display = [], unchanged = [], stored = {}, optionFields = [] }) {
  const own = userTexts(messages, prompt);
  const unasked = isUnasked(messages, prompt);
  const records = haystack(readLeaves(messages));
  const typed = haystack(own);
  const skip = new Set([...unchanged, ...optionFields]);
  const fields = [];
  Object.entries(values ?? {}).forEach(([fid, value], i) => {
    if (typeof value !== 'string' || skip.has(fid) || ID_RE.test(value.trim())) return;
    const n = norm(value);
    if (n.length < MIN_VALUE_CHARS) return;
    // The stored exclusion applies only to a resend plus an addition: the new value holds the whole stored value. A rewrite
    // that keeps just a part of the stored text (planted text already saved, then trimmed) gets no exclusion.
    const sn = typeof stored?.[fid] === 'string' ? norm(stored[fid]) : '';
    const before = sn !== '' && n.includes(sn) ? haystack([stored[fid]]) : null;
    const whole = records.contains(n) && !typed.contains(n) && !before?.contains(n);
    const run = shingles(n.split(' ')).some((s) => records.hasRun(s) && !typed.hasRun(s) && !before?.hasRun(s));
    if (!whole && !run) return;
    const label = display[i]?.label;
    fields.push(typeof label === 'string' && label !== '' ? label : fid);
  });
  return { fromRecord: fields.length > 0, unasked, ...(fields.length > 0 ? { fields } : {}) };
}
