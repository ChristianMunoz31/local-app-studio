import * as z from 'zod';
import { LIMITS } from '../../spec/schema.ts';
import { fieldIdsOf, sourceIdsOf, sourceTablesOf } from '../../../../../src/catalog/bindings.ts';
import { STATS, iconSchema, toneSchema } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function statCardProps(ctx: PartContext) {
  return z.strictObject({
    source: idEnum(sourceIdsOf(ctx, 'list')),
    stat: z.enum(STATS).default('count'),
    // Required unless stat is count (checked by validateLayout).
    field: idEnum(fieldIdsOf(ctx, sourceTablesOf(ctx, 'list'), { types: ['integer', 'real'] })).optional(),
    label: z.string().min(1).max(LIMITS.labelChars),
    tone: toneSchema.default('neutral'),
    icon: iconSchema.optional(),
  });
}

export const statCardDef: PartDefinition = {
  name: 'StatCard',
  group: 'data',
  description: 'One number over a list source: count, or sum, avg, min, max of a number field.',
  props: statCardProps,
  children: 'none',
  binds: [
    { prop: 'source', kind: 'source', mode: 'list' },
    { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['integer', 'real'] },
  ],
  example: {
    id: 'statcard_1',
    type: 'StatCard',
    props: { source: 'open_crews', stat: 'sum', field: 'size', label: 'People on crews' },
    children: [],
  },
};
