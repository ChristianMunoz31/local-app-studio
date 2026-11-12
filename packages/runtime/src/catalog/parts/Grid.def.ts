import * as z from 'zod';
import { GAPS, GRID_COLUMNS } from '../../../../../src/catalog/enums.ts';
import { GRID_LIMITS, GRID_PLACEMENTS } from '../../spec/gridPlacement.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const gridDef: PartDefinition = {
  name: 'Grid',
  group: 'layout',
  description: 'Parts side by side in 1 to 4 columns.',
  props: () => z.strictObject({ columns: z.literal([...GRID_COLUMNS]).default(2), gap: z.enum(GAPS).default('md') }),
  designProps: () =>
    z.strictObject({
      columns: z.literal([...GRID_COLUMNS, GRID_LIMITS.columns]).default(2),
      gap: z.enum(GAPS).default('md'),
      placement: z.enum(GRID_PLACEMENTS).default('flow'),
      rows: z.int().min(1).max(GRID_LIMITS.maxRow).optional(),
    }),
  children: 'parts',
  binds: [],
  example: {
    id: 'grid_1',
    type: 'Grid',
    props: { columns: 2 },
    children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Left' }],
  },
};
