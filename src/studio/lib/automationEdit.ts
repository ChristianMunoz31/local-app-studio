// Edits of a table's automations for the Data step: the numbered field and the rules (DESIGN-phase28.md 1.5, 3.4, F1).
// Pure: no React, nothing is mutated. A rule is added or removed, never edited in place.
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber';
import type { Rule } from '@local-app-studio/runtime/spec/rules';
import type { Field, Table } from '@local-app-studio/runtime/spec/schema';

/** What a person sets on the numbered field: text takes all three, a whole number only where it starts. */
export interface NumberingChoice {
  prefix?: string;
  start?: number;
  width?: number;
}

const rulesOf = (table: Table): Rule[] => (Array.isArray(table.rules) ? table.rules : []);

const without = <T extends object>(value: T, key: string): T => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as T;

/** The table with the field numbered by the runtime (or, with null, no field numbered). Only one field is numbered, and it has no default. */
export function setAutoNumber(table: Table, fieldId: string, cfg: NumberingChoice | null): Table {
  const fields = table.fields.map((f): Field => {
    if (f.id !== fieldId) return without(f, 'autoNumber');
    if (cfg === null || (f.type !== 'text' && f.type !== 'integer')) return without(f, 'autoNumber');
    const block = f.type === 'text' ? { prefix: cfg.prefix, start: cfg.start, width: cfg.width } : { start: cfg.start };
    const clean = Object.fromEntries(Object.entries(block).filter(([, v]) => v !== undefined));
    return { ...without(f, 'default'), autoNumber: clean } as unknown as Field;
  });
  return { ...table, fields };
}

/** The table with a rule added at the end. */
export function addRule(table: Table, rule: Rule): Table {
  return { ...table, rules: [...rulesOf(table), rule] };
}

/** The table without its rule number `index`; an empty list leaves no `rules` key. */
export function removeRule(table: Table, index: number): Table {
  const rules = rulesOf(table).filter((_, i) => i !== index);
  return rules.length === 0 ? without(table, 'rules') : { ...table, rules };
}

/**
 * The table without the actions that name a missing field, and without a rule whose `when` field is missing or that has no action
 * left. `removed` counts the automations dropped or shortened.
 */
export function removeBrokenRules(table: Table): { table: Table; removed: number } {
  const has = (id: string): boolean => table.fields.some((f) => f.id === id);
  const kept: Rule[] = [];
  let removed = 0;
  for (const rule of rulesOf(table)) {
    const then = has(rule.when.field) ? rule.then.filter((a) => has(a.set) && (typeof a.to !== 'object' || !('field' in a.to) || has(a.to.field))) : [];
    if (then.length !== rule.then.length) removed += 1;
    if (then.length > 0) kept.push({ ...rule, then });
  }
  if (removed === 0) return { table, removed };
  return { table: kept.length === 0 ? without(table, 'rules') : { ...table, rules: kept }, removed };
}

/** The fields a rule may set: not the numbered field and not the field the rule watches. */
export function ruleTargets(table: Table, whenField: string | null): Field[] {
  const numbered = readAutoNumber(table)?.field ?? null;
  return table.fields.filter((f) => f.id !== numbered && f.id !== whenField);
}

/** The fields a rule can watch: a choice or a tick box. */
export function ruleWatchable(table: Table): Field[] {
  return table.fields.filter((f) => f.type === 'select' || f.type === 'boolean');
}
