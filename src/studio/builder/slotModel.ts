// The slot model of the Feature builder: which settings the bench would save as (the rows of the slot panel), how many there are,
// and the FeatureInput a save sends. Everything is derived from the canvas by the existing slotGroups and buildFeatureInput, so the
// record passes validateFeatureInput with no format change (DESIGN-phase16.md 4.3). Pure.
import { FEATURE_LIMITS } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { HostDoc } from '../design/DesignSession';
import { blockName } from '../design/designLabels';
import { buildFeatureInput, paramName, slotGroups } from '../lib/featureFromSelection';
import type { SlotGroup } from '../lib/featureFromSelection';
import { listLabelFor } from '../lib/featureParams';
import { layerIds } from '../lib/layout';
import { uniqueId } from '../lib/layoutTree';
import type { FeatureInput } from '../types';
import { panelKeysOf, sampleOf, storedPanelKey } from './bench';
import type { PanelState, SampleId } from './bench';

export type { SampleId } from './bench';
export type { PanelState } from './bench';

export type SlotHeading = 'Table this feature shows' | 'Field it groups by' | 'Field it uses' | 'Page it opens' | 'Words you can change';

export interface BuilderSlot {
  /** The slotGroups key, `table|<benchTableId>` for a table slot row, or the use (`use|<layer>|<target>`) of a page or text row. */
  key: string;
  kind: 'table' | 'field' | 'page' | 'text';
  heading: SlotHeading;
  /** What people see when they add the feature. */
  label: string;
  /** The bench table of a table or field slot. */
  tableId: string | null;
  /** The bench field of a field slot. */
  fieldId: string | null;
  /** Table slots: the template its unused fields match, null for "Your fields". */
  sample: SampleId | null;
  /** Plain part names that use it. */
  uses: string[];
  /** Texts: ticked. Everything else true. */
  on: boolean;
}

/** The order of the groups in the panel. */
export const HEADINGS: readonly SlotHeading[] = ['Table this feature shows', 'Field it groups by', 'Field it uses', 'Page it opens', 'Words you can change'];

/** The page a part must hold: only one child is the part itself, else a Section holds them all. A saved feature block stays a block inside a Section. */
export function fragmentOf(root: LayoutLayer): LayoutLayer {
  const kids = Array.isArray(root.children) ? root.children : [];
  if (kids.length === 1 && kids[0].feature === undefined) return kids[0];
  return { id: uniqueId('section', layerIds(root)), type: 'Section', props: {}, children: kids };
}

const cut = (value: string): string => value.trim().slice(0, FEATURE_LIMITS.labelChars).trim();
const isControl = (ch: string): boolean => {
  const n = ch.charCodeAt(0);
  return n < 32 || n === 127 || n === 0x2028 || n === 0x2029 || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
};
/** A label a person typed, made fit for a setting: no control characters, trimmed, at most 40 characters. */
const cleanLabel = (value: string): string => cut([...value].map((ch) => (isControl(ch) ? ' ' : ch)).join(''));

interface Parsed {
  groups: SlotGroup[];
  fragment: LayoutLayer;
  layers: Map<string, LayoutLayer>;
}

function parse(doc: HostDoc, library: FeatureLibrary): Parsed {
  const fragment = fragmentOf(doc.root);
  const layers = new Map<string, LayoutLayer>();
  const stack: LayoutLayer[] = [fragment];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    layers.set(l.id, l);
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return { groups: slotGroups(fragment, library).groups, fragment, layers };
}

const tableOfGroup = (g: SlotGroup, doc: HostDoc): string | null => (g.kind === 'table' ? g.value : g.kind === 'source' ? (doc.sources.find((s) => s.id === g.value)?.table ?? null) : null);

const isChosen = (g: SlotGroup, state: PanelState): boolean => g.forced || panelKeysOf(g).some((k) => state.textOn.has(k));

/** The label a group is saved with. Table and list settings follow the table slot's name; fields follow the field's label. */
function labelsOf(groups: readonly SlotGroup[], doc: HostDoc, state: PanelState): Map<string, string> {
  const out = new Map<string, string>();
  let pages = 0;
  const table = (id: string | null): string => doc.tables.find((t) => t.id === id)?.label ?? 'Table';
  for (const g of groups) {
    let label: string;
    if (g.kind === 'table') label = table(g.value);
    else if (g.kind === 'source') label = listLabelFor(table(tableOfGroup(g, doc)));
    else if (g.kind === 'field') {
      const parent = groups.find((x) => x.key === g.of);
      const t = doc.tables.find((x) => x.id === (parent === undefined ? null : tableOfGroup(parent, doc)));
      label = g.value === 'created_at' ? 'Created' : g.value === 'updated_at' ? 'Updated' : (t?.fields.find((f) => f.id === g.value)?.label ?? g.value);
    } else if (g.kind === 'page') {
      pages += 1;
      label = pages === 1 ? 'Page it opens' : `Page it opens ${pages}`;
    } else label = g.value;
    const typed = g.kind === 'page' || g.kind === 'text' ? cleanLabel(panelKeysOf(g).map((k) => state.labels[k]).find((l) => l !== undefined) ?? '') : '';
    out.set(g.key, cleanLabel(typed === '' ? label : typed) || 'Setting');
  }
  return out;
}

function partNames(g: SlotGroup, layers: ReadonlyMap<string, LayoutLayer>): string[] {
  const names = g.uses.map((u) => layers.get(u.layer)).filter((l): l is LayoutLayer => l !== undefined).map((l) => blockName(l, null));
  return [...new Set(names)];
}

/** The rows of the slot panel, in the panel's order: a row for every bench table, then the field, page and text settings the parts use. */
export function builderSlots(doc: HostDoc, spec: AppSpec, library: FeatureLibrary, state: PanelState): BuilderSlot[] {
  void spec;
  const { groups, layers } = parse(doc, library);
  const labels = labelsOf(groups, doc, state);
  const rows: BuilderSlot[] = doc.tables.map((t) => ({
    key: `table|${t.id}`,
    kind: 'table',
    heading: HEADINGS[0],
    label: t.label,
    tableId: t.id,
    fieldId: null,
    sample: sampleOf(t),
    uses: [...new Set(groups.filter((g) => tableOfGroup(g, doc) === t.id).flatMap((g) => partNames(g, layers)))],
    on: true,
  }));
  for (const g of groups) {
    if (g.kind === 'table' || g.kind === 'source') continue;
    const label = labels.get(g.key) as string;
    if (g.kind === 'field') {
      const parent = groups.find((x) => x.key === g.of);
      const groupsBy = g.uses.some((u) => layers.get(u.layer)?.type === 'Chart' && u.target === 'props.groupBy');
      rows.push({
        key: g.key,
        kind: 'field',
        heading: groupsBy ? HEADINGS[1] : HEADINGS[2],
        label,
        tableId: parent === undefined ? null : tableOfGroup(parent, doc),
        fieldId: g.value,
        sample: null,
        uses: partNames(g, layers),
        on: true,
      });
    } else {
      rows.push({
        key: storedPanelKey(g, state),
        kind: g.kind === 'page' ? 'page' : 'text',
        heading: g.kind === 'page' ? HEADINGS[3] : HEADINGS[4],
        label,
        tableId: null,
        fieldId: null,
        sample: null,
        uses: partNames(g, layers),
        on: g.kind === 'page' || panelKeysOf(g).some((k) => state.textOn.has(k)),
      });
    }
  }
  return HEADINGS.flatMap((h) => rows.filter((r) => r.heading === h));
}

/** How many settings the save would have (params): what the limit of 6 counts. */
export function paramCount(doc: HostDoc, library: FeatureLibrary, state: PanelState): number {
  return parse(doc, library).groups.filter((g) => isChosen(g, state)).length;
}

/**
 * How many things people fill in, for "People can change 3 of 6 things.": a table and the list of the same table are one thing, the
 * one row the panel shows for that table (a feature with a list and a Quick add on one slot saves two settings and asks for one choice).
 */
export function settingCount(doc: HostDoc, library: FeatureLibrary, state: PanelState): number {
  const { groups } = parse(doc, library);
  const things = new Set<string>();
  for (const g of groups.filter((x) => isChosen(x, state))) {
    const table = g.kind === 'table' || g.kind === 'source' ? tableOfGroup(g, doc) : null;
    things.add(table === null ? g.key : `table|${table}`);
  }
  return things.size;
}

/** The feature record a save sends, from the canvas and the panel. The id is derived by the caller and never shown. */
export function featureInputOf(a: { doc: HostDoc; library: FeatureLibrary; state: PanelState; id: string; name: string; line: string }): FeatureInput {
  const { groups, fragment } = parse(a.doc, a.library);
  const labels = labelsOf(groups, a.doc, a.state);
  const names = new Set<string>();
  const params = groups
    .filter((g) => isChosen(g, a.state))
    .map((g) => {
      const label = labels.get(g.key) as string;
      const name = paramName(label, names);
      names.add(name);
      return { group: g.key, name, label };
    });
  return buildFeatureInput(fragment, { id: a.id, label: a.name, description: a.line, params }, a.library);
}
