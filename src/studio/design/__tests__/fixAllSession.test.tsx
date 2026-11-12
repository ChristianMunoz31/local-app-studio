// Fix all in a Design session (phase 25): one press connects what can be connected by itself, says so with Undo, and one Undo
// restores every part (Redo does it again).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });
const table = (id: string, label: string) => ({ id, label, titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text' as const, required: true }] });

/** One page that lists Crews, a Table of records with no table (Crews and People both fit, so it asks) and a create Form for People (not shown here). */
const fixSpec = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [table('crews', 'Crews'), table('people', 'People')],
  pages: [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      sources: [{ id: 'crews_list', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }],
      layout: layer('root_home', 'Page', {}, [
        layer('h1', 'Heading', { size: 'lg' }, 'Home heading'),
        layer('t1', 'DataTable', { source: 'crews_list', columns: ['name'] }),
        layer('t2', 'DataTable', { columns: ['name'] }),
        layer('f1', 'RecordForm', { table: 'people', mode: 'create' }),
      ]),
    },
  ],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

let draft: StepDraft | null = null;
const chrome: StepChrome = {
  setDraft: (tab, next) => {
    if (tab === 'design') draft = next;
  },
  go: () => {},
  announce: () => {},
  markDone: () => {},
};

const recordOf = (spec: AppSpec, revision: number) => ({ id: 'app-1', name: spec.app.name, slug: spec.app.slug, revision, spec, issues: [], createdAt: '', updatedAt: '' });

function Workspace({ children }: { children: ReactNode }) {
  const [spec] = useState(fixSpec);
  const value: WorkspaceValue = {
    record: recordOf(spec, 1),
    spec,
    revision: 1,
    save: async (next): Promise<SaveResult> => ({ ok: true, record: recordOf(next, 2) }),
    reload: async () => {},
    setDirty: () => {},
  };
  return (
    <StepChromeContext.Provider value={chrome}>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </StepChromeContext.Provider>
  );
}

const mount = (): void => {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
};

const toolbarUndo = (): HTMLElement => screen.getAllByRole('button', { name: 'Undo' })[0];
const toolbarRedo = (): HTMLElement => screen.getAllByRole('button', { name: 'Redo' })[0];
const pressFixAll = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'Fix all' }));
};
const notConnectedIds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-not-connected]')].map((el) => el.closest<HTMLElement>('[data-canvas-block]')?.dataset.layerId ?? '');
const badgeOf = (id: string): string | null =>
  document.querySelector(`[data-canvas-block][data-layer-id="${id}"] [data-connection-badge]`)?.textContent?.replace(/\. Change table$/, '') ?? null;

beforeEach(() => {
  draft = null;
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

describe('Fix all in a Design session', () => {
  it('repoints what can be, leaves what asks, and says so with Undo', async () => {
    mount();
    await screen.findByText('Home heading');
    expect(notConnectedIds()).toEqual(['t2']);
    expect(badgeOf('f1')).toBe('Connected to People');
    await pressFixAll();
    await waitFor(() => expect(screen.getByText('Connected 1 part. 1 still needs a table.')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: 'Undo' }).length).toBeGreaterThan(1);
    expect(notConnectedIds()).toEqual(['t2']);
    expect(badgeOf('f1')).toBe('Connected to Crews');
    expect(draft?.isDirty()).toBe(true);
    // The part that asks is the open page's own, so no row is listed, yet Fix all stays: pressing it again fixes nothing and says so.
    expect(document.activeElement?.closest<HTMLElement>('[data-canvas-block]')?.dataset.layerId).toBe('f1');
    await pressFixAll();
    await waitFor(() => expect(screen.getByText('Nothing could be connected by itself. 1 still needs a table.')).toBeTruthy());
    expect(notConnectedIds()).toEqual(['t2']);
  });

  it('one Undo puts the part back, Redo fixes it again', async () => {
    mount();
    await screen.findByText('Home heading');
    await pressFixAll();
    await waitFor(() => expect(badgeOf('f1')).toBe('Connected to Crews'));
    fireEvent.click(toolbarUndo());
    expect(badgeOf('f1')).toBe('Connected to People');
    // It was the only step: the page is as it was loaded.
    await waitFor(() => expect(draft?.isDirty()).toBe(false));
    fireEvent.click(toolbarRedo());
    expect(badgeOf('f1')).toBe('Connected to Crews');
    expect(notConnectedIds()).toEqual(['t2']);
  });
});
