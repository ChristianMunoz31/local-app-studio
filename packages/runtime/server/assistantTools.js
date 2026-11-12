// Assistant tools of a built app (runtime mode). The model sees four generic tools with a `table` enum
// (describe_data, list_records, get_stats, save_record); the agent rewrites each call to a canonical per-table name
// (`list_records__crews`) before validation, cloud policy, parking and persistence, so server/ai/privacy.js enforces
// one cloud category per table by tool name. Reads and writes use the same params, validate and stats code as the
// generic data API. Numbers come from describe_data counts, list totals and get_stats (code), never from the model.
// A link (reference) field holds an id: list rows add the linked record's title beside it, and a match or save value
// given as an exact title is resolved to the id in code (zero or several matches refuse, never guess).
import { count, op, select, selectOne } from '../../../server/db/index.js';
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';
import { sameValue } from '@local-app-studio/runtime/spec/rules.ts';
import { getAppSpec, getCompiledSpec } from '../../../server/spec/source.js';
import { RUNTIME_TABLE_VERBS, parseRuntimeToolName, runtimeToolName } from './toolNames.js';
import { columnRule, textFieldIds, validateFilters } from './params.js';
import { computeStats } from './stats.js';
import { checkReferences, validateRecord } from './validate.js';
import { createRecord, updateRecord } from './write.js';

export const MAX_TOOL_LIMIT = 100;
export const DEFAULT_TOOL_LIMIT = 25;
const MAX_DISPLAY_CHARS = 120;
const MAX_SEARCH_CHARS = 200;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const tool = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

/** @returns {string[]} the table ids of the compiled spec, parents first (empty without a spec) */
export function runtimeTableIds() {
  const compiled = getCompiledSpec();
  return compiled ? [...(compiled.importOrder ?? Object.keys(compiled.tables))] : [];
}

const labelsOf = () => Object.fromEntries((getAppSpec()?.tables ?? []).map((t) => [t.id, t.label]));

/** The numbered field of a table (the runtime fills it in), or null. */
const numberedFieldOf = (table) => readAutoNumber((getAppSpec()?.tables ?? []).find((t) => t.id === table));

const MATCH_DESC = 'Optional exact-match filter: an object of field id to value, for example {"status":"active"}.';

/**
 * The tools the model is offered. Without tables only describe_data exists.
 * @param {readonly string[]} tableIds
 */
export function buildRuntimeModelTools(tableIds) {
  const describe = tool('describe_data', 'Describe the tables and fields of this app. Call it when unsure which table holds what.');
  if (tableIds.length === 0) return [describe];
  const table = { type: 'string', enum: [...tableIds], description: 'The table id.' };
  return [
    describe,
    tool(
      'list_records',
      'List records of one table, newest first by default. Returns the total number of matching records and up to limit rows. Use total for any "how many" question.',
      {
        table,
        match: { type: 'object', description: MATCH_DESC },
        search: { type: 'string', description: 'Optional text to look for in the text fields.' },
        sort: { type: 'string', description: 'Optional field id to sort by.' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default desc, or asc with a sort field).' },
        limit: { type: 'integer', description: `How many rows to return (1 to ${MAX_TOOL_LIMIT}, default ${DEFAULT_TOOL_LIMIT}).` },
      },
      ['table'],
    ),
    tool(
      'get_stats',
      'Get precomputed counts and totals (count, sum, average, smallest, largest) for the number fields of one table. Use this for any "how many" or "how much" question.',
      { table, match: { type: 'object', description: MATCH_DESC } },
      ['table'],
    ),
    tool(
      'save_record',
      'Create a record (no id) or change one (with its id) in a table. The user is asked to confirm before anything is saved.',
      {
        table,
        id: { type: 'string', description: 'The id of the record to change. Omit it to create a new record.' },
        values: { type: 'object', description: 'Field id to value. For a change, only the fields that change.' },
      },
      ['table', 'values'],
    ),
  ];
}

/**
 * The per-table tool specs the agent validates canonical calls against: describe_data plus one spec per table and verb
 * with the same parameters as the model tools minus `table`.
 * @param {readonly string[]} tableIds
 */
export function buildRuntimeInternalTools(tableIds) {
  const labels = labelsOf();
  const generic = buildRuntimeModelTools(tableIds);
  const out = [generic[0]];
  for (const verb of RUNTIME_TABLE_VERBS) {
    const base = generic.find((t) => t.function.name === verb);
    if (!base) continue;
    for (const id of tableIds) {
      const properties = { ...base.function.parameters.properties };
      delete properties.table;
      out.push(
        tool(
          runtimeToolName(verb, id),
          `${base.function.description} Table: ${labels[id] ?? id}.`,
          properties,
          base.function.parameters.required.filter((k) => k !== 'table'),
        ),
      );
    }
  }
  return out;
}

/** The names of the canonical save tools: the runtime WRITE_TOOLS. */
export const runtimeWriteToolNames = (tableIds) => tableIds.map((id) => runtimeToolName('save_record', id));

/**
 * The spec plus one record count per table (computed in code), so a summary has real numbers to quote. No rows.
 * Under cloud, `allows` (the policy's category check, one category per table) leaves out the count of a withheld table.
 * @param {(table: string) => boolean} [allows] default: every table
 * @returns {{ app: string | null, tables: object[] }}
 */
export function describeData(allows = () => true) {
  const compiled = getCompiledSpec();
  const labels = labelsOf();
  const numbered = Object.fromEntries(runtimeTableIds().map((id) => [id, numberedFieldOf(id)?.field ?? null]));
  return {
    app: getAppSpec()?.app?.name ?? null,
    tables: runtimeTableIds().map((id) => ({
      id,
      label: labels[id] ?? id,
      ...(allows(id) ? { count: count(id) } : {}),
      fields: Object.entries(compiled.validators[id] ?? {}).map(([fid, r]) => ({
        id: fid,
        label: r.label,
        type: r.type,
        ...(r.required ? { required: true } : {}),
        ...(numbered[id] === fid ? { numbered: true } : {}),
        ...(r.options ? { options: r.options } : {}),
        ...(r.type === 'reference' ? { references: r.table } : {}),
      })),
    })),
  };
}

const clampLimit = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOOL_LIMIT) : DEFAULT_TOOL_LIMIT;
};

const TITLE_CANDIDATES = 200;

/**
 * Resolve a link value given as the exact display title of one linked record (case-insensitive, trimmed) to its id.
 * An existing id is kept. Anything that is not a non-empty string passes through for the normal validation.
 * @returns {{ ok: true, value: unknown } | { ok: false, reason: 'none' | 'several' | 'many', name: string, label: string, table: string }}
 */
function resolveLink(compiled, rule, value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: true, value };
  if (selectOne(rule.table, { where: { id: value } })) return { ok: true, value };
  const name = value.trim();
  const field = compiled.titleFields?.[rule.table];
  const candidates =
    !field || field === 'id'
      ? []
      : select(rule.table, { search: { term: name, columns: [field] }, orderBy: [{ column: 'id', dir: 'asc' }], limit: TITLE_CANDIDATES + 1, offset: 0 });
  const shown = name.slice(0, MAX_DISPLAY_CHARS);
  const refusal = (reason) => ({ ok: false, reason, name: shown, label: labelsOf()[rule.table] ?? rule.table, table: rule.table });
  // One past the cap means some containing records were not looked at: refuse rather than say none or pick one.
  if (candidates.length > TITLE_CANDIDATES) return refusal('many');
  const found = candidates.filter((r) => typeof r[field] === 'string' && r[field].trim().toLowerCase() === name.toLowerCase());
  if (found.length === 1) return { ok: true, value: found[0].id };
  return refusal(found.length === 0 ? 'none' : 'several');
}

const readRefusal = (r) =>
  r.reason === 'many'
    ? `Too many ${r.label} records contain ${r.name}, so nothing was read. Use the id from ${runtimeToolName('list_records', r.table)}.`
    : r.reason === 'none' ? `No ${r.label} record is called ${r.name}. Nothing was read.` : `Several ${r.label} records are called ${r.name}. Nothing was read.`;

const saveRefusal = (r) =>
  r.reason === 'many'
    ? `Too many ${r.label} records contain ${r.name}, so nothing was saved. Use the id from ${runtimeToolName('list_records', r.table)}.`
    : r.reason === 'none'
    ? `No ${r.label} record is called ${r.name}, so nothing was saved. Use ${runtimeToolName('list_records', r.table)} to find it.`
    : `Several ${r.label} records are called ${r.name}, so nothing was saved. Use ${runtimeToolName('list_records', r.table)} to find the right one.`;

// Small models send "5" for a number and "true" for a boolean: coerce those before the strict filter check.
function matchToFilters(compiled, table, match) {
  return Object.entries(match).map(([field, value]) => {
    const type = columnRule(compiled, table, field)?.type;
    if (typeof value === 'string' && (type === 'integer' || type === 'real') && /^-?\d+(\.\d+)?$/.test(value.trim())) {
      return { field, op: 'eq', value: Number(value.trim()) };
    }
    if (typeof value === 'string' && type === 'boolean' && (value === 'true' || value === 'false')) {
      return { field, op: 'eq', value: value === 'true' };
    }
    return { field, op: 'eq', value };
  });
}

const ALL_RECORDS_SCOPE = 'All records.';

// The match as applied (field id to the value the filter used) and one sentence saying the numbers cover only those records.
const SEARCH_TERM_SHOWN = 60;

function matchScope(compiled, table, filters, searchTerm) {
  const found = typeof searchTerm === 'string' ? searchTerm.trim().slice(0, SEARCH_TERM_SHOWN) : '';
  if (filters.length === 0) {
    return found
      ? { filter: null, scope: `Only records whose text contains ${found}. These are not totals of all records.` }
      : { filter: null, scope: ALL_RECORDS_SCOPE };
  }
  const filter = Object.fromEntries(filters.map((f) => [f.field, f.value]));
  const parts = filters.map((f) => {
    const rule = columnRule(compiled, table, f.field);
    return `${rule?.label ?? f.field} is ${rule ? displayValue(compiled, rule, f.value) : String(f.value)}`;
  });
  const text = found ? ` and whose text contains ${found}` : '';
  return { filter, scope: `Only records where ${parts.join(' and ')}${text}. These are not totals of all records.` };
}

function matchWhere(compiled, table, match) {
  if (match === undefined || match === null) return { ok: true, where: undefined, ...matchScope(compiled, table, []) };
  if (!isPlainObject(match)) return { ok: false, error: 'Argument "match" must be an object of field id to value.' };
  const linked = {};
  for (const [field, value] of Object.entries(match)) {
    const rule = columnRule(compiled, table, field);
    const r = rule?.type === 'reference' ? resolveLink(compiled, rule, value) : { ok: true, value };
    if (!r.ok) return { ok: false, error: readRefusal(r) };
    linked[field] = r.value;
  }
  const filters = matchToFilters(compiled, table, linked);
  const checked = validateFilters(compiled, table, filters, 'match');
  return checked.ok
    ? { ok: true, where: checked.where, filters, ...matchScope(compiled, table, filters) }
    : { ok: false, error: checked.message };
}

// Beside each link field's id, the linked record's title (`<field>_title`), from one batched lookup per linked table.
function withLinkTitles(compiled, table, rows) {
  const rules = compiled.validators[table] ?? {};
  const links = Object.entries(rules).filter(([fid, r]) => r.type === 'reference' && !Object.hasOwn(rules, `${fid}_title`));
  if (links.length === 0 || rows.length === 0) return rows;
  const titles = {};
  for (const [fid, rule] of links) {
    const ids = [...new Set(rows.map((r) => r[fid]).filter((v) => typeof v === 'string' && v !== ''))];
    const found = ids.length === 0 ? [] : select(rule.table, { where: { id: op.in(ids) }, limit: ids.length, offset: 0 });
    titles[fid] = new Map(found.map((t) => [t.id, titleOf(compiled, rule.table, t)]));
  }
  return rows.map((row) => {
    const out = { ...row };
    for (const [fid] of links) {
      if (typeof row[fid] === 'string' && titles[fid].has(row[fid])) out[`${fid}_title`] = titles[fid].get(row[fid]);
    }
    return out;
  });
}

function listRecords(compiled, table, args) {
  const m = matchWhere(compiled, table, args.match);
  if (!m.ok) return { error: m.error };
  let search;
  let scope = m.scope;
  if (typeof args.search === 'string' && args.search.trim() !== '') {
    const columns = textFieldIds(compiled, table);
    if (args.search.length > MAX_SEARCH_CHARS) return { error: `Argument "search" must be at most ${MAX_SEARCH_CHARS} characters.` };
    if (columns.length === 0) return { error: 'This table has no text field to search.' };
    search = { term: args.search, columns };
    scope = matchScope(compiled, table, m.filters ?? [], args.search).scope;
  }
  let sortField = 'created_at';
  let dir = 'desc';
  if (args.sort !== undefined) {
    if (!columnRule(compiled, table, args.sort)) return { error: 'Argument "sort" must be a field of this table.' };
    sortField = args.sort;
    dir = args.order === 'desc' ? 'desc' : 'asc';
  } else if (args.order === 'asc') {
    dir = 'asc';
  }
  const orderBy = [{ column: sortField, dir }, ...(sortField === 'id' ? [] : [{ column: 'id', dir: 'asc' }])];
  const rows = select(table, { where: m.where, search, orderBy, limit: clampLimit(args.limit), offset: 0 });
  return { table, total: count(table, { where: m.where, search }), filter: m.filter, scope, rows: withLinkTitles(compiled, table, rows) };
}

const titleOf = (compiled, table, ...sources) => {
  const field = compiled.titleFields?.[table];
  if (!field || field === 'id') return '(untitled)';
  for (const source of sources) {
    const v = source?.[field];
    if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, MAX_DISPLAY_CHARS);
  }
  return '(untitled)';
};

function displayValue(compiled, rule, value) {
  if (value === null || value === undefined) return '(empty)';
  if (rule.type === 'boolean') return value ? 'Yes' : 'No';
  if (rule.type === 'reference') {
    const target = selectOne(rule.table, { where: { id: value } });
    return titleOf(compiled, rule.table, target);
  }
  return String(value).slice(0, MAX_DISPLAY_CHARS);
}

/**
 * Validates a save and finds what it touches. Shared by the pre-park check and the executor.
 * @returns {{ ok: true, id?: string, row: Record<string, unknown>, existing: object | null } | { ok: false, error: string }}
 */
function prepareSave(compiled, table, args) {
  const id = args.id;
  if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) return { ok: false, error: 'Argument "id" must be the id of a record.' };
  let values = args.values;
  const numbered = numberedFieldOf(table)?.field ?? null;
  if (isPlainObject(values)) {
    values = { ...values };
    if (numbered !== null && Object.hasOwn(values, numbered)) {
      // The runtime numbers a record: a number the model echoes is dropped on a create, and a change to it is refused.
      if (id === undefined) delete values[numbered];
      else {
        const stored = selectOne(table, { where: { id } });
        if (stored && !sameValue(values[numbered], stored[numbered])) {
          return { ok: false, error: `${compiled.validators[table]?.[numbered]?.label ?? numbered} is numbered automatically and cannot be changed.` };
        }
        delete values[numbered];
      }
    }
    for (const [fid, value] of Object.entries(values)) {
      const rule = compiled.validators[table]?.[fid];
      if (rule?.type !== 'reference') continue;
      const r = resolveLink(compiled, rule, value);
      if (!r.ok) return { ok: false, error: saveRefusal(r) };
      values[fid] = r.value;
    }
  }
  const v = validateRecord(compiled, table, values, { partial: id !== undefined, autoField: numbered });
  if (!v.ok) return { ok: false, error: v.message };
  let existing = null;
  if (id !== undefined) {
    existing = selectOne(table, { where: { id } });
    if (!existing) return { ok: false, error: `There is no ${labelsOf()[table] ?? table} record with that id.` };
  }
  const refs = checkReferences(compiled, table, v.row, { labels: labelsOf() });
  if (!refs.ok) return { ok: false, error: refs.message };
  return { ok: true, ...(id !== undefined ? { id } : {}), row: v.row, existing };
}

/**
 * Check a canonical save before it is parked for the user's confirmation.
 * @param {string} name canonical tool name
 * @param {Record<string, unknown>} args { id?, values }
 * @returns {Promise<{ ok: true, args: Record<string, unknown>, label?: string } | { ok: false, error: string }>}
 */
export async function precheckRuntimeWrite(name, args = {}) {
  const compiled = getCompiledSpec();
  const parsed = compiled ? parseRuntimeToolName(name, runtimeTableIds()) : null;
  if (!compiled || !parsed || parsed.verb !== 'save_record') return { ok: true, args };
  const prep = prepareSave(compiled, parsed.table, args);
  if (!prep.ok) return prep;
  const rules = compiled.validators[parsed.table];
  const display = Object.keys(prep.row)
    .map((fid) => ({ label: rules[fid].label, value: displayValue(compiled, rules[fid], prep.row[fid]) }));
  const title = titleOf(compiled, parsed.table, prep.row, prep.existing);
  return {
    ok: true,
    args: { ...(prep.id !== undefined ? { id: prep.id } : {}), values: prep.row, title, display },
    label: title,
  };
}

/**
 * Run one runtime tool (describe_data or a canonical per-table name). Returns a result object; a bad call returns { error }.
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {{ allows?: (table: string) => boolean }} [opts] allows: under cloud, whether a table's category is shared (describe_data counts)
 */
export async function runRuntimeTool(name, args = {}, opts = {}) {
  if (name === 'describe_data') return describeData(opts.allows);
  const compiled = getCompiledSpec();
  const parsed = compiled ? parseRuntimeToolName(name, runtimeTableIds()) : null;
  if (!compiled || !parsed) return { error: `Unknown tool: ${name}` };
  const { verb, table } = parsed;
  if (verb === 'list_records') return listRecords(compiled, table, args);
  if (verb === 'get_stats') {
    const m = matchWhere(compiled, table, args.match);
    return m.ok ? { ...computeStats(compiled, table, { where: m.where }), filter: m.filter, scope: m.scope } : { error: m.error };
  }
  // save_record: the executor re-validates, because the data may have changed since it was parked.
  const prep = prepareSave(compiled, table, args);
  if (!prep.ok) return { error: prep.error };
  const spec = getAppSpec();
  const withApplied = (w, created) => ({ saved: w.row, created, ...(w.applied.length > 0 ? { applied: w.applied } : {}) });
  if (prep.id !== undefined) {
    const w = updateRecord({ compiled, spec, table, id: prep.id, body: prep.row });
    if (w.notFound) return { error: `There is no ${labelsOf()[table] ?? table} record with that id.` };
    return w.ok ? withApplied(w, false) : { error: w.message };
  }
  const w = createRecord({ compiled, spec, table, body: prep.row });
  return w.ok ? withApplied(w, true) : { error: w.message };
}
