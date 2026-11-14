import * as z from 'zod';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function kanbanProps(ctx: PartContext) {
  const tables = sourceTablesOf(ctx, 'list');
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    // The choice field whose options are the columns; moving a card sets it.
    field: idEnum(fieldIdsOf(ctx, tables, { types: ['select'], editable: true })),
    titleField: idEnum(fieldIdsOf(ctx, tables)).optional(),
    subtitleField: idEnum(fieldIdsOf(ctx, tables)).optional(),
    emptyText: z.string().min(1).max(120).optional(),
  });
}

export const kanbanDef: PartDefinition = {
  name: 'Kanban',
  group: 'data',
  description: 'Records of a list source as cards in columns, one column for each choice of a choice field. Moving a card sets that field.',
  props: kanbanProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['select'], editable: true },
    { prop: 'titleField', kind: 'field', of: 'source' },
    { prop: 'subtitleField', kind: 'field', of: 'source' },
  ],
  example: { id: 'kanban_1', type: 'Kanban', props: { source: 'open_crews', field: 'status', titleField: 'name' }, children: [] },
};
