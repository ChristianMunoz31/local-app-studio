// Two settings of the list parts that are not slots or choices: which columns a Table of records shows (`columns`) and what a row
// click does (`rowAction`, only "open a page with the record"). configureLayer accepts exactly these keys for these parts. Pure.
import type { JsonValue, LayoutLayer } from '@local-app-studio/runtime/spec/schema';

export const COLUMNS_KEY = 'props.columns';
export const ROW_ACTION_KEY = 'props.rowAction';
/** The draft value of a row action that is not "open a page" (an action set by hand): it is kept as it is. */
export const KEEP_ROW_ACTION = '@keep';
export const MAX_COLUMNS = 8;

/** The special keys a part of this type takes. */
export function specialKeysOf(type: string): string[] {
  if (type === 'DataTable') return [COLUMNS_KEY, ROW_ACTION_KEY];
  if (type === 'RecordList') return [ROW_ACTION_KEY];
  return [];
}

/** The draft value of the row action: '' none, the page id of an "open the page" action, KEEP_ROW_ACTION for any other action. */
export function rowActionValue(layer: LayoutLayer): string {
  const action = layer.props.rowAction;
  if (action === undefined || action === null) return '';
  if (typeof action === 'object' && !Array.isArray(action) && action.action === 'navigate' && typeof action.pageId === 'string') return action.pageId;
  return KEEP_ROW_ACTION;
}

/** The draft value of the columns: the field ids, comma separated. */
export function columnsValue(layer: LayoutLayer): string {
  const columns = layer.props.columns;
  return Array.isArray(columns) ? columns.filter((c): c is string => typeof c === 'string').join(',') : '';
}

/** Writes one special value into the layer's props (a copy owned by the caller). Returns a problem in plain words, or null. */
export function applySpecial(layer: LayoutLayer, key: string, raw: string): string | null {
  if (key === COLUMNS_KEY) {
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s !== ''))];
    if (ids.length === 0) delete layer.props.columns;
    else if (ids.length > MAX_COLUMNS) return `Pick at most ${MAX_COLUMNS} columns.`;
    else layer.props.columns = ids;
    return null;
  }
  if (raw === KEEP_ROW_ACTION) return null;
  if (raw === '') delete layer.props.rowAction;
  else layer.props.rowAction = rowActionTo(raw);
  return null;
}

/** The action that opens a page with the record of the clicked row. */
export function rowActionTo(pageId: string): JsonValue {
  return { action: 'navigate', pageId, withRecord: true };
}
