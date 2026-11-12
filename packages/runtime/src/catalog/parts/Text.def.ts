import * as z from 'zod';
import { TEXT_SIZES, toneSchema } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const textDef: PartDefinition = {
  name: 'Text',
  group: 'layout',
  description: 'A short paragraph. Tone muted for helper text.',
  props: () =>
    z.strictObject({
      size: z.enum(TEXT_SIZES).default('md'),
      tone: toneSchema.default('neutral'),
    }),
  children: 'text',
  binds: [],
  textDefault: 'Text',
  example: { id: 'text_1', type: 'Text', props: { tone: 'muted' }, children: 'Crews and their leads.' },
};
