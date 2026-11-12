// Declarative actions (docs/CATALOG.md). No action carries code, a URL or a callback. Pure.
import * as z from 'zod';
import { idEnum } from './ids.ts';
import type { PartContext } from './types.ts';

export const ACTION_KINDS = ['navigate', 'open-form', 'delete-record'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Go to a page. Link and a form's afterSave take only this one. */
export function navigateActionSchema(ctx: PartContext) {
  return z.strictObject({
    action: z.literal('navigate'),
    pageId: idEnum(ctx.pageIds),
    withRecord: z.boolean().default(false),
  });
}

/** A discriminated union on `action`; page and table ids are enums from the context. */
export function actionSchema(ctx: PartContext) {
  return z.discriminatedUnion('action', [
    navigateActionSchema(ctx),
    z.strictObject({
      action: z.literal('open-form'),
      table: idEnum(ctx.tableIds),
      mode: z.enum(['create', 'edit']).default('create'),
    }),
    z.strictObject({
      action: z.literal('delete-record'),
      table: idEnum(ctx.tableIds),
      thenPageId: idEnum(ctx.pageIds).optional(),
    }),
  ]);
}

export type Action = z.output<ReturnType<typeof actionSchema>>;
export type NavigateAction = z.output<ReturnType<typeof navigateActionSchema>>;
