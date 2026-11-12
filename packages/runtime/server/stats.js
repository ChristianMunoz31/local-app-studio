// Counts and totals for a spec table, computed in code (the model never does arithmetic). query.js has no aggregates,
// so the numeric columns of the matching rows are read once and folded in JS. Fine for local tables up to the import cap.
import { count, groupStats, select } from '../../../server/db/query.js';

/**
 * @typedef {{ count: number, sum: number, avg: number | null, min: number | null, max: number | null }} FieldStats
 * @typedef {{ table: string, count: number, fields: Record<string, FieldStats> }} TableStats
 */

/**
 * @param {{ validators: Record<string, Record<string, { type: string }>> }} compiled
 * @param {string} table a table id of the compiled spec
 * @param {{ where?: object, search?: { term: string, columns: string[] } }} [query]
 * @returns {TableStats}
 */
export function computeStats(compiled, table, { where, search } = {}) {
  const numeric = Object.entries(compiled.validators[table] ?? {})
    .filter(([, rule]) => rule.type === 'integer' || rule.type === 'real')
    .map(([id]) => id);
  /** @type {Record<string, FieldStats>} */
  const fields = {};
  const total = count(table, { where, search });
  if (numeric.length > 0) {
    const rows = total > 0 ? select(table, { columns: numeric, where, search }) : [];
    for (const id of numeric) {
      let n = 0;
      let sum = 0;
      let min = null;
      let max = null;
      for (const row of rows) {
        const v = row[id];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        n += 1;
        sum += v;
        if (min === null || v < min) min = v;
        if (max === null || v > max) max = v;
      }
      fields[id] = { count: n, sum, avg: n > 0 ? sum / n : null, min, max };
    }
  }
  return { table, count: total, fields };
}

// The most groups a chart shows; the rest become one "other" row. A test pins this equal to MAX_CHART_GROUPS in
// src/catalog/enums.ts (the runtime server cannot import the catalog).
export const MAX_GROUPS = 12;

/**
 * Count, sum or average for each value of one field, with the groups beyond MAX_GROUPS folded into `other`. Dates keep
 * the latest buckets in ascending order; everything else the largest groups by count.
 * @param {object} compiled
 * @param {string} table
 * @param {{ where?: object, search?: { term: string, columns: string[] },
 *   group: { groupBy: string, type: string, measure: string, field?: string, bucket?: string } }} query
 * @returns {{ table: string, count: number, groups: Array<{ key: string | boolean | null, count: number, value: number | null }>,
 *   other: { groups: number, count: number, value: number | null } | null }}
 */
export function computeGroups(compiled, table, { where, search, group }) {
  const dated = group.bucket !== undefined;
  const { groups, total } = groupStats(table, {
    column: group.groupBy,
    bucket: group.bucket,
    measureColumn: group.measure === 'count' ? undefined : group.field,
    where,
    search,
    order: dated ? 'key-desc' : 'count',
    limit: MAX_GROUPS,
  });
  const valueOf = (count, sum, n) => (group.measure === 'count' ? count : group.measure === 'sum' ? sum : n > 0 ? sum / n : null);
  // Dates read oldest to newest; a group with no date comes last.
  const shown = dated ? [...groups.filter((g) => g.key !== null).reverse(), ...groups.filter((g) => g.key === null)] : groups;
  const rest = { count: total.count, sum: total.sum, n: total.n };
  for (const g of groups) {
    rest.count -= g.count;
    rest.sum -= g.sum;
    rest.n -= g.n;
  }
  const hidden = total.groups - groups.length;
  return {
    table,
    count: total.count,
    groups: shown.map((g) => ({ key: g.key, count: g.count, value: valueOf(g.count, g.sum, g.n) })),
    other: hidden > 0 ? { groups: hidden, count: rest.count, value: valueOf(rest.count, rest.sum, rest.n) } : null,
  };
}
