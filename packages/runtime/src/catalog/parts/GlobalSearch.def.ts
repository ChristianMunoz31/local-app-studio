import * as z from 'zod';
import type { PartDefinition } from '../../../../../src/catalog/types.ts';

function globalSearchProps() {
  return z.strictObject({
    placeholder: z.string().min(1).max(60).optional(),
  });
}

export const globalSearchDef: PartDefinition = {
  name: 'GlobalSearch',
  group: 'data',
  description: 'One search box over every table that has text. Results are grouped by table and open the record.',
  props: globalSearchProps,
  children: 'none',
  // No binding: the server decides which tables and which record pages take part.
  binds: [],
  example: { id: 'globalsearch_1', type: 'GlobalSearch', props: {}, children: [] },
};
