// What a Button does, as the two plain choices Design offers: go to a page, or open a form to add a record. A button with any other
// action (delete the record, a form that edits) is left to its own settings. Pure; the result goes through apply() like any other.
import { linkablePageIds } from '@/catalog/bindings';
import type { PartContext } from '@/catalog/types';
import type { JsonValue, LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import { addToWords } from './followWords';
import { findLayer, replaceLayer } from './layoutTree';
import type { TreeResult } from './layoutTree';

export type ButtonKind = 'navigate' | 'open-form';

export const BUTTON_KIND_LABELS: Readonly<Record<ButtonKind, string>> = {
  navigate: 'Goes to a page',
  'open-form': 'Opens a form to add a record',
};

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The kind of a Button's action when it is one of the two choices, else null (no Button, no action, delete, or a form that edits). */
export function buttonKindOf(layer: LayoutLayer): ButtonKind | null {
  if (layer.type !== 'Button' || layer.feature !== undefined) return null;
  const action = layer.props.action;
  if (!isPlain(action)) return null;
  if (action.action === 'navigate') return 'navigate';
  if (action.action === 'open-form' && (action.mode === undefined || action.mode === 'create')) return 'open-form';
  return null;
}

const DEFAULT_TEXT = 'Button';
const labelOf = (tables: readonly Table[] | undefined, id: string): string => tables?.find((t) => t.id === id)?.label ?? id;

const failure = (message: string): TreeResult => ({ ok: false, reason: 'bad_value', message });

/**
 * The Button with its action changed to this kind. Navigate: the first page that opens without a record, not carrying a record.
 * Open a form: the first table, to add a record. The same kind again is ok with the same root (no Undo step). Refused with a plain
 * reason when the app has no table or no page. A text still the default "Button" becomes "Add to <Table>" for a form (the label from
 * `tables`), and "Add to <Table>" of the old table goes back to "Button" when the button goes to a page.
 */
export function setButtonAction(root: LayoutLayer, id: string, kind: ButtonKind, ctx: PartContext, tables?: readonly Table[]): TreeResult {
  const found = findLayer(root, id);
  if (found === null) return failure('That part is no longer on the page.');
  if (found.layer.type !== 'Button' || found.layer.feature !== undefined || found.inBlock) return failure('Only a button has something to do.');
  if (buttonKindOf(found.layer) === kind) return { ok: true, root, focusId: id };
  let action: Record<string, JsonValue>;
  let children = found.layer.children;
  const was = found.layer.props.action;
  if (kind === 'open-form') {
    const table = ctx.tableIds[0];
    if (table === undefined) return failure('This app has no table yet. Put a part that shows records on a page and press New table on it.');
    action = { action: 'open-form', table, mode: 'create' };
    if (children === DEFAULT_TEXT) children = addToWords(labelOf(tables, table));
  } else {
    const pageId = linkablePageIds(ctx)[0];
    if (pageId === undefined) return failure('This app has no page a button can go to.');
    action = { action: 'navigate', pageId, withRecord: false };
    if (isPlain(was) && typeof was.table === 'string' && children === addToWords(labelOf(tables, was.table))) children = DEFAULT_TEXT;
  }
  return replaceLayer(root, id, { ...found.layer, props: { ...found.layer.props, action }, children });
}
