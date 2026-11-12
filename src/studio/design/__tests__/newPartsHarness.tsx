// The new parts on the Design canvas (phase 8): each one is added with Add on the record page of exampleSpec(), shows its
// plain setting rows (no ids, no prop names) and applies one choice; Columns and Row get their own canvas behavior.
/* eslint-disable react-refresh/only-export-components -- a test harness module, never a Fast Refresh boundary */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { exampleSpec } from '@/catalog/__tests__/fixtures';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import { partLabel } from '../../showcase/entries';
import type { WorkspaceValue } from '../../types';
import DesignTab from '../../pages/DesignTab';

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

export const NEW_PARTS = ['Columns', 'Row', 'NavLinks', 'Breadcrumb', 'BackLink', 'PageHeader', 'Callout', 'Collapsible', 'Chart', 'ProgressBar', 'Timeline', 'Checklist', 'SortControl', 'QuickAdd'] as const;

export const saves: AppSpec[] = [];

export function Workspace({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<AppSpec>(() => AppSpecSchema.parse(exampleSpec()));
  const record = (revision: number, s: AppSpec) => ({ id: 'app-1', name: 'Crew Roster', slug: 'crew-roster', revision, spec: s, issues: [], createdAt: '', updatedAt: '' });
  const value: WorkspaceValue = {
    record: record(1, current),
    spec: current,
    revision: 1,
    save: async (next) => {
      saves.push(next);
      setCurrent(next);
      return { ok: true, record: record(2, next) };
    },
    reload: async () => {},
    setDirty: () => {},
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export async function openCrewPage(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Page');
  fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'crew' } });
  await screen.findByRole('group', { name: 'Page canvas' });
}

export const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (!el) throw new Error(`no block ${id}`);
  return el;
};

export const group = (name: string): HTMLElement => screen.getByRole('group', { name });

export const addPart = (type: string): void => {
  fireEvent.click(screen.getByRole('button', { name: `Add ${partLabel(type)}` }));
};

/** P17-14: a data part added with several tables that fit opens its settings on the table choice; answer it (the choice applies at once) and close the box. */
export const answerTable = (type: string, value: string): void => {
  const dialog = screen.getByRole('dialog', { name: `Settings for ${partLabel(type)}` });
  const select = within(dialog).getByLabelText(/^(Table|List)$/) as HTMLSelectElement;
  expect(select.value).toBe('');
  fireEvent.change(select, { target: { value } });
  const open = screen.queryByRole('dialog');
  if (open !== null) fireEvent.click(within(open).getByRole('button', { name: /Cancel|Close/ }));
};

/** Types that ask which table when added on the record page (several tables fit), and the table each is answered with here. */
export const ASKS_TABLE: Readonly<Record<string, string>> = { Chart: 'open_crews', ProgressBar: 'open_crews', SortControl: 'open_crews' };

export const addPartAnswered = (type: string): void => {
  addPart(type);
  if (Object.hasOwn(ASKS_TABLE, type)) answerTable(type, ASKS_TABLE[type]);
};

export const openSettings = (name: string): HTMLElement => {
  fireEvent.click(group(name));
  fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Settings' }));
  return screen.getByRole('dialog', { name: `Settings for ${name}` });
};

export const find = (layer: LayoutLayer, id: string): LayoutLayer | null => {
  if (layer.id === id) return layer;
  for (const child of Array.isArray(layer.children) ? layer.children : []) {
    const hit = find(child, id);
    if (hit !== null) return hit;
  }
  return null;
};

export const savedLayer = (id: string): LayoutLayer => {
  const page = saves[saves.length - 1].pages.find((p) => p.id === 'crew');
  const hit = page === undefined ? null : find(page.layout, id);
  if (hit === null) throw new Error(`not saved: ${id}`);
  return hit;
};

export function installNewPartsHooks(): void {
  beforeEach(() => {
    saves.length = 0;
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
}
