// The shapes stored for the Data and Design drafts (lib/draftStore.ts), and the checks a stored value passes before a step takes it.
import type { LayoutLayer, Menu, Source, Table, Theme } from '@local-app-studio/runtime/spec/schema';

export const DRAFT_RESTORED = 'Restored your unsaved changes.';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLayer = (value: unknown): value is LayoutLayer =>
  isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string' && isRecord(value.props) && (typeof value.children === 'string' || Array.isArray(value.children));
const isTable = (value: unknown): value is Table => isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string' && Array.isArray(value.fields);

/** The tables of a stored Data draft, or null when the stored value is not tables. */
export function asTables(payload: unknown): Table[] | null {
  return Array.isArray(payload) && payload.every(isTable) ? payload : null;
}

/** What the Design step keeps of its working copy. */
export interface DesignDraftPayload {
  pageId: string;
  root: LayoutLayer;
  menuRoot: LayoutLayer;
  sources: Source[];
  tables: Table[];
  theme: Theme;
  menu: Menu | null;
}

/** A stored Design draft for the given page, or null when it is not one or belongs to another page. */
export function asDesignDraft(payload: unknown, pageId: string): DesignDraftPayload | null {
  if (!isRecord(payload) || payload.pageId !== pageId) return null;
  const { root, menuRoot, sources, tables, theme, menu } = payload;
  if (!isLayer(root) || !isLayer(menuRoot) || !Array.isArray(sources) || !Array.isArray(tables) || !tables.every(isTable) || !isRecord(theme)) return null;
  if (menu !== null && !isRecord(menu)) return null;
  return { pageId, root, menuRoot, sources: sources as Source[], tables, theme: theme as Theme, menu: menu === null ? null : (menu as Menu) };
}
