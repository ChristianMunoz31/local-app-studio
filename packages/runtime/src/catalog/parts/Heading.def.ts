import * as z from 'zod';
import { SIZES, toneSchema } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const headingDef: PartDefinition = {
  name: 'Heading',
  group: 'layout',
  description: 'A heading. The text is the label.',
  props: () =>
    z.strictObject({
      size: z.enum(SIZES).default('md'),
      tone: toneSchema.default('neutral'),
    }),
  children: 'text',
  binds: [],
  textDefault: 'Heading',
  example: { id: 'heading_1', type: 'Heading', props: { size: 'lg' }, children: 'Open crews' },
};
