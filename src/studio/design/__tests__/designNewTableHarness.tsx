// Making a table from the Design view: the offer box on a blank app, New table as one Undo step with its list and its connection,
// the question before a save removes a saved table, and a conflict that keeps the draft (DESIGN-phase13.md 3.4).
/* eslint-disable react-refresh/only-export-components -- a test harness module, never a Fast Refresh boundary */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome, StepDraft } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import type { SaveResult, WorkspaceValue } from '../../types';
import DesignTab from '../../pages/DesignTab';

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

vi.mock('@local-app-studio/runtime/runtime/dataClient.js', () => ({
  createHttpDataSource: () => ({
    list: async () => ({ rows: [], total: 0 }),
    stats: async () => ({ table: 'crews', count: 0, fields: {} }),
    get: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => undefined,
  }),
}));

export const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });

/** A blank app: no tables, one page with a heading. */
export const blankSpec = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [{ id: 'home', title: 'Home', route: '/', sources: [], layout: layer('root_home', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Home heading')]) }],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

/** The spec a test starts from (blank unless a test sets it). */
let startSpec: () => AppSpec = blankSpec;
/** The spec the next mount starts from (reset to the blank app before each test). */
export const setStartSpec = (next: () => AppSpec): void => {
  startSpec = next;
};

export interface Harness {
  saves: AppSpec[];
  setRevision(next: number): void;
}

export let draft: StepDraft | null = null;

export const announced: string[] = [];

export const chrome: StepChrome = {
  setDraft: (tab, next) => {
    if (tab === 'design') draft = next;
  },
  go: () => {},
  announce: (text) => {
    announced.push(text);
  },
  markDone: () => {},
};

export const recordOf = (spec: AppSpec, revision: number) => ({ id: 'app-1', name: spec.app.name, slug: spec.app.slug, revision, spec, issues: [], createdAt: '', updatedAt: '' });

export function Workspace({ children, h, expose, result }: { children: ReactNode; h: Harness; expose(set: (next: number) => void): void; result?: (next: AppSpec) => SaveResult | null }) {
  const [spec, setSpec] = useState(() => startSpec());
  const [revision, setRevision] = useState(1);
  useEffect(() => expose(setRevision), [expose]);
  const value: WorkspaceValue = {
    record: recordOf(spec, revision),
    spec,
    revision,
    save: async (next) => {
      h.saves.push(next);
      const forced = result?.(next) ?? null;
      if (forced) return forced;
      setSpec(next);
      return { ok: true, record: recordOf(next, revision + 1) };
    },
    reload: async () => {},
    setDirty: () => {},
  };
  return (
    <StepChromeContext.Provider value={chrome}>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </StepChromeContext.Provider>
  );
}

export function mount(result?: (next: AppSpec) => SaveResult | null): Harness {
  const h: Harness = { saves: [], setRevision: () => {} };
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace h={h} expose={(set) => (h.setRevision = set)} result={result}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  return h;
}

export const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

/** The Undo of the toolbar (the status line has one too, later in the page). */
export const toolbarUndo = (): HTMLElement => screen.getAllByRole('button', { name: 'Undo' })[0];

export const toolbarRedo = (): HTMLElement => screen.getAllByRole('button', { name: 'Redo' })[0];

export const box = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-not-connected]');

export const badge = (): string | null => document.querySelector('[data-connection-badge]')?.textContent?.replace(/\. Change table$/, '') ?? null;

export const layerIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-canvas-block]')].map((el) => el.dataset.layerId ?? '');

/** Adds the part from the shelf; a blank app places it not connected with the offer. */
export async function addPart(name: string): Promise<void> {
  await screen.findByText('Home heading');
  fireEvent.click(screen.getByRole('button', { name: `Add ${name}` }));
}

/** Presses New table on the part's box, names the table and presses Make table. */
export async function makeTable(part: string, name: string, extra?: (dialog: HTMLElement) => void): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: `Make a new table for ${part}` }));
  const dialog = await screen.findByRole('dialog', { name: `New table for ${part}` });
  fireEvent.change(within(dialog).getByLabelText('Table name'), { target: { value: name } });
  extra?.(dialog);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Make table' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: `New table for ${part}` })).toBeNull());
}

export function installDesignNewTableHooks(): void {
  // DesignSession loads the dialogs lazily. Load them once here so the first dialog in this file does not pay the
  // module load inside findByRole's one second window (it timed out under a full parallel run).
  beforeAll(async () => {
    await import('../NewTableDialog');
    await import('../AddFieldDialog');
  });
  beforeEach(() => {
    startSpec = blankSpec;
    draft = null;
    announced.length = 0;
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
