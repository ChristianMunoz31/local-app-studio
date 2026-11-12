// A way to add records from the Design session: the line under Data connections, one press that adds menu buttons or a Form
// and one Undo step that takes them back (DESIGN-phase25.md 1.2 and 2.2).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import type { WorkspaceValue } from '../../types';
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

/** The Crew Roster fixture: tables People and Crews, one list of Crews, no Form. */
const baseSpec = (): AppSpec => {
  const spec = structuredClone(crewRoster) as unknown as AppSpec;
  spec.pages[0].sources = spec.pages[0].sources.map((s) => ({ ...s, mode: 'list' as const }));
  return spec;
};
const menuSpec = (): AppSpec => ({ ...baseSpec(), menu: { position: 'top', style: 'icons-and-labels' } });
let startSpec: () => AppSpec = baseSpec;

const chrome: StepChrome = { setDraft: () => {}, go: () => {}, announce: () => {}, markDone: () => {} };
const recordOf = (spec: AppSpec, revision: number) => ({ id: 'app-1', name: spec.app.name, slug: spec.app.slug, revision, spec, issues: [], createdAt: '', updatedAt: '' });

function Workspace({ children, saves }: { children: ReactNode; saves: AppSpec[] }) {
  const [spec, setSpec] = useState(() => startSpec());
  const [revision] = useState(1);
  const value: WorkspaceValue = {
    record: recordOf(spec, revision),
    spec,
    revision,
    save: async (next) => {
      saves.push(next);
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

function mount(): AppSpec[] {
  const saves: AppSpec[] = [];
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace saves={saves}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  return saves;
}

const ADD = 'Add a way to add records';
const addButton = (): HTMLElement => screen.getByRole('button', { name: ADD });
const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const toolbarUndo = (): HTMLElement => screen.getAllByRole('button', { name: 'Undo' })[0];
const toolbarRedo = (): HTMLElement => screen.getAllByRole('button', { name: 'Redo' })[0];
const layerIds = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-canvas-block]')].map((el) => el.dataset.layerId ?? '');

beforeAll(async () => {
  await import('../NewTableDialog');
  await import('../AddFieldDialog');
});

beforeEach(() => {
  startSpec = baseSpec;
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

describe('A way to add records in a Design session', () => {
  it('names the tables with no way in under the connections list', async () => {
    startSpec = menuSpec;
    mount();
    expect(await screen.findByText('People and Crews have no way to add records yet.')).toBeTruthy();
    expect(addButton()).toBeTruthy();
  });

  it('adds one menu button for each table in one press, tells it with Undo, and Undo takes both back at once', async () => {
    startSpec = menuSpec;
    const saves = mount();
    await screen.findByText('People and Crews have no way to add records yet.');
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(addButton());
    await screen.findByText(/^Added a menu button for People and a menu button for Crews\./);
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(toolbarUndo());
    await screen.findByText('People and Crews have no way to add records yet.');
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(toolbarRedo());
    await waitFor(() => expect(screen.queryByRole('button', { name: ADD })).toBeNull());
    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].menu?.end?.map((l) => l.props.action)).toEqual([
      { action: 'open-form', table: 'people', mode: 'create' },
      { action: 'open-form', table: 'crews', mode: 'create' },
    ]);
  });

  it('with no menu bar adds a Form after the list on the open page, and says what it could not place', async () => {
    mount();
    await screen.findByText('People and Crews have no way to add records yet.');
    fireEvent.click(addButton());
    await screen.findByText(/^Added a Form for Crews on Home\./);
    expect(screen.getByText(/Nothing shows People yet: put a list of it on a page first\./)).toBeTruthy();
    const ids = layerIds();
    expect(ids.findIndex((id) => id.startsWith('recordform'))).toBe(ids.indexOf('t1') + 1);

    fireEvent.click(toolbarUndo());
    await waitFor(() => expect(layerIds().some((id) => id.startsWith('recordform'))).toBe(false));
    expect(screen.getByRole('button', { name: ADD })).toBeTruthy();
  });

  it('with the menu bar off, keeps the parked menu parts when it adds a Form', async () => {
    startSpec = () => {
      const spec = menuSpec();
      spec.menu = { ...spec.menu!, end: [{ id: 'parked_btn', type: 'Button', props: { text: 'Add', action: { action: 'open-form', table: 'people', mode: 'create' } }, children: [] }] };
      return spec;
    };
    mount();
    await screen.findByRole('region', { name: 'Page layout' });
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
    fireEvent.click(await screen.findByRole('button', { name: ADD }));
    await screen.findByText(/^Added a Form for Crews on Home\./);
    expect(document.activeElement?.closest<HTMLElement>('[data-canvas-block]')?.dataset.layerId).toMatch(/^recordform/);
    fireEvent.click(screen.getByRole('radio', { name: 'Across the top' }));
    await waitFor(() => expect(layerIds()).toContain('parked_btn'));
  });

  it('shows no line when every table already has a way in', async () => {
    startSpec = () => {
      const spec = menuSpec();
      spec.menu = {
        ...spec.menu!,
        end: ['people', 'crews'].map((table) => ({ id: `add_${table}`, type: 'Button', props: { text: 'Add', action: { action: 'open-form', table, mode: 'create' } }, children: [] })),
      };
      return spec;
    };
    mount();
    await screen.findByRole('region', { name: 'Page layout' });
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
  });
});
