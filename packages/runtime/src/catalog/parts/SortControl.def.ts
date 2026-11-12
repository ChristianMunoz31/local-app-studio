import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { SORT_FIELD_TYPES } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function sortControlProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    fields: z.array(idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'list'), { types: SORT_FIELD_TYPES }))).min(1).max(6),
    label: z.string().min(1).max(LIMITS.labelChars).optional(),
  });
}

export const sortControlDef: PartDefinition = {
  name: 'SortControl',
  group: 'data',
  description: 'Lets people choose how a list source is sorted, by 1 to 6 text, number, date or select fields.',
  props: sortControlProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'fields', kind: 'fields', of: 'source', fieldTypes: SORT_FIELD_TYPES },
  ],
  example: { id: 'sortcontrol_1', type: 'SortControl', props: { source: 'open_crews', fields: ['name', 'size'] }, children: [] },
};
