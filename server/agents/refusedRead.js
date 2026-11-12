// A refused read tool must never become a number in the reply. A small model that was refused (a bad argument, a bad
// table) sometimes answers "you collected $0" anyway. When a read was refused and no later read succeeded, a reply that
// carries a digit is replaced by one fixed sentence that keeps the refusal's own retry words. When some read did succeed
// this turn (another table), its numbers may be true, so the reply stays and the refusal sentence is appended. Pure: no I/O.
import { sanitizeModelText } from '../ai/index.js';
import { plainToolWords } from './toolWords.js';

const REFUSAL_MAX = 160;
const READ_NAME_RE = /^(?:get_stats|list_records)(?:__.+)?$/;

/**
 * Whether a tool name reads data, and which table: a per-table name gives its table; describe_data and the generic
 * verbs give null (any table).
 * @param {unknown} name
 * @returns {{ table: string | null } | null} null when the name is not a read tool
 */
export function readTarget(name) {
  if (typeof name !== 'string') return null;
  if (name === 'describe_data') return { table: null };
  if (!READ_NAME_RE.test(name)) return null;
  const i = name.indexOf('__');
  return { table: i === -1 ? null : name.slice(i + 2) };
}

/**
 * Whether a read tool counts (get_stats) rather than lists or describes.
 * @param {unknown} name
 * @returns {'count' | 'read'}
 */
export const readVerb = (name) => (typeof name === 'string' && name.startsWith('get_stats') ? 'count' : 'read');

const TABLE_REFUSAL_RE = /^Argument "table" must be one of:/;
// A sentence written for the model: how to call again, or what did not run (the note adds its own).
const MODEL_ONLY_RE = /^(?:Call |Nothing was (?:read|saved))/;

/**
 * A refusal sentence rewritten for the person: no tool names, no retry instructions for the model.
 * @param {string} refusal
 * @returns {string} words without a trailing stop; empty when nothing readable is left
 */
export function personRefusal(refusal) {
  const text = String(refusal ?? '').trim();
  if (TABLE_REFUSAL_RE.test(text)) return 'That request named a table this app does not have';
  const kept = (text.match(/(?:[^.!?]|\.(?=\d))+[.!?]*/g) ?? []).map((s) => s.trim()).filter((s) => s && !MODEL_ONLY_RE.test(s));
  return plainToolWords(kept.join(' ')).replace(/[.!?\s]+$/, '');
}

/**
 * The refusal that still stands at the end of the turn, or null. A refusal stands unless a later read succeeded on
 * the same table; a success with no table (describe_data) clears every refusal, but a refusal with no table (a generic
 * call) is cleared only by such a success.
 * @param {Array<{ table: string | null, ok: boolean, refusal?: string }>} reads reads of this turn, in order
 * @returns {string | null} the refusal sentence
 */
export function standingRefusal(reads) {
  return standingRead(reads)?.refusal ?? null;
}

function standingRead(reads) {
  const list = Array.isArray(reads) ? reads : [];
  for (const [i, r] of list.entries()) {
    if (r.ok || typeof r.refusal !== 'string') continue;
    const cleared = list.slice(i + 1).some((later) => later.ok && (later.table === null || later.table === r.table));
    if (!cleared) return r;
  }
  return null;
}

/**
 * @param {string} text the final answer text
 * @param {Array<{ table: string | null, ok: boolean, refusal?: string, verb?: 'count' | 'read' }>} reads
 * @returns {string} the fixed sentence when a standing refusal meets a reply with a number and no read succeeded; the text with
 * the sentence appended when another read did succeed; else the text
 */
export function withRefusedReadGuard(text, reads) {
  if (typeof text !== 'string' || !/\d/.test(text)) return text;
  const standing = standingRead(reads);
  if (standing === null) return text;
  const clipped = personRefusal(standing.refusal).slice(0, REFUSAL_MAX).trim().replace(/[.!?\s]+$/, '');
  const anyRead = Array.isArray(reads) && reads.some((r) => r.ok);
  const why = clipped ? `, because the request was refused: ${clipped}` : ', because the request was refused';
  const sentence = sanitizeModelText(`I could not ${standing.verb === 'count' ? 'count' : 'read'} that${why}. Nothing was read${anyRead ? ' from that table' : ''}.`);
  if (!anyRead) return sentence;
  // The refusal starts its own sentence: a reply cut mid-sentence (or one with no full stop) gets a full stop first.
  const body = text.trimEnd();
  return `${body}${/[.!?]$/.test(body) ? '' : '.'}\n${sentence}`;
}
