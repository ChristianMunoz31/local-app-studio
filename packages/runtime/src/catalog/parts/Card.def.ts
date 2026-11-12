import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { CARD_VARIANTS, toneSchema } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const cardDef: PartDefinition = {
  name: 'Card',
  group: 'layout',
  description: 'A small tile with an optional title, inside a Section or Grid.',
  props: () =>
    z.strictObject({
      title: z.string().min(1).max(LIMITS.labelChars).optional(),
      tone: toneSchema.default('neutral'),
      variant: z.enum(CARD_VARIANTS).default('subtle'),
    }),
  children: 'parts',
  binds: [],
  example: {
    id: 'card_1',
    type: 'Card',
    props: { title: 'Note' },
    children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Details' }],
  },
};
