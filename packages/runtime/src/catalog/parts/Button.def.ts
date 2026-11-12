import * as z from 'zod';
import { actionSchema } from '../../../../../src/catalog/actions.ts';
import { BUTTON_SIZES, BUTTON_VARIANTS, iconSchema } from '../../../../../src/catalog/enums.ts';
import type { PartContext, PartDefinition } from '../../../../../src/catalog/types.ts';

function buttonProps(ctx: PartContext) {
  const action = actionSchema(ctx);
  const firstPage = ctx.pageIds[0];
  return z.strictObject({
    variant: z.enum(BUTTON_VARIANTS).default('primary'),
    size: z.enum(BUTTON_SIZES).default('md'),
    icon: iconSchema.optional(),
    // A new button navigates to the first page until the author picks something else.
    action: firstPage === undefined ? action : action.default({ action: 'navigate', pageId: firstPage, withRecord: false }),
  });
}

export const buttonDef: PartDefinition = {
  name: 'Button',
  group: 'action',
  description: 'Does one thing: go to a page, open a form, or delete the current record. Text is the label.',
  props: buttonProps,
  children: 'text',
  binds: [
    { prop: 'action.pageId', kind: 'page' },
    { prop: 'action.thenPageId', kind: 'page' },
  ],
  textDefault: 'Button',
  example: {
    id: 'button_1',
    type: 'Button',
    props: { action: { action: 'navigate', pageId: 'home', withRecord: false } },
    children: 'Go home',
  },
};
