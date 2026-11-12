import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { CHART_KINDS, CHART_MEASURES, DATE_BUCKETS, GROUP_FIELD_TYPES } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function chartProps(ctx: PartContext) {
  const tables = sourceTablesOf(ctx, 'list');
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    kind: z.enum(CHART_KINDS).default('bar'),
    groupBy: idEnum(fieldIdsOf(ctx, tables, { types: GROUP_FIELD_TYPES })),
    measure: z.enum(CHART_MEASURES).default('count'),
    // Required unless measure is count (checked by validateLayout).
    field: idEnum(fieldIdsOf(ctx, tables, { types: ['integer', 'real'] })).optional(),
    // Only for date and datetime groups.
    bucket: z.enum(DATE_BUCKETS).default('month'),
    title: z.string().min(1).max(LIMITS.labelChars).optional(),
  });
}

export const chartDef: PartDefinition = {
  name: 'Chart',
  group: 'data',
  description: 'Bars or a line over a list source: count, or sum or avg of a number field, for each value of one field.',
  props: chartProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'groupBy', kind: 'field', of: 'source', fieldTypes: GROUP_FIELD_TYPES },
    { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['integer', 'real'] },
  ],
  example: {
    id: 'chart_1',
    type: 'Chart',
    props: { source: 'open_crews', groupBy: 'status', measure: 'count', field: 'size', title: 'Crews by status' },
    children: [],
  },
};
