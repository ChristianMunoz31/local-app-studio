import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { iconSchema } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const pageHeaderDef: PartDefinition = {
  name: 'PageHeader',
  group: 'layout',
  description: 'A page title with an optional subtitle and up to three small parts beside it.',
  props: () =>
    z.strictObject({
      title: z.string().min(1).max(LIMITS.labelChars),
      subtitle: z.string().min(1).max(120).optional(),
      icon: iconSchema.optional(),
    }),
  children: 'parts',
  allowedChildren: ['Button', 'Link', 'QuickAdd'],
  childCount: { min: 0, max: 3 },
  binds: [],
  example: {
    id: 'pageheader_1',
    type: 'PageHeader',
    props: { title: 'Crews', subtitle: 'Everyone on a crew' },
    children: [{ id: 'button_1', type: 'Button', props: { action: { action: 'open-form', table: 'crews', mode: 'create' } }, children: 'New crew' }],
  },
};
