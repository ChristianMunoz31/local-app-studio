import * as z from 'zod';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const tabsDef: PartDefinition = {
  name: 'Tabs',
  group: 'layout',
  description: 'Switchable panels. Holds Tab parts only.',
  props: () => z.strictObject({}),
  children: 'parts',
  allowedChildren: ['Tab'],
  binds: [],
  example: {
    id: 'tabs_1',
    type: 'Tabs',
    props: {},
    children: [
      { id: 'tab_1', type: 'Tab', props: { label: 'First' }, children: [{ id: 'text_1', type: 'Text', props: {}, children: 'One' }] },
    ],
  },
};
