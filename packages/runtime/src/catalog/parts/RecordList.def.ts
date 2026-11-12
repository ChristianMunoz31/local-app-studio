import * as z from 'zod';
import { actionSchema } from '../../../../../src/catalog/actions.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function recordListProps(ctx: PartContext) {
  const tables = sourceTablesOf(ctx, 'list');
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    // Left out: the table's title field.
    titleField: idEnum(fieldIdsOf(ctx, tables, { types: ['text', 'longtext', 'select'] })).optional(),
    subtitleField: idEnum(fieldIdsOf(ctx, tables)).optional(),
    badgeField: idEnum(fieldIdsOf(ctx, tables, { types: ['select'] })).optional(),
    rowAction: actionSchema(ctx).optional(),
    emptyText: z.string().min(1).max(120).optional(),
  });
}

export const recordListDef: PartDefinition = {
  name: 'RecordList',
  group: 'data',
  description: 'Rows of a list source as a list: title, subtitle, badge. rowAction runs on a row click.',
  props: recordListProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'titleField', kind: 'field', of: 'source', fieldTypes: ['text', 'longtext', 'select'] },
    { prop: 'subtitleField', kind: 'field', of: 'source' },
    { prop: 'badgeField', kind: 'field', of: 'source', fieldTypes: ['select'] },
    { prop: 'rowAction.pageId', kind: 'page' },
    { prop: 'rowAction.thenPageId', kind: 'page' },
  ],
  example: {
    id: 'recordlist_1',
    type: 'RecordList',
    props: { source: 'open_crews', titleField: 'name', badgeField: 'status' },
    children: [],
  },
};
