import * as z from 'zod';
import { linkablePageIds, sourceIdsOf } from '../../../../../src/catalog/bindings.ts';
import { idEnum } from '../../../../../src/catalog/ids.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function breadcrumbProps(ctx: PartContext) {
  return z.strictObject({
    // The list page the first crumb goes back to.
    page: idEnum(linkablePageIds(ctx)),
    // The record source whose title ends the trail; without one the current page title does.
    source: idEnum(sourceIdsOf(ctx, 'record')).optional(),
  });
}

export const breadcrumbDef: PartDefinition = {
  name: 'Breadcrumb',
  group: 'action',
  description: 'Shows where you are: a link back to a list page, then the record or page title.',
  props: breadcrumbProps,
  children: 'none',
  binds: [
    { prop: 'page', kind: 'page' },
    { prop: 'source', kind: 'source', mode: 'record' },
  ],
  example: { id: 'breadcrumb_1', type: 'Breadcrumb', props: { page: 'home', source: 'one_crew' }, children: [] },
};
