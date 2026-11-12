import * as z from 'zod';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function recordDetailProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'record')),
    // Left out: every field of the source's table.
    fields: z.array(idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'record')))).min(1).max(30).optional(),
  });
}

export const recordDetailDef: PartDefinition = {
  name: 'RecordDetail',
  group: 'data',
  description: 'The fields of one record, from a record source on a /:id page.',
  props: recordDetailProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'record' },
    { prop: 'fields', kind: 'fields', of: 'source' },
  ],
  example: { id: 'recorddetail_1', type: 'RecordDetail', props: { source: 'one_crew' }, children: [] },
};
