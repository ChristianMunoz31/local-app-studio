// Derived indexes (ADR-014): the single column indexes a spec's pages ask for, on top of the reference indexes sql.js always
// makes. Pure and deterministic: the same spec gives the same list in the same order. Every identifier is a table or field id
// of the spec itself (already allowlisted by checkSpecShape); nothing here reads request input.
//
// To add a new source of indexes (phase 31 full text, for example) add a USES row or a tier, nothing else changes: sql.js and
// plan.js only consume the per table field lists this file returns.

/** Most indexes one table gets, reference indexes included. */
export const MAX_INDEXES_PER_TABLE = 8;

/** Which use wins when a table is over the cap: lower comes first. */
const TIER = Object.freeze({ sort: 0, filter: 1, group: 2, status: 3 });
const TIER_COUNT = 4;

/** Part type to the props that name a source and the fields of it that the part sorts, filters or groups on. */
const PART_USES = Object.freeze({
  SortControl: [{ tier: TIER.sort, source: 'source', fields: 'fields' }],
  FilterBar: [{ tier: TIER.filter, source: 'source', fields: 'fields' }],
  ReferencePicker: [{ tier: TIER.filter, source: 'source', fields: 'field' }],
  Chart: [{ tier: TIER.group, source: 'source', fields: 'groupBy' }],
});

/** Field types an index can serve: reference is indexed by sql.js already, longtext is too large to be worth one. */
const SKIP_TYPE = new Set(['reference', 'longtext']);

const MAX_LAYERS = 5000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

/** Every layer of a layout, parents before children, in order, bounded so a hostile layout cannot run long. */
function layers(root) {
  const out = [];
  const stack = isObject(root) ? [root] : [];
  while (stack.length && out.length < MAX_LAYERS) {
    const layer = stack.pop();
    out.push(layer);
    if (Array.isArray(layer.children)) {
      for (let i = layer.children.length - 1; i >= 0; i -= 1) {
        if (isObject(layer.children[i])) stack.push(layer.children[i]);
      }
    }
  }
  return out;
}

/**
 * The fields to index per table, beyond reference fields.
 *
 * Sources: the first orderBy field of a list source and the SortControl fields (sort), the where fields of a list source and
 * the FilterBar and ReferencePicker fields (filter), the Chart groupBy field of a non date type (group; a date group is
 * bucketed by an expression an index cannot serve), the field of a rule's `when` (status). Over the cap, sort beats filter
 * beats group beats status; inside one use, the first found wins (pages in spec order, sources, then parts top to bottom).
 * The winners are listed in field order.
 * @param {{ tables?: object[], pages?: object[] }} spec a normalized spec that passed checkSpecShape
 * @returns {Map<string, string[]>} table id to field ids; every table has an entry (maybe empty)
 */
export function derivedIndexFields(spec) {
  const tables = new Map((spec.tables ?? []).map((t) => [t.id, t]));
  /** @type {Map<string, string[][]>} */
  const wanted = new Map([...tables.keys()].map((id) => [id, Array.from({ length: TIER_COUNT }, () => [])]));
  const want = (tableId, tier, fieldId) => {
    if (typeof fieldId === 'string') wanted.get(tableId)?.[tier].push(fieldId);
  };

  for (const page of Array.isArray(spec.pages) ? spec.pages : []) {
    const sources = new Map();
    for (const src of Array.isArray(page?.sources) ? page.sources : []) {
      if (!isObject(src) || !tables.has(src.table)) continue;
      sources.set(src.id, src.table);
      if (src.mode === 'record') continue;
      const order = Array.isArray(src.orderBy) ? src.orderBy[0] : undefined;
      if (isObject(order)) want(src.table, TIER.sort, order.field);
      for (const cond of Array.isArray(src.where) ? src.where : []) {
        if (isObject(cond)) want(src.table, TIER.filter, cond.field);
      }
    }
    for (const layer of layers(page?.layout)) {
      const uses = Object.hasOwn(PART_USES, layer.type) ? PART_USES[layer.type] : [];
      const props = isObject(layer.props) ? layer.props : {};
      for (const use of uses) {
        const table = sources.get(props[use.source]);
        if (table === undefined) continue;
        for (const fieldId of asList(props[use.fields])) want(table, use.tier, fieldId);
      }
    }
  }

  const result = new Map();
  for (const [id, table] of tables) {
    for (const rule of Array.isArray(table.rules) ? table.rules : []) {
      if (isObject(rule) && isObject(rule.when)) want(id, TIER.status, rule.when.field);
    }
    const fields = new Map(table.fields.map((f) => [f.id, f]));
    const room = Math.max(0, MAX_INDEXES_PER_TABLE - table.fields.filter((f) => f.type === 'reference').length);
    const chosen = new Set();
    wanted.get(id).forEach((ids, tier) => {
      for (const fieldId of ids) {
        const field = fields.get(fieldId);
        if (!field || SKIP_TYPE.has(field.type)) continue;
        if (tier === TIER.group && (field.type === 'date' || field.type === 'datetime')) continue;
        if (chosen.size < room) chosen.add(fieldId);
      }
    });
    result.set(id, table.fields.filter((f) => chosen.has(f.id)).map((f) => f.id));
  }
  return result;
}
