// Record validation for the generic data API and the Assistant's write tool: one place defines a valid record of a
// spec table (the FieldRules of the compiled spec), so the routes and the Assistant accept exactly the same input.
// Messages name the field label and never echo the value.
import { canonicalDate, canonicalTimestamp } from '../../../server/db/codec.js';
import { selectOne } from '../../../server/db/query.js';

const SERVER_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
const NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const INT_RE = /^-?\d+$/;
const MAX_REFERENCE_CHARS = 200;
const MAX_ECHO_KEY_CHARS = 64;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (field, message) => ({ ok: false, field, message });

/**
 * One field value to its stored form. Returns `{ ok: true, value }` (value may be null) or a message.
 * @param {{ type: string, label: string, required: boolean, maxLength?: number, options?: string[] }} rule
 * @param {unknown} raw
 */
function cleanValue(rule, raw) {
  const label = rule.label;
  if (raw === undefined) return { ok: false, message: `${label} is required.` };
  // A form sends '' for a field left empty: that means no value, except for text where '' is a value.
  const isText = rule.type === 'text' || rule.type === 'longtext';
  if (raw === null || (raw === '' && !isText)) {
    return rule.required ? { ok: false, message: `${label} is required.` } : { ok: true, value: null };
  }
  switch (rule.type) {
    case 'text':
    case 'longtext':
      if (typeof raw !== 'string') return { ok: false, message: `${label} must be text.` };
      if (rule.required && raw.trim() === '') return { ok: false, message: `${label} is required.` };
      if (rule.maxLength !== undefined && raw.length > rule.maxLength) {
        return { ok: false, message: `${label} must be ${rule.maxLength} characters or fewer.` };
      }
      return { ok: true, value: raw };
    case 'integer': {
      const n = typeof raw === 'string' && INT_RE.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (typeof n !== 'number' || !Number.isSafeInteger(n)) return { ok: false, message: `${label} must be a whole number.` };
      return { ok: true, value: n };
    }
    case 'real': {
      const n = typeof raw === 'string' && NUM_RE.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, message: `${label} must be a number.` };
      return { ok: true, value: n };
    }
    case 'boolean':
      if (raw === true || raw === 'true') return { ok: true, value: true };
      if (raw === false || raw === 'false') return { ok: true, value: false };
      return { ok: false, message: `${label} must be true or false.` };
    case 'date':
      if (typeof raw !== 'string') return { ok: false, message: `${label} must be a date like 2025-01-31.` };
      try {
        return { ok: true, value: canonicalDate(raw.trim(), label) };
      } catch {
        return { ok: false, message: `${label} must be a date like 2025-01-31.` };
      }
    case 'datetime':
      if (typeof raw !== 'string') return { ok: false, message: `${label} must be a date and time.` };
      try {
        return { ok: true, value: canonicalTimestamp(raw.trim(), label) };
      } catch {
        return { ok: false, message: `${label} must be a date and time.` };
      }
    case 'select':
      if (typeof raw !== 'string' || !(rule.options ?? []).includes(raw)) {
        return { ok: false, message: `${label} must be one of: ${(rule.options ?? []).join(', ')}.` };
      }
      return { ok: true, value: raw };
    case 'reference':
      if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_REFERENCE_CHARS) {
        return { ok: false, message: `${label} must be the id of a record.` };
      }
      return { ok: true, value: raw };
    default:
      return { ok: false, message: `${label} cannot be set.` };
  }
}

/**
 * Validates a record body against a spec table.
 * @param {{ validators: Record<string, Record<string, object>> }} compiled
 * @param {string} table
 * @param {unknown} input the request body or the Assistant's `values`
 * @param {{ partial?: boolean, autoField?: string | null }} [opts] partial: a PATCH, missing keys are left alone;
 *   autoField: the numbered field, which the runtime fills in, so a missing value is not reported
 * @returns {{ ok: true, row: Record<string, unknown> } | { ok: false, field: string, message: string }}
 */
export function validateRecord(compiled, table, input, { partial = false, autoField = null } = {}) {
  const rules = compiled?.validators?.[table];
  if (!rules) return fail('body', 'Unknown table.');
  if (!isPlainObject(input)) return fail('body', 'Send the record as a JSON object.');
  for (const key of Object.keys(input)) {
    if (SERVER_COLUMNS.has(key)) return fail(key, 'That value is set automatically.');
    // A key the table lacks is the client's own text: name it only when it is short, so a huge key is not sent back.
    if (!Object.hasOwn(rules, key)) return fail(key.length <= MAX_ECHO_KEY_CHARS ? key : 'body', 'This table has no such field.');
  }
  /** @type {Record<string, unknown>} */
  const row = {};
  for (const [id, rule] of Object.entries(rules)) {
    const present = Object.hasOwn(input, id) && input[id] !== undefined;
    if (!present) {
      if (!partial && rule.required && rule.default === undefined && id !== autoField) return fail(id, `${rule.label} is required.`);
      continue;
    }
    const cleaned = cleanValue(rule, input[id]);
    if (!cleaned.ok) return fail(id, cleaned.message);
    row[id] = cleaned.value;
  }
  return { ok: true, row };
}

/**
 * Checks that every reference in a validated row points at an existing record.
 * @param {{ validators: Record<string, Record<string, object>> }} compiled
 * @param {string} table
 * @param {Record<string, unknown>} row
 * @param {{ labels?: Record<string, string>, db?: import('node:sqlite').DatabaseSync }} [opts] labels: table id to label, for the message;
 *   db: the handle of the caller's transaction (M2), else the global one
 * @returns {{ ok: true } | { ok: false, field: string, message: string }}
 */
export function checkReferences(compiled, table, row, { labels = {}, db } = {}) {
  for (const [id, rule] of Object.entries(compiled?.validators?.[table] ?? {})) {
    const value = row[id];
    if (rule.type !== 'reference' || value === null || value === undefined) continue;
    if (!selectOne(rule.table, { columns: ['id'], where: { id: value }, db })) {
      return fail(id, `There is no ${labels[rule.table] ?? rule.table} record with that id.`);
    }
  }
  return { ok: true };
}
