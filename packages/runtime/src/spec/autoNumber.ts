// Auto number: one text or integer field of a table is numbered by the runtime when a record is added (docs/APP_SPEC.md,
// "Auto number"). Pure and import free (ADR-006): the schema, the runtime server, the Studio and the importer read the same rules here.

export const AUTO_NUMBER_DEFAULTS: Readonly<{ prefix: ''; start: 1; width: 1 }> = Object.freeze({ prefix: '', start: 1, width: 1 } as const);

export interface AutoNumberConfig {
  field: string;
  kind: 'text' | 'integer';
  prefix: string;
  start: number;
  width: number;
}

const PREFIX_MAX = 20;
const WIDTH_MAX = 12;
const START_MAX = 999_999_999_999;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/** The block of one field read without trusting it, or null when it is malformed. */
function readBlock(field: Record<string, unknown>): AutoNumberConfig | null {
  const block = field.autoNumber;
  if (!isObject(block) || typeof field.id !== 'string') return null;
  if (block.start !== undefined && !isCount(block.start, 0, START_MAX)) return null;
  const start = typeof block.start === 'number' ? block.start : AUTO_NUMBER_DEFAULTS.start;
  if (field.type === 'integer') return { field: field.id, kind: 'integer', prefix: '', start, width: AUTO_NUMBER_DEFAULTS.width };
  if (field.type !== 'text') return null;
  if (block.prefix !== undefined && (typeof block.prefix !== 'string' || block.prefix.length > PREFIX_MAX)) return null;
  if (block.width !== undefined && !isCount(block.width, 1, WIDTH_MAX)) return null;
  return {
    field: field.id,
    kind: 'text',
    prefix: typeof block.prefix === 'string' ? block.prefix : AUTO_NUMBER_DEFAULTS.prefix,
    start,
    width: typeof block.width === 'number' ? block.width : AUTO_NUMBER_DEFAULTS.width,
  };
}

/** Does the field carry a numbering block? Such a field has no input, and a form or a quick add never sends it. */
export const isNumbered = (field: object): boolean => (field as { autoNumber?: unknown }).autoNumber != null;

/** The first well-formed numbered text or integer field of a table, or null. Never throws. */
export function readAutoNumber(table: unknown): AutoNumberConfig | null {
  if (!isObject(table) || !Array.isArray(table.fields)) return null;
  for (const field of table.fields) {
    if (!isObject(field)) continue;
    const cfg = readBlock(field);
    if (cfg !== null) return cfg;
  }
  return null;
}

/** A text field gets prefix + the number padded with zeros to `width` (wider numbers just grow); an integer field gets the number. */
export function formatAutoNumber(cfg: AutoNumberConfig, n: number): string | number {
  return cfg.kind === 'integer' ? n : cfg.prefix + String(n).padStart(cfg.width, '0');
}

/** The counter inside a stored value, or null when the value is not one this numbering could have given. */
export function parseAutoNumber(cfg: AutoNumberConfig, value: unknown): number | null {
  if (cfg.kind === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !value.startsWith(cfg.prefix)) return null;
  const rest = value.slice(cfg.prefix.length);
  if (!/^[0-9]+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isSafeInteger(n) ? n : null;
}

const usable = (n: number | null): n is number => n !== null && typeof n === 'number' && Number.isSafeInteger(n) && Number.isSafeInteger(n + 1);

/** The next counter: the highest of the start, the last handed out plus one and the highest stored plus one. A last that is not a safe integer counts as missing. */
export function nextCounter(cfg: AutoNumberConfig, last: number | null, maxStored: number | null): number {
  let n = cfg.start;
  if (usable(last) && last + 1 > n) n = last + 1;
  if (usable(maxStored) && maxStored + 1 > n) n = maxStored + 1;
  return n;
}

/** The app_state key of a counter. Both ids match ID_RE, so the key is never request text. */
export function autoNumberStateKey(table: string, field: string): string {
  return `autonumber.${table}.${field}`;
}

/** "INV-0001, INV-0002, INV-0003": the first three numbers, for the Data step. */
export function autoNumberExample(cfg: AutoNumberConfig): string {
  return [0, 1, 2].map((i) => String(formatAutoNumber(cfg, cfg.start + i))).join(', ');
}
