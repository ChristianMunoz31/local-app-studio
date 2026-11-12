import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { fieldIdsOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function quickAddProps(ctx: PartContext) {
  return z.strictObject({
    table: idEnum(ctx.tableIds),
    // The one text field the box fills.
    field: idEnum(fieldIdsOf(ctx, ctx.tableIds, { types: ['text'], editable: true })),
    placeholder: z.string().min(1).max(60).optional(),
    buttonLabel: z.string().min(1).max(LIMITS.labelChars).optional(),
  });
}

export const quickAddDef: PartDefinition = {
  name: 'QuickAdd',
  group: 'data',
  description: 'One box and an Add button that adds a record to a table, filling one text field.',
  props: quickAddProps,
  children: 'none',
  binds: [
    { prop: 'table', kind: 'table' },
    { prop: 'field', kind: 'field', of: 'table', fieldTypes: ['text'], editable: true },
  ],
  example: { id: 'quickadd_1', type: 'QuickAdd', props: { table: 'crews', field: 'name', placeholder: 'New crew name' }, children: [] },
};
