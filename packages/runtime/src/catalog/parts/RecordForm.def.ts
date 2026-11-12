import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { navigateActionSchema } from '../../../../../src/catalog/actions.ts';
import { fieldIdsOf, sourceIdsOf } from '../../../../../src/catalog/bindings.ts';
import { FORM_MODES } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function recordFormProps(ctx: PartContext) {
  return z.strictObject({
    table: idEnum(ctx.tableIds),
    mode: z.enum(FORM_MODES).default('create'),
    // Required for edit: the record source whose row the form changes.
    source: idEnum(sourceIdsOf(ctx, 'record')).optional(),
    // Left out: every field of the table.
    fields: z.array(idEnum(fieldIdsOf(ctx, ctx.tableIds, { editable: true }))).min(1).max(30).optional(),
    submitLabel: z.string().min(1).max(LIMITS.labelChars).optional(),
    afterSave: navigateActionSchema(ctx).optional(),
  });
}

export const recordFormDef: PartDefinition = {
  name: 'RecordForm',
  group: 'data',
  description: 'A form to add a record (create) or change the page record (edit, needs a record source).',
  props: recordFormProps,
  children: 'none',
  binds: [
    { prop: 'table', kind: 'table' },
    { prop: 'source', kind: 'source', mode: 'record' },
    { prop: 'fields', kind: 'fields', of: 'table', editable: true },
    { prop: 'afterSave.pageId', kind: 'page' },
  ],
  example: {
    id: 'recordform_1',
    type: 'RecordForm',
    props: { table: 'crews', fields: ['name', 'size', 'status'], submitLabel: 'Add crew' },
    children: [],
  },
};
