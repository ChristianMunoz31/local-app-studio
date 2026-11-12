import * as z from 'zod';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function searchBoxProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    fields: z.array(idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'list'), { types: ['text', 'longtext'] }))).min(1).max(4),
    placeholder: z.string().min(1).max(60).optional(),
  });
}

export const searchBoxDef: PartDefinition = {
  name: 'SearchBox',
  group: 'data',
  description: 'Search over 1 to 4 text fields of a list source.',
  props: searchBoxProps,
  // In the menu bar the runtime binds the box to the first list source of the page that is open.
  menuProps: () => z.strictObject({ placeholder: z.string().min(1).max(60).optional() }),
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'fields', kind: 'fields', of: 'source', fieldTypes: ['text', 'longtext'] },
  ],
  example: { id: 'searchbox_1', type: 'SearchBox', props: { source: 'open_crews', fields: ['name'] }, children: [] },
};
