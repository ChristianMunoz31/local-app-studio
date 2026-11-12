import * as z from 'zod';
import { PAGE_WIDTHS } from '../../../../../src/catalog/enums.ts';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

export const pageDef: PartDefinition = {
  name: 'Page',
  group: 'layout',
  description: 'Top of every page. Holds the other parts. One per page, at the root.',
  props: () => z.strictObject({ width: z.enum(PAGE_WIDTHS).default('normal') }),
  children: 'parts',
  // Never a child of another part.
  childOf: [],
  binds: [],
  example: { id: 'root', type: 'Page', props: {}, children: [] },
};
