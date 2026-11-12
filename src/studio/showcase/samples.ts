// Preview models for the showcase: the layer to draw and the data it reads. Deterministic and memoized, so a tile,
// a palette tile and the drawer show the same thing. Pure (no React).
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, AppSpecInput, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { getPartDefinition } from '@/catalog/definitions';
import { builtInPreviewSpec, sampleRows, sampleSpecFor } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import { CATALOG_CHECKS } from '@/catalog/validateLayout';
import type { CatalogData, DataRow } from '@/catalog/context';
import { sampleDataSource } from '../lib/sampleDataSource';
import { resolveRow, seedOrder } from '../lib/sampleData';
import type { SampleRecords } from '../lib/sampleData';
import type { ShowcaseEntry } from './entries';

export interface PreviewModel {
  layer: LayoutLayer;
  data: CatalogData;
}

/** Sample rows for every table, with each reference field pointing at a row of the table it names. */
export function showcaseRows(spec: AppSpec): Record<string, DataRow[]> {
  const rows = sampleRows(spec);
  for (const table of spec.tables) {
    for (const field of table.fields) {
      if (field.type !== 'reference') continue;
      const count = Object.hasOwn(rows, field.table) ? rows[field.table].length : 0;
      if (count === 0) continue;
      rows[table.id].forEach((row, i) => {
        row[field.id] = `${field.table}_${1 + (i % count)}`;
      });
    }
  }
  return rows;
}

/** The showcase rows, with the tables a stored example sample covers replaced by its records (ids table_n, links resolved). */
export function sampleBackedRows(spec: AppSpec, sample: SampleRecords | null, today: Date = new Date()): Record<string, DataRow[]> {
  const rows = showcaseRows(spec);
  if (sample === null) return rows;
  const covered = seedOrder(spec).flatMap((id) => {
    const table = spec.tables.find((t) => t.id === id);
    const list = Object.hasOwn(sample.tables, id) ? sample.tables[id] : [];
    return table === undefined || list.length === 0 ? [] : [{ table, list }];
  });
  const ids = new Map<string, string>();
  for (const { table, list } of covered) {
    list.forEach((row, i) => {
      if (typeof row._id === 'string') ids.set(`${table.id}:${row._id}`, `${table.id}_${i + 1}`);
    });
  }
  for (const { table, list } of covered) {
    rows[table.id] = list.map((row, i) => ({ id: `${table.id}_${i + 1}`, created_at: today.toISOString(), updated_at: today.toISOString(), ...resolveRow(table, row, today, (t, key) => ids.get(`${t}:${key}`)) }));
  }
  return rows;
}

function modelFor(layer: LayoutLayer, spec: AppSpec, pageId: string): PreviewModel {
  const rows = showcaseRows(spec);
  const recordSource = spec.pages.find((p) => p.id === pageId)?.sources.find((s) => s.mode === 'record');
  const first = recordSource !== undefined && Object.hasOwn(rows, recordSource.table) ? rows[recordSource.table][0]?.id : undefined;
  const recordId = typeof first === 'string' ? first : null;
  return { layer, data: { apiBase: '', spec, pageId, recordId, dataSource: sampleDataSource(rows, spec) } };
}

let builtIn: AppSpec | null | undefined;

/** Tasks of a crew: the table and the list source the Timeline, Checklist and Quick add examples name. Studio previews only. */
const TASKS_TABLE: NonNullable<AppSpecInput['tables']>[number] = {
  id: 'tasks',
  label: 'Tasks',
  titleField: 'title',
  fields: [
    { id: 'title', label: 'Title', type: 'text', required: true },
    { id: 'done', label: 'Done', type: 'boolean' },
    { id: 'due', label: 'Due', type: 'date' },
    { id: 'hours', label: 'Hours', type: 'integer' },
    { id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews' },
  ],
};
const OPEN_TASKS: NonNullable<AppSpecInput['pages'][number]['sources']>[number] = {
  id: 'open_tasks',
  table: 'tasks',
  where: [{ field: 'done', op: 'eq', value: false }],
  orderBy: [{ field: 'due', dir: 'asc' }],
  limit: 50,
};

/** The Crew Roster sample plus tasks, with the record page the part examples name; built once. */
function builtInSpec(): AppSpec | null {
  if (builtIn === undefined) {
    const base = crewRoster as unknown as AppSpecInput;
    const preview = builtInPreviewSpec({ ...base, tables: [...(base.tables ?? []), TASKS_TABLE] });
    const input: AppSpecInput = { ...preview, pages: preview.pages.map((p) => (p.id === 'crew' ? { ...p, sources: [...(p.sources ?? []), OPEN_TASKS] } : p)) };
    const checked = validateAppSpec(input, { ...CATALOG_CHECKS });
    builtIn = checked.ok ? checked.value : null;
  }
  return builtIn;
}

const partModels = new Map<string, PreviewModel | null>();
const featureModels = new WeakMap<FeatureLibrary, Map<string, PreviewModel | null>>();

function buildPart(entry: ShowcaseEntry): PreviewModel | null {
  const spec = builtInSpec();
  const example = getPartDefinition(entry.id)?.example;
  return spec === null || example === undefined ? null : modelFor(example, spec, 'crew');
}

function buildFeature(entry: ShowcaseEntry, library: FeatureLibrary): PreviewModel | null {
  const feature = entry.feature;
  if (feature === undefined || !feature.ok || feature.fragment === null) return null;
  const sample = sampleSpecFor({ params: feature.params, fragment: feature.fragment, bindings: feature.bindings }, library, { id: feature.id, label: feature.label });
  if ('issues' in sample) return null;
  const children = sample.spec.pages.find((p) => p.id === sample.pageId)?.layout.children;
  if (!Array.isArray(children) || children.length === 0) return null;
  return modelFor(children[0], sample.spec, sample.pageId);
}

/** The layer and data to draw for an entry, or null when it cannot be previewed. Memoized by key and version. */
export function previewModelFor(entry: ShowcaseEntry, library: FeatureLibrary): PreviewModel | null {
  const id = `${entry.key}@${entry.version}@${entry.status}@${entry.feature?.updatedAt ?? ""}`;
  if (entry.kind === 'part') {
    if (!partModels.has(id)) partModels.set(id, buildPart(entry));
    return partModels.get(id) ?? null;
  }
  let perLibrary = featureModels.get(library);
  if (perLibrary === undefined) {
    perLibrary = new Map();
    featureModels.set(library, perLibrary);
  }
  // The library is the key of the outer map, so a changed dependency never serves a stale model.
  if (!perLibrary.has(id)) perLibrary.set(id, buildFeature(entry, library));
  return perLibrary.get(id) ?? null;
}
