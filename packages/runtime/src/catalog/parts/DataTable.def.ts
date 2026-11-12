import * as z from 'zod';
import { actionSchema } from '../../../../../src/catalog/actions.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { PAGE_SIZES } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function dataTableProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    // Left out: the first five fields of the source's table.
    columns: z.array(idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'list')))).min(1).max(8).optional(),
    rowAction: actionSchema(ctx).optional(),
    pageSize: z.literal([...PAGE_SIZES]).default(25),
    emptyText: z.string().min(1).max(120).optional(),
  });
}

export const dataTableDef: PartDefinition = {
  name: 'DataTable',
  group: 'data',
  description: 'Rows of a list source as a table. Up to 8 columns. rowAction runs on a row click.',
  props: dataTableProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'columns', kind: 'fields', of: 'source' },
    { prop: 'rowAction.pageId', kind: 'page' },
    { prop: 'rowAction.thenPageId', kind: 'page' },
  ],
  example: {
    id: 'datatable_1',
    type: 'DataTable',
    props: { source: 'open_crews', columns: ['name', 'size', 'status'], rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } },
    children: [],
  },
};
