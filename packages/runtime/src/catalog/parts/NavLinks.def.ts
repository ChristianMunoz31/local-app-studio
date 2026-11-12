import * as z from 'zod';
import { linkablePageIds } from '../../../../../src/catalog/bindings.ts';
import { DIRECTIONS, ICON_DISPLAY, NAV_SHOW } from '../../../../../src/catalog/enums.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function navLinksProps(ctx: PartContext) {
  return z.strictObject({
    show: z.enum(NAV_SHOW).default('menu'),
    // Required when show is pages (checked by validateLayout).
    pages: z.array(idEnum(linkablePageIds(ctx))).min(1).max(8).optional(),
    direction: z.enum(DIRECTIONS).default('horizontal'),
    icons: z.enum(ICON_DISPLAY).default('show'),
  });
}

export const navLinksDef: PartDefinition = {
  name: 'NavLinks',
  group: 'action',
  description: 'Links to the pages of the app, in a row or a list. Shows the app menu pages, or 1 to 8 pages you name.',
  props: navLinksProps,
  children: 'parts',
  allowedChildren: ['Button', 'Link'],
  childCount: { min: 0, max: 3 },
  binds: [],
  example: { id: 'navlinks_1', type: 'NavLinks', props: { show: 'menu' }, children: [] },
};
