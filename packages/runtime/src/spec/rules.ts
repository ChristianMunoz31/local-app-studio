// Rules on a status change (docs/APP_SPEC.md, "Rules"): when a select or tick box of a table becomes a value, the runtime sets
// other fields of the same record. Pure (ADR-006): the schema, the runtime server, the Assistant tools and the Studio read the
// same checks, sentences and engine here. It must not import schema.ts (the runtime bundle refuses it), so the rule types live here.
import { readAutoNumber } from './autoNumber.ts';

export type RuleTo = 'today' | 'now' | 'clear' | { value: string | number | boolean } | { field: string };
export interface RuleAction {
  set: string;
  to: RuleTo;
}
export interface Rule {
  when: { field: string; is: string | boolean };
  then: RuleAction[];
}

export interface RuleFieldInfo {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: readonly string[];
  default?: unknown;
  table?: string;
}
export interface RuleTableInfo {
  id: string;
  label: string;
  fields: readonly RuleFieldInfo[];
  rules?: unknown;
}
export interface AppliedRule {
  field: string;
  label: string;
  to: 'today' | 'now' | 'clear' | 'value' | 'field';
  words: string;
}
export type RuleProblemCode = 'rule_field_missing' | 'rule_not_allowed';
export interface RuleProblem {
  at: string;
  code: RuleProblemCode;
}

const RULES_PER_TABLE = 20;
const RULE_ACTIONS = 5;
const TEXT_CHARS = 500;
const LONGTEXT_CHARS = 20000;
const OPTION_CHARS = 60;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const NUL = '\u0000';

function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isIsoDateTime(v: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(v);
  if (!m) return false;
  return isIsoDate(m[1]) && Number(m[2]) <= 23 && Number(m[3]) <= 59 && (m[4] === undefined || Number(m[4]) <= 59);
}

/** True when a literal fits the field (the same fit the spec's source conditions and defaults need). */
function literalFits(field: RuleFieldInfo, v: unknown): boolean {
  switch (field.type) {
    case 'text':
      return typeof v === 'string' && v.length <= TEXT_CHARS && !v.includes(NUL);
    case 'longtext':
      return typeof v === 'string' && v.length <= LONGTEXT_CHARS && !v.includes(NUL);
    case 'integer':
      return typeof v === 'number' && Number.isSafeInteger(v);
    case 'real':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'date':
      return typeof v === 'string' && isIsoDate(v);
    case 'datetime':
      return typeof v === 'string' && isIsoDateTime(v);
    case 'select':
      return typeof v === 'string' && (field.options ?? []).includes(v);
    default:
      return false;
  }
}

const isTextual = (type: string): boolean => type === 'text' || type === 'longtext';

/** Can a value of `from` be copied into `to`? Same type, or text from text, longtext or select; a link only to the same table. */
function copyFits(to: RuleFieldInfo, from: RuleFieldInfo): boolean {
  if (to.type === 'reference') return from.type === 'reference' && from.table === to.table;
  if (to.type === from.type) return true;
  return isTextual(to.type) && (isTextual(from.type) || from.type === 'select');
}

/**
 * The checks of one rule. `at` is the path below the rule ("when.field", "then.0.to.field"); schema.ts checkTables and
 * readRules both call this, so they cannot drift. `numberedField` is the table's auto number field, which no rule may set.
 */
export function ruleProblems(table: RuleTableInfo, rule: Rule, numberedField: string | null): RuleProblem[] {
  const out: RuleProblem[] = [];
  const byId = new Map(table.fields.map((f) => [f.id, f]));
  const when = byId.get(rule.when.field);
  if (!when) out.push({ at: 'when.field', code: 'rule_field_missing' });
  else if (when.type !== 'select' && when.type !== 'boolean') out.push({ at: 'when.field', code: 'rule_not_allowed' });
  else if (when.type === 'select' ? typeof rule.when.is !== 'string' || !(when.options ?? []).includes(rule.when.is) : typeof rule.when.is !== 'boolean') {
    out.push({ at: 'when.is', code: 'rule_not_allowed' });
  }
  rule.then.forEach((action, a) => {
    const at = `then.${a}`;
    const target = byId.get(action.set);
    if (!target) out.push({ at: `${at}.set`, code: 'rule_field_missing' });
    else if (action.set === numberedField || action.set === rule.when.field) out.push({ at: `${at}.set`, code: 'rule_not_allowed' });
    const to = action.to;
    if (to === 'today' || to === 'now' || to === 'clear') {
      if (!target) return;
      const ok = to === 'today' ? target.type === 'date' : to === 'now' ? target.type === 'datetime' : target.required !== true;
      if (!ok) out.push({ at: `${at}.to`, code: 'rule_not_allowed' });
    } else if ('value' in to) {
      if (target && (target.type === 'reference' || !literalFits(target, to.value))) out.push({ at: `${at}.to.value`, code: 'rule_not_allowed' });
    } else {
      const source = byId.get(to.field);
      if (!source) out.push({ at: `${at}.to.field`, code: 'rule_field_missing' });
      else if (to.field === numberedField) out.push({ at: `${at}.to.field`, code: 'rule_not_allowed' });
      else if (target && !copyFits(target, source)) out.push({ at: `${at}.to.field`, code: 'rule_not_allowed' });
    }
  });
  return out;
}

/** The same `when` (field and value) setting the same field twice, across the rules in order. Returns the rule index and `at` of each later one. */
export function duplicateActions(rules: readonly Rule[]): Array<{ rule: number; at: string }> {
  const seen = new Map<string, Set<string>>();
  const out: Array<{ rule: number; at: string }> = [];
  rules.forEach((rule, r) => {
    const key = `${rule.when.field}\u0001${typeof rule.when.is}\u0001${String(rule.when.is)}`;
    let set = seen.get(key);
    if (!set) seen.set(key, (set = new Set()));
    rule.then.forEach((action, a) => {
      if (set.has(action.set)) out.push({ rule: r, at: `then.${a}.set` });
      set.add(action.set);
    });
  });
  return out;
}

function readTo(to: unknown): RuleTo | null {
  if (to === 'today' || to === 'now' || to === 'clear') return to;
  if (!isObject(to)) return null;
  const keys = Object.keys(to);
  if (keys.length !== 1) return null;
  if (keys[0] === 'field' && typeof to.field === 'string') return { field: to.field };
  if (keys[0] === 'value' && (typeof to.value === 'string' || typeof to.value === 'number' || typeof to.value === 'boolean')) return { value: to.value };
  return null;
}

/** One rule read without trusting it, or null when its shape is wrong. */
function readRuleShape(raw: unknown): Rule | null {
  if (!isObject(raw) || !isObject(raw.when) || !Array.isArray(raw.then)) return null;
  const { field, is } = raw.when;
  if (typeof field !== 'string' || (typeof is !== 'string' && typeof is !== 'boolean')) return null;
  if (typeof is === 'string' && (is.length < 1 || is.length > OPTION_CHARS)) return null;
  if (raw.then.length < 1 || raw.then.length > RULE_ACTIONS) return null;
  const then: RuleAction[] = [];
  for (const a of raw.then) {
    if (!isObject(a) || typeof a.set !== 'string') return null;
    const to = readTo(a.to);
    if (to === null) return null;
    then.push({ set: a.set, to });
  }
  return { when: { field, is }, then };
}

/** The rules of a table the engine may run: tolerant (a malformed rule, or one ruleProblems refuses, is dropped), at most 20. */
export function readRules(table: RuleTableInfo): Rule[] {
  const raw = isObject(table) && Array.isArray(table.rules) ? table.rules : [];
  const numbered = readAutoNumber(table)?.field ?? null;
  const kept: Rule[] = [];
  for (const item of raw.slice(0, RULES_PER_TABLE)) {
    const rule = readRuleShape(item);
    if (rule === null || ruleProblems(table, rule, numbered).length > 0) continue;
    if (duplicateActions([...kept, rule]).length > 0) continue;
    kept.push(rule);
  }
  return kept;
}

/** Equal after both are cleaned and decoded: null and undefined are the same, everything else compares as text (H1). */
export function sameValue(a: unknown, b: unknown): boolean {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn;
  return String(a) === String(b);
}

/** YYYY-MM-DD from the local calendar date (the `date` field encoding). */
export function localDate(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

/** "Paid on was set to today." and its four siblings. */
export function appliedWords(label: string, to: RuleTo, otherLabel?: string): string {
  if (to === 'today') return `${label} was set to today.`;
  if (to === 'now') return `${label} was set to now.`;
  if (to === 'clear') return `${label} was cleared.`;
  if ('value' in to) return `${label} was set to ${typeof to.value === 'boolean' ? yesNo(to.value) : String(to.value)}.`;
  return `${label} was copied from ${otherLabel ?? to.field}.`;
}

const kindOf = (to: RuleTo): AppliedRule['to'] => (typeof to === 'string' ? to : 'value' in to ? 'value' : 'field');

/**
 * What the rules of a table change on one write. `given` is the person's cleaned values, `before` the stored row (null on a
 * new record). A rule never sets a key the person changed in this write (their own value wins), in one pass with no chain.
 */
export function applyRules(input: {
  table: RuleTableInfo;
  before: Record<string, unknown> | null;
  given: Record<string, unknown>;
  now: Date;
}): { changes: Record<string, unknown>; applied: AppliedRule[] } {
  const { table, before, given, now } = input;
  const rules = readRules(table);
  const changes: Record<string, unknown> = {};
  let applied: AppliedRule[] = [];
  if (rules.length === 0) return { changes, applied };
  const byId = new Map(table.fields.map((f) => [f.id, f]));
  const defaults: Record<string, unknown> = {};
  for (const f of table.fields) if (f.default !== undefined) defaults[f.id] = f.default;
  const has = (key: string): boolean => Object.hasOwn(given, key);
  const own = (key: string): boolean =>
    before === null ? has(key) && given[key] !== null && given[key] !== '' : has(key) && !sameValue(given[key], before[key]);
  const after: Record<string, unknown> = { ...(before ?? defaults), ...given };
  for (const rule of rules) {
    const f = rule.when.field;
    const fires =
      before === null
        ? (has(f) && given[f] !== null && given[f] !== undefined ? given[f] : defaults[f]) === rule.when.is
        : has(f) && given[f] === rule.when.is && !sameValue(before[f], rule.when.is);
    if (!fires) continue;
    for (const action of rule.then) {
      if (own(action.set)) continue;
      const label = byId.get(action.set)?.label ?? action.set;
      const to = action.to;
      let value: unknown;
      let other: string | undefined;
      if (to === 'today') value = localDate(now);
      else if (to === 'now') value = now.toISOString();
      else if (to === 'clear') value = null;
      else if ('value' in to) value = to.value;
      else {
        value = after[to.field] ?? null;
        other = byId.get(to.field)?.label ?? to.field;
      }
      changes[action.set] = value;
      applied = applied.filter((x) => x.field !== action.set);
      applied.push({ field: action.set, label, to: kindOf(to), words: appliedWords(label, to, other) });
    }
  }
  return { changes, applied };
}

/** "When Status becomes Paid, set Paid on to today." for the Data step and the review bullets. */
export function ruleSentence(table: RuleTableInfo, rule: Rule): string {
  const label = (id: string): string => table.fields.find((f) => f.id === id)?.label ?? id;
  const w = rule.when;
  const head = typeof w.is === 'boolean' ? `When ${label(w.field)} is ${w.is ? 'ticked' : 'unticked'}` : `When ${label(w.field)} becomes ${w.is}`;
  const actions = rule.then.map((a) => {
    const to = a.to;
    if (to === 'clear') return `clear ${label(a.set)}`;
    if (to === 'today' || to === 'now') return `set ${label(a.set)} to ${to}`;
    if ('value' in to) return `set ${label(a.set)} to ${typeof to.value === 'boolean' ? yesNo(to.value) : String(to.value)}`;
    return `set ${label(a.set)} to the value of ${label(to.field)}`;
  });
  return `${head}, ${actions.join(', and ')}.`;
}

type Loose = Record<string, unknown>;

function mapTables(spec: unknown, fn: (table: Loose) => Loose): unknown {
  if (!isObject(spec) || !Array.isArray(spec.tables)) return spec;
  return { ...spec, tables: spec.tables.map((t) => (isObject(t) ? fn(t) : t)) };
}

/** A copy of the spec with every `autoNumber` and `rules` key removed: the helper's prompt and schema never see them. */
export function withoutAutomations<T>(spec: T): T {
  return mapTables(spec, (table) => {
    const { rules: _rules, ...rest } = table;
    void _rules;
    const fields = Array.isArray(rest.fields)
      ? rest.fields.map((f: unknown) => {
          if (!isObject(f) || !('autoNumber' in f)) return f;
          const { autoNumber: _auto, ...keep } = f;
          void _auto;
          return keep;
        })
      : rest.fields;
    return { ...rest, fields };
  }) as T;
}

/**
 * Puts the automations of the base design back onto a helper's proposal (M7). A numbering is kept on the field with the same id when
 * that field has no default and the same type (text to integer keeps only `start`); a rule is kept when readRules still accepts it.
 */
export function keepAutomations<T>(proposal: T, base: T): T {
  if (!isObject(base) || !Array.isArray(base.tables)) return proposal;
  const baseTables = new Map<string, Loose>();
  for (const t of base.tables) if (isObject(t) && typeof t.id === 'string') baseTables.set(t.id, t);
  return mapTables(proposal, (table) => {
    const from = typeof table.id === 'string' ? baseTables.get(table.id) : undefined;
    if (!from || !Array.isArray(table.fields)) return table;
    let fields: unknown[] = table.fields;
    const cfg = readAutoNumber(from);
    if (cfg !== null && !fields.some((f) => isObject(f) && isObject(f.autoNumber))) {
      const block = (Array.isArray(from.fields) ? from.fields : []).find((f) => isObject(f) && f.id === cfg.field) as Loose | undefined;
      const rawBlock = isObject(block?.autoNumber) ? (block.autoNumber as Loose) : {};
      fields = fields.map((f) => {
        if (!isObject(f) || f.id !== cfg.field || f.default !== undefined) return f;
        if (f.type === cfg.kind) return { ...f, autoNumber: { ...rawBlock } };
        if (cfg.kind === 'text' && f.type === 'integer') return { ...f, autoNumber: rawBlock.start === undefined ? {} : { start: rawBlock.start } };
        return f;
      });
    }
    let next: Loose = { ...table, fields };
    const baseRules = Array.isArray(from.rules) ? from.rules : [];
    const kept: unknown[] = [];
    for (const rule of baseRules) {
      const trial = { ...next, rules: [...kept, rule] } as unknown as RuleTableInfo;
      if (readRules(trial).length === kept.length + 1) kept.push(rule);
    }
    if (kept.length > 0) next = { ...next, rules: kept };
    return next;
  }) as T;
}
