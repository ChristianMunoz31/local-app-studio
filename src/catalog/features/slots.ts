// Slots: the only places a feature parameter may write (docs/FEATURES.md, ADR-007 point 4). Derived from the catalog
// (a part's `binds`, its action tables, its text children and plain string props). className, style, handlers, enums,
// booleans and numbers are never slots. Pure.
import type { FieldType, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { getPartDefinition } from '../definitions.ts';
import { FEATURE_TYPE } from './limits.ts';
import type { FeatureLibrary } from './types.ts';

export type SlotKind = 'text' | 'table' | 'source' | 'page' | 'field' | 'fields';

export interface Slot {
  /** "children" or "props.<dotted path>". */
  target: string;
  kind: SlotKind;
  mode?: 'list' | 'record';
  /** For field slots: the target of the slot naming the table or source they belong to. */
  of?: string;
  fieldTypes?: FieldType[];
  value: unknown;
}

/**
 * Top-level string props of each part that are free text (not an enum, not an id enum, not named in `binds`). A test
 * derives the same map from the zod shapes, so it cannot drift from the part definitions.
 */
export const TEXT_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Section: ['title', 'subtitle'],
  Card: ['title'],
  Tab: ['label'],
  DataTable: ['emptyText'],
  RecordForm: ['submitLabel'],
  StatCard: ['label'],
  RecordList: ['emptyText'],
  SearchBox: ['placeholder'],
  ReferencePicker: ['label'],
  PageHeader: ['title', 'subtitle'],
  Callout: ['title'],
  Collapsible: ['title'],
  Chart: ['title'],
  ProgressBar: ['label'],
  Timeline: ['emptyText'],
  Checklist: ['emptyText'],
  SortControl: ['label'],
  QuickAdd: ['placeholder', 'buttonLabel'],
});

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at a dotted path walking own properties of plain objects and own indexes of arrays; undefined otherwise. */
export function valueAtPath(root: unknown, dotted: string): unknown {
  let cursor: unknown = root;
  for (const key of dotted.split('.')) {
    if (isPlain(cursor) || Array.isArray(cursor)) {
      if (!Object.hasOwn(cursor, key)) return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** Every slot of one layer, in a fixed order. Feature nodes: one "props.params.<name>" slot per param of the referenced feature. */
export function slotsOf(layer: LayoutLayer, lib?: FeatureLibrary): Slot[] {
  const slots: Slot[] = [];
  const seen = new Set<string>();
  const add = (slot: Slot): void => {
    if (seen.has(slot.target)) return;
    seen.add(slot.target);
    slots.push(slot);
  };
  if (layer.type === FEATURE_TYPE) {
    const featureId = layer.props.featureId;
    const def = lib !== undefined && typeof featureId === 'string' ? lib.get(featureId) : undefined;
    const given = valueAtPath(layer.props, 'params');
    if (def === undefined || !isPlain(given)) return slots;
    for (const p of def.params) {
      if (!Object.hasOwn(given, p.name)) continue;
      add({
        target: `props.params.${p.name}`,
        kind: p.type,
        ...(p.mode === undefined ? {} : { mode: p.mode }),
        ...(p.of === undefined ? {} : { of: `props.params.${p.of}` }),
        ...(p.fieldTypes === undefined ? {} : { fieldTypes: p.fieldTypes }),
        value: given[p.name],
      });
    }
    return slots;
  }
  const def = getPartDefinition(layer.type);
  if (def === undefined) return slots;
  for (const bind of def.binds) {
    const value = valueAtPath(layer.props, bind.prop);
    if (value === undefined) continue;
    const base = {
      ...(bind.mode === undefined ? {} : { mode: bind.mode }),
      ...(bind.of === undefined ? {} : { of: `props.${bind.of}` }),
      ...(bind.fieldTypes === undefined ? {} : { fieldTypes: bind.fieldTypes }),
    };
    add({ target: `props.${bind.prop}`, kind: bind.kind, ...base, value });
    if (bind.kind === 'fields' && Array.isArray(value)) {
      // Each element of a list of fields is a field slot, so a saved feature never keeps field ids of its source app.
      value.forEach((item, i) => add({ target: `props.${bind.prop}.${i}`, kind: 'field', ...base, value: item }));
    }
  }
  for (const [prop, value] of Object.entries(layer.props)) {
    if (isPlain(value) && typeof value.action === 'string' && typeof value.table === 'string') {
      add({ target: `props.${prop}.table`, kind: 'table', value: value.table });
    }
  }
  if (def.children === 'text') add({ target: 'children', kind: 'text', value: layer.children });
  for (const prop of Object.hasOwn(TEXT_PROPS, def.name) ? TEXT_PROPS[def.name] : []) {
    const value = valueAtPath(layer.props, prop);
    if (value !== undefined) add({ target: `props.${prop}`, kind: 'text', value });
  }
  return slots;
}
