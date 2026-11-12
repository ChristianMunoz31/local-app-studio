// Per-part checklist audit for the 15 phase 8 parts (BRIEF-phase8.md section 3): one table, one row per part. Only the
// items no other test owns: plain words in the model description, the entry's keywords and sub-group, the Design shelf
// search finding the part by its plain name, and ExportButton absent everywhere. Column is hidden from the showcase.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleSpec } from '@/catalog/__tests__/fixtures';
import { PART_DEFINITIONS, PART_NAMES } from '@/catalog/definitions';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import { SHOWCASE_HIDDEN_PARTS, buildShowcaseEntries, partEntries } from '../../showcase/entries';
import { shelfEntries } from '../shelfEntries';
import DesignTab from '../../pages/DesignTab';
import type { WorkspaceValue } from '../../types';

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

const NEW_PARTS = [
  'Columns', 'Column', 'Row', 'NavLinks', 'Breadcrumb', 'BackLink', 'PageHeader', 'Callout', 'Collapsible', 'Chart', 'ProgressBar',
  'Timeline', 'Checklist', 'SortControl', 'QuickAdd',
] as const;
const DASH = /[\u2013\u2014]/;
const hidden = (type: string): boolean => SHOWCASE_HIDDEN_PARTS.has(type);
const rows = NEW_PARTS.map((type) => [type] as const);
const shown = NEW_PARTS.filter((t) => !hidden(t));

describe('per-part checklist: catalog side', () => {
  it('names exactly 15 new parts, all in the catalog', () => {
    expect(NEW_PARTS).toHaveLength(15);
    for (const type of NEW_PARTS) expect(PART_NAMES, type).toContain(type);
  });

  it.each(rows)('%s: model description is under 200 chars, plain and free of dashes', (type) => {
    const def = PART_DEFINITIONS.find((d) => d.name === type);
    expect(def, type).toBeDefined();
    const text = def?.description ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(200);
    expect(text).not.toMatch(DASH);
    expect(text).toBe(text.trim());
  });

  it.each(rows)('%s: the example is the part itself with no dash in it', (type) => {
    const def = PART_DEFINITIONS.find((d) => d.name === type);
    expect(def?.example.type).toBe(type);
    expect(JSON.stringify(def?.example)).not.toMatch(DASH);
  });

  // The model lists (modelParts.ts) moved to pro/ with the helper: pro/src/catalog/__tests__/modelPartsChecklist.test.ts keeps
  // "offered to the model at most once" and "never offers ExportButton in the model lists".
  it('never offers ExportButton in the catalog or the showcase', () => {
    expect(PART_NAMES).not.toContain('ExportButton');
    expect(partEntries().map((e) => e.id)).not.toContain('ExportButton');
    expect(JSON.stringify(PART_DEFINITIONS)).not.toContain('ExportButton');
    expect(JSON.stringify(partEntries())).not.toContain('ExportButton');
  });
});

describe('per-part checklist: showcase entries', () => {
  const entryOf = (type: string) => partEntries().find((e) => e.id === type);

  it('hides only Column among the new parts', () => {
    expect(NEW_PARTS.filter(hidden)).toEqual(['Column']);
    expect(entryOf('Column')).toBeUndefined();
  });

  it.each(shown.map((t) => [t] as const))('%s: has an entry with a plain name, 3 or more keywords and a sub-group where its category has them', (type) => {
    const e = entryOf(type);
    expect(e, type).toBeDefined();
    if (!e) return;
    expect(e.name.trim()).toBe(e.name);
    expect(e.name).not.toMatch(/[a-z][A-Z]/);
    expect(e.name).not.toMatch(DASH);
    expect(e.keywords.length, `${type} keywords`).toBeGreaterThanOrEqual(3);
    expect(new Set(e.keywords).size).toBe(e.keywords.length);
    for (const k of e.keywords) expect(k.trim().length, `${type}: "${k}"`).toBeGreaterThan(0);
    if (e.category === 'layout' || e.category === 'data') expect(e.subgroup, `${type} sub-group`).not.toBeNull();
    else expect(e.subgroup).toBeNull();
  });

  it('Grid is shown as "Auto grid"', () => {
    expect(entryOf('Grid')?.name).toBe('Auto grid');
    expect(partEntries().some((e) => e.name === 'Grid')).toBe(false);
  });

  it('every shown new part is in the shelf entries, and Column is not', () => {
    const ids = shelfEntries(seedRecords()).filter((e) => e.kind === 'part').map((e) => e.id);
    for (const type of shown) expect(ids, type).toContain(type);
    expect(ids).not.toContain('Column');
    expect(buildShowcaseEntries([]).filter((e) => e.kind === 'part')).toHaveLength(partEntries().length);
  });
});

describe('per-part checklist: Design shelf search', () => {
  function Workspace({ children }: { children: ReactNode }) {
    const [current, setCurrent] = useState<AppSpec>(() => AppSpecSchema.parse(exampleSpec()));
    const record = (revision: number, s: AppSpec) => ({ id: 'app-1', name: 'Crew Roster', slug: 'crew-roster', revision, spec: s, issues: [], createdAt: '', updatedAt: '' });
    const value: WorkspaceValue = {
      record: record(1, current),
      spec: current,
      revision: 1,
      save: async (next) => {
        setCurrent(next);
        return { ok: true, record: record(2, next) };
      },
      reload: async () => {},
      setDirty: () => {},
    };
    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
  }

  beforeEach(() => {
    vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
    if (!window.matchMedia) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      }));
    }
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('finds each new part by its plain name, and never offers ExportButton or a lone Column', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/app-1/design']}>
        <Workspace>
          <DesignTab />
        </Workspace>
      </MemoryRouter>,
    );
    const box = (await screen.findByRole('searchbox', { name: 'Search parts and features' })) as HTMLInputElement;
    for (const type of shown) {
      const name = partEntries().find((e) => e.id === type)?.name ?? type;
      fireEvent.change(box, { target: { value: name } });
      await waitFor(() => expect(screen.getByRole('button', { name: `Add ${name}` }), type).toBeTruthy());
    }
    fireEvent.change(box, { target: { value: 'ExportButton' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Add Export/ })).toBeNull());
    fireEvent.change(box, { target: { value: 'Column' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Columns' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Add Column' })).toBeNull();
  });
});
