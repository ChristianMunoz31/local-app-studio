import * as z from 'zod';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function checklistProps(ctx: PartContext) {
  const tables = sourceTablesOf(ctx, 'list');
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    // The yes/no field a tick sets.
    field: idEnum(fieldIdsOf(ctx, tables, { types: ['boolean'], editable: true })),
    titleField: idEnum(fieldIdsOf(ctx, tables)).optional(),
    emptyText: z.string().min(1).max(120).optional(),
  });
}

export const checklistDef: PartDefinition = {
  name: 'Checklist',
  group: 'data',
  description: 'Records of a list source with a box to tick. Ticking sets a yes/no field of the record.',
  props: checklistProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['boolean'], editable: true },
    { prop: 'titleField', kind: 'field', of: 'source' },
  ],
  example: { id: 'checklist_1', type: 'Checklist', props: { source: 'open_tasks', field: 'done', titleField: 'title' }, children: [] },
};
