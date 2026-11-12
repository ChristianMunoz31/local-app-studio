import * as z from 'zod';
import { COLUMN_ALIGNS, COLUMN_COUNT, COLUMN_LAYOUTS, GAPS } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const columnsDef: PartDefinition = {
  name: 'Columns',
  group: 'layout',
  description: 'Two to four columns side by side. Holds Column parts only; each Column holds the parts of that side.',
  props: () =>
    z.strictObject({
      layout: z.enum(COLUMN_LAYOUTS).default('equal'),
      gap: z.enum(GAPS).default('md'),
      align: z.enum(COLUMN_ALIGNS).default('top'),
    }),
  children: 'parts',
  allowedChildren: ['Column'],
  childCount: { min: COLUMN_COUNT.min, max: COLUMN_COUNT.max },
  binds: [],
  example: {
    id: 'columns_1',
    type: 'Columns',
    props: { layout: 'wide-left' },
    children: [
      { id: 'column_1', type: 'Column', props: {}, children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Left' }] },
      { id: 'column_2', type: 'Column', props: {}, children: [{ id: 'text_2', type: 'Text', props: {}, children: 'Right' }] },
    ],
  },
};
