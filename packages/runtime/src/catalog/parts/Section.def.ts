import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { iconSchema, SECTION_VARIANTS } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const sectionDef: PartDefinition = {
  name: 'Section',
  group: 'layout',
  description: 'A titled block grouping parts. Variant card is boxed, plain is open.',
  props: () =>
    z.strictObject({
      title: z.string().min(1).max(LIMITS.labelChars).optional(),
      subtitle: z.string().min(1).max(120).optional(),
      icon: iconSchema.optional(),
      variant: z.enum(SECTION_VARIANTS).default('card'),
    }),
  children: 'parts',
  binds: [],
  example: {
    id: 'section_1',
    type: 'Section',
    props: { title: 'Overview' },
    children: [{ id: 'text_1', type: 'Text', props: {}, children: 'Hello' }],
  },
};
