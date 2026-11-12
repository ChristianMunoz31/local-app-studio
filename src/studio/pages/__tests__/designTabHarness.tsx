/* eslint-disable react-refresh/only-export-components -- a test harness module, never a Fast Refresh boundary */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome, StepDraft } from '../../hooks/useStepChrome';
import type { PreviewStatus, SaveResult, WorkspaceValue } from '../../types';
import { featuresApi } from '../../services/studioApi';
import type { SampleRecords } from '../../lib/sampleData';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import DesignTab from '../DesignTab';

const hoistedPreview = vi.hoisted(() => ({ status: null as PreviewStatus | null, revision: 1 }));

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: hoistedPreview.status, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

const hoistedSource = vi.hoisted(() => ({
  list: vi.fn(async () => ({ rows: [{ id: 'r1', name: 'Alpha crew' }], total: 1 })),
  get: vi.fn<(table: string, id: string) => Promise<Record<string, unknown> | null>>(async () => ({ id: 'r1', name: 'Alpha crew' })),
}));

const hoistedSampleApi = vi.hoisted(() => ({ get: vi.fn(async (): Promise<SampleRecords> => ({ v: 1, tables: {} })) }));

/** The preview status the mocked hook answers, and the data and sample doubles the Design tests steer (a test sets them, each test starts from the defaults). */
export const preview = hoistedPreview;
export const source = hoistedSource;
export const sampleApi = hoistedSampleApi;

vi.mock('../../services/studioApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/studioApi')>()), getSample: hoistedSampleApi.get }));

vi.mock('@local-app-studio/runtime/runtime/dataClient.js', () => ({
  createHttpDataSource: () => ({
    list: hoistedSource.list,
    stats: async () => ({ table: 'crews', count: 0, fields: {} }),
    get: hoistedSource.get,
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => undefined,
  }),
}));

export const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({
  id,
  type,
  props,
  children,
});

export const makeSpec = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      sources: [],
      layout: layer('root_home', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Home heading'), layer('h2', 'Heading', { size: 'md' }, 'Second heading')]),
    },
    { id: 'about', title: 'About', route: '/about', sources: [], layout: layer('root_about', 'Page', {}, [layer('h3', 'Heading', { size: 'lg' }, 'About heading')]) },
  ],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

/** Two tables, two list sources and a record source on the home page. */
export const dataSpec = (): AppSpec => {
  const spec = makeSpec();
  spec.tables = [
    { id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
    { id: 'people', label: 'People', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
  ];
  spec.pages[0] = {
    ...spec.pages[0],
    sources: [
      { id: 'all_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 },
      { id: 'all_people', table: 'people', mode: 'list', where: [], orderBy: [], limit: 50 },
    ],
    layout: layer('root_home', 'Page', {}, [layer('t1', 'DataTable', { source: 'all_crews', columns: ['name'] })]),
  };
  return spec;
};

export interface Harness {
  saves: AppSpec[];
  dirty: Array<[string, boolean]>;
  /** When set, a save answers only once this resolves (a save that is still on its way). */
  gate?: Promise<void>;
}

/** The draft Design registered with the workspace shell last (null once it went away). */
export let draft: StepDraft | null = null;

export const nextBlocked = (): string | null => draft?.nextBlocked ?? null;

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

export const recordOf = (spec: AppSpec, revision: number) => ({
  id: 'app-1',
  name: spec.app.name,
  slug: spec.app.slug,
  revision,
  spec,
  issues: [],
  createdAt: '',
  updatedAt: '',
});

export function Workspace({ children, h, result, initial = makeSpec }: { children: ReactNode; h: Harness; result?: (next: AppSpec) => SaveResult | null; initial?: () => AppSpec }) {
  const [spec, setSpec] = useState(initial);
  const value: WorkspaceValue = {
    record: recordOf(spec, preview.revision),
    spec,
    revision: preview.revision,
    save: async (next) => {
      h.saves.push(next);
      if (h.gate) await h.gate;
      const forced = result?.(next) ?? null;
      if (forced) return forced;
      setSpec(next);
      return { ok: true, record: recordOf(next, 2) };
    },
    reload: async () => {},
    setDirty: (tab, dirty) => h.dirty.push([tab, dirty]),
  };
  return (
    <StepChromeContext.Provider value={chrome}>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </StepChromeContext.Provider>
  );
}

export const mount = (h: Harness, result?: (next: AppSpec) => SaveResult | null, initial?: () => AppSpec, state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/apps/app-1/design', state }]}>
      <Workspace h={h} result={result} initial={initial}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );

export const harness = (): Harness => ({ saves: [], dirty: [] });

export const openPageActions = (): void => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Page actions' }), { key: 'Enter' });
};

export const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

export const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (!el) throw new Error(`no block ${id}`);
  return el;
};

export const select = (id: string): void => {
  fireEvent.click(block(id));
};

export const toolbar = (): HTMLElement => screen.getByRole('toolbar');

export const order = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-canvas-block]')].map((el) => el.dataset.layerId ?? '');

export function installDesignTabHooks(): void {
  beforeEach(() => {
    preview.status = null;
    preview.revision = 1;
    draft = null;
    announced.length = 0;
    source.list.mockClear();
    source.get.mockClear();
    sampleApi.get.mockClear();
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
