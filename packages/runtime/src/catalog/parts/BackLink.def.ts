import * as z from 'zod';
import { navigateActionSchema } from '../../../../../src/catalog/actions.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function backLinkProps(ctx: PartContext) {
  const action = navigateActionSchema(ctx);
  const firstPage = ctx.pageIds[0];
  return z.strictObject({
    // A new back link goes to the first page until the author picks another.
    action: firstPage === undefined ? action : action.default({ action: 'navigate', pageId: firstPage, withRecord: false }),
  });
}

export const backLinkDef: PartDefinition = {
  name: 'BackLink',
  group: 'action',
  description: 'One link with an arrow that goes back to another page of this app. Text is the label.',
  props: backLinkProps,
  children: 'text',
  binds: [{ prop: 'action.pageId', kind: 'page' }],
  textDefault: 'Back',
  example: {
    id: 'backlink_1',
    type: 'BackLink',
    props: { action: { action: 'navigate', pageId: 'home', withRecord: false } },
    children: 'Back to crews',
  },
};
