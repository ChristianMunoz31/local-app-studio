// A table made on the Design step reaches the Data step, and the Data step keeps its own edits (DESIGN-phase13.md 3.4.4), with the
// real Design and Data steps inside the workspace shell.
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID } from '../../__tests__/harness';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { featuresApi } from '../../services/studioApi';
import AppWorkspace from '../AppWorkspace';

vi.mock('../DescribeTab', () => ({ default: () => <p>Prompt tab</p> }));
vi.mock('../PreviewTab', () => ({ default: () => <p>Preview tab</p> }));
vi.mock('../BuildTab', () => ({ default: () => <p>Build tab</p> }));
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

const server = vi.hoisted(() => ({ specs: [] as unknown[] }));

/** A blank app: no tables, one page with a heading. */
const blank = (): AppSpec => ({ ...baseSpec(), tables: [] });

function mockServer(start: AppSpec): void {
  server.specs = [];
  let revision = 3;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url === `/api/studio/apps/${APP_ID}`) return json(200, { data: recordOf(server.specs.length > 0 ? (server.specs[server.specs.length - 1] as AppSpec) : start, { revision }) });
      if (method === 'PUT') {
        const body = JSON.parse(init?.body as string) as { spec: AppSpec; baseRevision: number };
        server.specs.push(body.spec);
        revision = body.baseRevision + 1;
        return json(200, { data: recordOf(body.spec, { revision }) });
      }
      return json(404, { error: 'not_found' });
    }),
  );
}

const renderApp = (path: string) =>
  render(
    <MemoryRouter initialEntries={[`/apps/${APP_ID}/${path}`]}>
      <Routes>
        <Route path="/apps/:appId/*" element={<AppWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );

const putCalls = (): unknown[][] => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
const rail = () => screen.getByRole('navigation', { name: 'Steps' });

configure({ asyncUtilTimeout: 4000 });

// DesignSession loads the dialogs lazily. Load them once here so the first dialog in this file does not pay the
// module load inside findByRole's one second window (it timed out under a full parallel run).
beforeAll(async () => {
  await import('../../design/NewTableDialog');
});

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.querySelectorAll('[data-testid="detached-announcer"]').forEach((n) => n.remove());
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a table made in Design and the Data step', () => {
  it('is saved with the page when the person goes on, and the Data step lists it', async () => {
    mockServer(blank());
    renderApp('design');
    await screen.findByText('Crew Roster', { selector: 'h2' });
    await waitFor(() => expect(document.querySelector('[data-layer-id="heading_1"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new table for Table of records' }));
    const dialog = await screen.findByRole('dialog', { name: 'New table for Table of records' });
    fireEvent.change(within(dialog).getByLabelText('Table name'), { target: { value: 'Crews' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make table' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Next: Data' }));
    expect(await screen.findByRole('navigation', { name: 'Tables' })).toBeTruthy();
    expect(putCalls()).toHaveLength(1);
    const saved = server.specs[0] as AppSpec;
    expect(saved.tables[0].id).toBe('crews');
    expect(saved.pages[0].sources).toHaveLength(1);
    expect(saved.pages[0].sources[0].table).toBe('crews');
    const table = (saved.pages[0].layout.children as LayoutLayer[]).find((c) => c.type === 'DataTable');
    expect(table?.props.source).toBe(saved.pages[0].sources[0].id);
    expect(within(screen.getByRole('navigation', { name: 'Tables' })).getByText('Crews')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toContain('All changes saved'));
    expect(putCalls()).toHaveLength(1);
  });

  it('the Data step saves its own edit first when the person goes to Design, and Design offers that table', async () => {
    mockServer(baseSpec());
    renderApp('data');
    await screen.findByLabelText('Table name');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: 'Add table' }));
    fireEvent.click(within(rail()).getByRole('link', { name: /Design/ }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect((server.specs[0] as AppSpec).tables.map((t) => t.id)).toEqual(['crews', 'new_table']);
    await waitFor(() => expect(document.querySelector('[data-layer-id="heading_1"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    const settings = await screen.findByRole('dialog', { name: 'Settings for Table of records' });
    const options = [...(within(settings).getByLabelText('Table') as HTMLSelectElement).options].map((o) => o.text);
    expect(options).toContain('New table');
    expect(options).toContain('Crews');
    expect(putCalls()).toHaveLength(1);
  });
});
