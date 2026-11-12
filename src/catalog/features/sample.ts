// The sample app a feature is validated and previewed against. Pure and deterministic: one table, a home page, a record
// page and a preview page holding the feature. Validation and the Features page preview share it.
import type { AppSpec, AppSpecInput, Field, FieldType, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { PartContext } from '../types.ts';
import { CATALOG_CHECKS, partContextFor } from '../validateLayout.ts';
import { CONTROL_RE, expandFeature } from './expand.ts';
import { FEATURE_LIMITS } from './limits.ts';
import { valueAtPath } from './slots.ts';
import type { FeatureBody, FeatureDefinition, FeatureLibrary } from './types.ts';

export const SAMPLE_TABLE = 'sample';
/** A row as the data layer hands it out. */
export type SampleRow = Record<string, unknown>;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when a binding of the param sits inside an action object whose withRecord is true. */
function needsRecordPage(body: FeatureBody, name: string): boolean {
  const layers = new Map<string, LayoutLayer>();
  const stack: LayoutLayer[] = [body.fragment];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    layers.set(l.id, l);
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return body.bindings.some((b) => {
    if (b.param !== name) return false;
    const layer = layers.get(b.layer);
    const parts = b.target.split('.');
    if (layer === undefined || parts[0] !== 'props' || parts.length < 3) return false;
    const holder = layer.props[parts[1]];
    return isPlain(holder) && holder.withRecord === true;
  });
}

/** The words a text param's part holds in the fragment (what the builder canvas showed), or undefined. */
function canvasWords(body: FeatureBody, name: string): string | undefined {
  const b = body.bindings.find((x) => x.param === name);
  const stack: LayoutLayer[] = [body.fragment];
  for (let l = stack.pop(); l !== undefined && b !== undefined; l = stack.pop()) {
    const words = l.id === b.layer ? valueAtPath(l, b.target) : undefined;
    if (typeof words === 'string' && words.length >= 1 && words.length <= FEATURE_LIMITS.textValueChars && !CONTROL_RE.test(words)) return words;
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return undefined;
}

/** One sample value per param: text = the words its part holds (else its label), table = sample, source = s_<name>, page = detail or home, field = f_<name>. */
export function sampleParams(body: FeatureBody): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of body.params) {
    if (p.type === 'text') out[p.name] = canvasWords(body, p.name) ?? p.label;
    else if (p.type === 'table') out[p.name] = SAMPLE_TABLE;
    else if (p.type === 'source') out[p.name] = `s_${p.name}`;
    else if (p.type === 'page') out[p.name] = needsRecordPage(body, p.name) ? 'detail' : 'home';
    else out[p.name] = `f_${p.name}`;
  }
  return out;
}

/** A sample field of the type; a reference becomes text because the sample has one table. */
function sampleField(id: string, label: string, type: FieldType): Field {
  if (type === 'select') return { id, label, required: false, type, options: ['One', 'Two'] };
  if (type === 'reference') return { id, label, required: false, type: 'text' };
  return { id, label, required: false, type } as Field;
}

/** The sample spec with the feature expanded on page "preview", or the issues that stopped it. */
export function sampleSpecFor(
  body: FeatureBody,
  lib: FeatureLibrary,
  opts: { id?: string; label?: string } = {},
): { spec: AppSpec; pageId: string } | { issues: SpecIssue[] } {
  const def: FeatureDefinition = {
    ...body,
    id: opts.id ?? 'sample_feature',
    label: opts.label ?? 'Sample feature',
    description: 'Sample',
    version: 1,
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
  const merged = new Map(lib);
  merged.set(def.id, def);
  const sources = body.params
    .filter((p) => p.type === 'source')
    .map((p) => ({ id: `s_${p.name}`, table: SAMPLE_TABLE, mode: p.mode ?? ('list' as const) }));
  const hasRecord = sources.some((s) => s.mode === 'record');
  const root = (id: string, children: LayoutLayer[] = []): LayoutLayer => ({ id, type: 'Page', props: {}, children });
  const input: AppSpecInput = {
    specVersion: 1,
    app: { name: 'Sample', slug: 'sample', identifier: 'com.example.sample', version: '1.0.0' },
    tables: [
      {
        id: SAMPLE_TABLE,
        label: 'Sample',
        titleField: 'name',
        fields: [
          sampleField('name', 'Name', 'text'),
          ...body.params.filter((p) => p.type === 'field').map((p) => sampleField(`f_${p.name}`, p.label, p.fieldTypes?.[0] ?? 'text')),
        ],
      },
    ],
    pages: [
      { id: 'home', title: 'Home', route: '/', sources: [], layout: root('home_root') },
      { id: 'detail', title: 'Detail', route: '/detail/:id', sources: [], layout: root('detail_root') },
      { id: 'preview', title: 'Preview', route: hasRecord ? '/preview-feature/:id' : '/preview-feature', sources, layout: root('preview_root') },
    ],
    nav: [{ pageId: 'home', label: 'Home' }],
  };
  const ctx: PartContext = partContextFor(input, input.pages[2]);
  const expanded = expandFeature(def, sampleParams(body), ctx, merged, {
    rootId: 'feature_preview',
    path: 'pages.2.layout.children.0',
    takenIds: new Set(['preview_root', 'home_root', 'detail_root']),
  });
  if (!expanded.ok) return { issues: expanded.issues };
  input.pages[2].layout = root('preview_root', [expanded.value]);
  const checked = validateAppSpec(input, { ...CATALOG_CHECKS });
  if (!checked.ok) return { issues: checked.issues };
  return { spec: checked.value, pageId: 'preview' };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Deterministic rows for every table of a spec; numbers are computed here, never typed by hand. */
export function sampleRows(spec: AppSpec, count = 5): Record<string, SampleRow[]> {
  const out: Record<string, SampleRow[]> = {};
  for (const table of spec.tables) {
    out[table.id] = Array.from({ length: count }, (_, i) => {
      const day = pad((i % 28) + 1);
      const row: SampleRow = {
        id: `${table.id}_${i + 1}`,
        created_at: `2025-01-${day}T09:00:00.000Z`,
        updated_at: `2025-01-${day}T09:00:00.000Z`,
      };
      for (const f of table.fields) {
        if (f.type === 'text') row[f.id] = `${f.label} ${i + 1}`;
        else if (f.type === 'longtext') row[f.id] = `${f.label} ${i + 1}: a longer note for this row.`;
        else if (f.type === 'integer') row[f.id] = (i + 1) * 3;
        else if (f.type === 'real') row[f.id] = Math.round((i + 1) * 12.5 * 100) / 100;
        else if (f.type === 'boolean') row[f.id] = i % 2 === 0;
        else if (f.type === 'date') row[f.id] = `2025-02-${day}`;
        else if (f.type === 'datetime') row[f.id] = `2025-02-${day}T10:30:00.000Z`;
        else if (f.type === 'select') row[f.id] = f.options[i % f.options.length];
        else row[f.id] = null;
      }
      return row;
    });
  }
  return out;
}

/**
 * Crew Roster (or any spec) plus a record page "crew" holding the sources the part examples name (open_crews, one_crew),
 * so every part's `example` can be shown. The caller passes the fixture (src/spec/fixtures/crew-roster.json).
 */
export function builtInPreviewSpec(base: AppSpecInput, layout?: LayoutLayer): AppSpecInput {
  return {
    ...base,
    pages: [
      ...base.pages,
      {
        id: 'crew',
        title: 'Crew',
        route: '/crews/:id',
        sources: [
          { id: 'open_crews', table: 'crews', where: [{ field: 'status', op: 'eq', value: 'active' }], orderBy: [{ field: 'name', dir: 'asc' }], limit: 50 },
          { id: 'one_crew', table: 'crews', mode: 'record' },
        ],
        layout: layout ?? { id: 'root', type: 'Page', props: {}, children: [] },
      },
    ],
  };
}
