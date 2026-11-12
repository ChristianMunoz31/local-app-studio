import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { CALLOUT_TONES } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const calloutDef: PartDefinition = {
  name: 'Callout',
  group: 'layout',
  description: 'A colored box with a note, a success, a warning or a problem. Text is the message.',
  props: () =>
    z.strictObject({
      tone: z.enum(CALLOUT_TONES).default('note'),
      title: z.string().min(1).max(LIMITS.labelChars).optional(),
    }),
  children: 'text',
  binds: [],
  textDefault: 'Something worth knowing.',
  example: { id: 'callout_1', type: 'Callout', props: { tone: 'warning', title: 'Heads up' }, children: 'Paused crews are hidden.' },
};
