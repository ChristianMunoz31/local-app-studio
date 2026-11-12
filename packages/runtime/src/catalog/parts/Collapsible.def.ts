import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { OPEN_STATES } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const collapsibleDef: PartDefinition = {
  name: 'Collapsible',
  group: 'layout',
  description: 'A titled block that opens and closes. Holds any parts; start says if it is open at first.',
  props: () =>
    z.strictObject({
      title: z.string().min(1).max(LIMITS.labelChars),
      start: z.enum(OPEN_STATES).default('closed'),
    }),
  children: 'parts',
  binds: [],
  example: {
    id: 'collapsible_1',
    type: 'Collapsible',
    props: { title: 'More details' },
    children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Extra notes for the team.' }],
  },
};
