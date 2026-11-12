import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { PROGRESS_STATS, PROGRESS_TARGET_MAX, toneSchema } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function progressBarProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx)),
    stat: z.enum(PROGRESS_STATS).default('count'),
    // Required for stat sum and for a record source (checked by validateLayout).
    field: idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx), { types: ['integer', 'real'] })).optional(),
    target: z.int().min(1).max(PROGRESS_TARGET_MAX).default(10),
    label: z.string().min(1).max(LIMITS.labelChars),
    tone: toneSchema.default('accent'),
  });
}

export const progressBarDef: PartDefinition = {
  name: 'ProgressBar',
  group: 'data',
  description: 'How close a count or a total is to a goal. The goal is a whole number; a record source needs a number field.',
  props: progressBarProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source' },
    { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['integer', 'real'] },
  ],
  example: {
    id: 'progressbar_1',
    type: 'ProgressBar',
    props: { source: 'open_crews', stat: 'count', field: 'size', target: 10, label: 'Crews this season' },
    children: [],
  },
};
