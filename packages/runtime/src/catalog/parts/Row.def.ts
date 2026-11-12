import * as z from 'zod';
import { GAPS, ROW_JUSTIFY, ROW_WRAP } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

/** Every part except Page, Tab, Column, Columns, Tabs and Section (a test derives this list from PART_NAMES). */
export const ROW_CHILDREN: string[] = [
  'Grid', 'Card', 'Heading', 'Text', 'Divider', 'DataTable', 'RecordForm', 'RecordDetail', 'StatCard', 'RecordList', 'FilterBar',
  'SearchBox', 'ReferencePicker', 'Button', 'Link', 'Row', 'NavLinks', 'Breadcrumb', 'BackLink', 'PageHeader', 'Callout',
  'Collapsible', 'Chart', 'ProgressBar', 'Timeline', 'Checklist', 'SortControl', 'QuickAdd',
];

export const rowDef: PartDefinition = {
  name: 'Row',
  group: 'layout',
  description: 'Small parts in one line, like a search box next to a button.',
  props: () =>
    z.strictObject({
      gap: z.enum(GAPS).default('sm'),
      justify: z.enum(ROW_JUSTIFY).default('start'),
      wrap: z.enum(ROW_WRAP).default('wrap'),
    }),
  children: 'parts',
  allowedChildren: ROW_CHILDREN,
  binds: [],
  example: {
    id: 'row_1',
    type: 'Row',
    props: { justify: 'between' },
    children: [
      { id: 'searchbox_1', type: 'SearchBox', props: { source: 'open_crews', fields: ['name'] }, children: [] },
      { id: 'button_1', type: 'Button', props: { action: { action: 'navigate', pageId: 'home', withRecord: false } }, children: 'Go home' },
    ],
  },
};
