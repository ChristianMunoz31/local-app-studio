import * as z from 'zod';
import { GAPS } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const dividerDef: PartDefinition = {
  name: 'Divider',
  group: 'layout',
  description: 'A thin line between blocks.',
  props: () => z.strictObject({ spacing: z.enum(GAPS).default('md') }),
  children: 'none',
  binds: [],
  example: { id: 'divider_1', type: 'Divider', props: {}, children: [] },
};
