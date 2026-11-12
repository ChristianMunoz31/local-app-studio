import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function referencePickerProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    field: idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'list'), { types: ['reference'] })),
    label: z.string().min(1).max(LIMITS.labelChars).optional(),
  });
}

export const referencePickerDef: PartDefinition = {
  name: 'ReferencePicker',
  group: 'data',
  description: 'A drop-down of the records a reference field points to; filters a list source.',
  props: referencePickerProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['reference'] },
  ],
  example: {
    id: 'referencepicker_1',
    type: 'ReferencePicker',
    props: { source: 'open_crews', field: 'lead_id', label: 'Lead' },
    children: [],
  },
};
