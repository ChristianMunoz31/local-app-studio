import * as z from 'zod';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { TIME_ORDERS } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function timelineProps(ctx: PartContext) {
  const tables = sourceTablesOf(ctx, 'list');
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    dateField: idEnum(fieldIdsOf(ctx, tables, { types: ['date', 'datetime'] })),
    titleField: idEnum(fieldIdsOf(ctx, tables)).optional(),
    subtitleField: idEnum(fieldIdsOf(ctx, tables)).optional(),
    order: z.enum(TIME_ORDERS).default('newest'),
    emptyText: z.string().min(1).max(120).optional(),
  });
}

export const timelineDef: PartDefinition = {
  name: 'Timeline',
  group: 'data',
  description: 'Records of a list source in date order, grouped by day. dateField is a date or datetime field.',
  props: timelineProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'dateField', kind: 'field', of: 'source', fieldTypes: ['date', 'datetime'] },
    { prop: 'titleField', kind: 'field', of: 'source' },
    { prop: 'subtitleField', kind: 'field', of: 'source' },
  ],
  example: { id: 'timeline_1', type: 'Timeline', props: { source: 'open_tasks', dateField: 'due', titleField: 'title' }, children: [] },
};
