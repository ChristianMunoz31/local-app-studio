import * as z from 'zod';
import type { FieldType } from '../../spec/schema.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

/** The field types a FilterBar control exists for. */
export const FILTER_FIELD_TYPES: FieldType[] = ['select', 'boolean', 'date', 'datetime', 'reference'];

function filterBarProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    fields: z.array(idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'list'), { types: FILTER_FIELD_TYPES }))).min(1).max(4),
  });
}

export const filterBarDef: PartDefinition = {
  name: 'FilterBar',
  group: 'data',
  description: 'Filters for a list source on 1 to 4 select, yes/no, date or reference fields.',
  props: filterBarProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'fields', kind: 'fields', of: 'source', fieldTypes: FILTER_FIELD_TYPES },
  ],
  example: { id: 'filterbar_1', type: 'FilterBar', props: { source: 'open_crews', fields: ['status'] }, children: [] },
};
