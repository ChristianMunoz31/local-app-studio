import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const tabDef: PartDefinition = {
  name: 'Tab',
  group: 'layout',
  description: 'One panel of Tabs. The label is the tab button.',
  props: () => z.strictObject({ label: z.string().min(1).max(LIMITS.labelChars) }),
  children: 'parts',
  childOf: ['Tabs'],
  binds: [],
  example: {
    id: 'tab_1',
    type: 'Tab',
    props: { label: 'Details' },
    children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Body' }],
  },
};
