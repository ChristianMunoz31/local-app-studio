import * as z from 'zod';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const columnDef: PartDefinition = {
  name: 'Column',
  group: 'layout',
  description: 'One side of Columns. Holds any parts.',
  props: () => z.strictObject({}),
  children: 'parts',
  childOf: ['Columns'],
  binds: [],
  example: { id: 'column_1', type: 'Column', props: {}, children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Body' }] },
};
