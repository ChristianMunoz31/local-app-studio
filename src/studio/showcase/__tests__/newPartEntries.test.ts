// The shelf entries of the phase 31 parts: where they sit, what the tile draws and whether the menu bar takes them.
import { describe, expect, it } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import { fitsMenu } from '../../lib/menuTree';
import { partEntries, partLabel } from '../entries';
import { previewModelFor } from '../samples';
import { entryShowsData } from '../usesData';

const library: FeatureLibrary = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const entry = (id: string) => {
  const e = partEntries().find((x) => x.id === id);
  if (e === undefined) throw new Error(id);
  return e;
};

describe('the Global search and Board entries', () => {
  it('put Global search with the inputs and Board with the records that are shown', () => {
    expect(entry('GlobalSearch')).toMatchObject({ name: 'Global search', category: 'input', subgroup: null });
    expect(entry('Kanban')).toMatchObject({ name: 'Board', category: 'data', subgroup: 'show' });
    expect(partLabel('GlobalSearch')).toBe('Global search');
    expect(partLabel('Kanban')).toBe('Board');
  });

  it('say the Board draws sample data and Global search does not', () => {
    expect(entryShowsData(entry('Kanban'), library)).toBe(true);
    expect(entryShowsData(entry('GlobalSearch'), library)).toBe(false);
  });

  it('let the menu bar take Global search and refuse the Board', () => {
    expect(fitsMenu({ kind: 'part', id: 'GlobalSearch' })).toBe(true);
    expect(fitsMenu({ kind: 'part', id: 'Kanban' })).toBe(false);
  });
});

describe('the previews', () => {
  it('draw the Board over sample tasks in more than one column, from a spec that validates', async () => {
    const model = previewModelFor(entry('Kanban'), library);
    expect(model).not.toBeNull();
    if (model === null) return;
    expect(model.layer.props).toMatchObject({ source: 'task_board', field: 'status' });
    expect(model.data.spec).toBeDefined();
    expect(validateAppSpec(model.data.spec).ok).toBe(true);
    const list = await model.data.dataSource?.list('tasks', { page: 'crew', source: 'task_board' });
    const statuses = new Set((list?.rows ?? []).map((r) => r.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('draw Global search disabled: the preview data has no search and cannot navigate', () => {
    const model = previewModelFor(entry('GlobalSearch'), library);
    expect(model).not.toBeNull();
    expect(model?.data.dataSource?.search).toBeUndefined();
    expect(model?.data.navigate).toBeUndefined();
  });
});
