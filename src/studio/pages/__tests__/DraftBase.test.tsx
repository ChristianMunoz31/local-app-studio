// Phase 12 Fix-F: a step draft keeps its own base and never takes a newer record while it holds edits; a clean one starts again from
// it; Design and Data mount only from the latest record; the server's own form of a saved spec never leaves a draft "unsaved".
// Real Data, real Design and the real shell, against a small fake of the server that answers 409 like the real one.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID } from '../../__tests__/harness';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { featuresApi } from '../../services/studioApi';
import AppWorkspace from '../AppWorkspace';

vi.mock('../DescribeTab', () => ({ default: () => <p>Describe tab</p> }));
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

interface Put {
  baseRevision: number;
  spec: AppSpec;
  /** Answers the request the way the real server does: a conflict when the revision moved, else it stores and answers. */
  release(): void;
}

const store = vi.hoisted(() => ({
  spec: null as unknown as AppSpec,
  revision: 3,
  manual: false,
  puts: [] as Array<{ baseRevision: number; spec: AppSpec; release(): void }>,
  stored: [] as AppSpec[],
  /** The server's own form of a saved spec (the real one stores the schema's output: defaults filled). */
  normalise: (spec: AppSpec): AppSpec => spec,
}));

function resetServer(): void {
  store.spec = baseSpec();
  store.revision = 3;
  store.manual = false;
  store.puts = [];
  store.stored = [];
  store.normalise = (spec) => spec;
}

/** Another window saves this app. */
function changeElsewhere(change: (spec: AppSpec) => void): void {
  const next = structuredClone(store.spec);
  change(next);
  store.spec = next;
  store.revision += 1;
}

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url === `/api/studio/apps/${APP_ID}`) return json(200, { data: recordOf(store.spec, { revision: store.revision }) });
      if (method === 'PUT') {
        const body = JSON.parse(init?.body as string) as { spec: AppSpec; baseRevision: number };
        return new Promise<Response>((resolve) => {
          const release = (): void => {
            if (body.baseRevision !== store.revision) {
              resolve(json(409, { error: 'revision_conflict', message: 'Changed elsewhere.', revision: store.revision }));
              return;
            }
            store.spec = store.normalise(body.spec);
            store.revision += 1;
            store.stored.push(store.spec);
            resolve(json(200, { data: recordOf(store.spec, { revision: store.revision }) }));
          };
          const put: Put = { baseRevision: body.baseRevision, spec: body.spec, release };
          store.puts.push(put);
          if (!store.manual) release();
        });
      }
      return json(404, { error: 'not_found' });
    }),
  );
}

function Palette({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {`Palette ${to.split('/').pop()}`}
    </button>
  );
}

const renderAt = (step: 'data' | 'design') =>
  render(
    <MemoryRouter initialEntries={[`/apps/${APP_ID}/${step}`]}>
      <Palette to={`/apps/${APP_ID}/data`} />
      <Palette to={`/apps/${APP_ID}/design`} />
      <Palette to={`/apps/${APP_ID}/preview`} />
      <Routes>
        <Route path="/apps/:appId/*" element={<AppWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const palette = (step: string) => screen.getByRole('button', { name: `Palette ${step}` });
const addTable = (): void => {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: 'Add table' }));
};
const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const canvas = (): HTMLElement => screen.getByTestId('design-canvas');
const heading = (): Element | null => document.querySelector('[data-canvas-block][data-layer-id="heading_1"]');
const FOREST = { preset: 'aurora', radius: 'md', id: 'forest' } as const;

async function deleteHeading(): Promise<void> {
  await waitFor(() => expect(heading()).not.toBeNull(), { timeout: 15_000 });
  fireEvent.click(heading() as HTMLElement);
  fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

/** Renames the app in App settings; the save goes out with the revision the workspace has now. */
async function saveSettings(name: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'App settings' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));
  return dialog;
}

configure({ asyncUtilTimeout: 4000 });

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.querySelectorAll('[data-testid="detached-announcer"]').forEach((n) => n.remove());
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  }
  resetServer();
  mockFetch();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Design and another window (V4-1)', () => {
  it('a Design draft with edits gets a conflict, keeps its edits and overwrites nothing', async () => {
    renderAt('design');
    await deleteHeading();
    changeElsewhere((s) => {
      s.theme = { ...FOREST };
    });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/changed in another window/)).toBeTruthy();
    await flush();
    // The edit is still on screen, the other window's theme is still the stored one, and the one request carried the old revision.
    expect(heading()).toBeNull();
    expect(store.puts.map((p) => p.baseRevision)).toEqual([3]);
    expect(store.stored).toHaveLength(0);
    expect(store.spec.theme).toEqual(FOREST);
  });

  it('a Design step with nothing unsaved starts again from the newer record and shows its theme', async () => {
    renderAt('design');
    await waitFor(() => expect(heading()).not.toBeNull());
    const before = canvas().style.getPropertyValue('--brand');
    changeElsewhere((s) => {
      s.theme = { ...FOREST };
    });
    const dialog = await saveSettings('Renamed');
    // The settings were made from the old revision, so they are refused and the latest record is loaded.
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
    await waitFor(() => expect(canvas().style.getPropertyValue('--brand')).not.toBe(before));
    expect(heading()).not.toBeNull();
    expect(store.stored).toHaveLength(0);
  });
});

describe('Data and another window (V4-3)', () => {
  it('keeps the edits of a Data draft when a reload brings other tables, and the next save gets a conflict', async () => {
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    changeElsewhere((s) => {
      s.tables = [...s.tables, { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    });
    const dialog = await saveSettings('Renamed');
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await flush();
    // Nothing was replaced: the new table of the draft is still listed, the other window's table is not.
    const list = screen.getByRole('navigation', { name: 'Tables' });
    expect(within(list).getByText('New table')).toBeTruthy();
    expect(within(list).queryByText('People')).toBeNull();
    fireEvent.click(saveButton());
    expect(await screen.findByText(/changed in another window/)).toBeTruthy();
    expect(store.puts.map((p) => p.baseRevision)).toEqual([3, 3]);
    expect(store.stored).toHaveLength(0);
  });

  it('a Data step with nothing unsaved shows the tables of the newer record', async () => {
    renderAt('data');
    await screen.findByLabelText('Table name');
    changeElsewhere((s) => {
      s.tables = [...s.tables, { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    });
    const dialog = await saveSettings('Renamed');
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await within(screen.getByRole('navigation', { name: 'Tables' })).findByText('People')).toBeTruthy();
  });
});

describe('a step that arrives while a save is on its way (V4-2)', () => {
  it('waits, then Design mounts from the revision the save made and its save is not a conflict', async () => {
    store.manual = true;
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(palette('design'));
    // The visible waiting line only: the live region announces the same words and keeps them until the next announcement.
    expect(await screen.findByText('Saving your changes...', { ignore: 'script, style, [aria-live], [aria-live] *' })).toBeTruthy();
    expect(screen.queryByTestId('design-canvas')).toBeNull();
    await waitFor(() => expect(store.puts).toHaveLength(1));
    await act(async () => {
      store.puts[0].release();
    });
    await waitFor(() => expect(heading()).not.toBeNull());
    expect(screen.queryByText('Saving your changes...', { ignore: 'script, style, [aria-live], [aria-live] *' })).toBeNull();
    store.manual = false;
    await deleteHeading();
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.stored).toHaveLength(2));
    expect(store.puts.map((p) => p.baseRevision)).toEqual([3, 4]);
    // Design started from the Data save: its page save kept the new table.
    expect(store.spec.tables.map((t) => t.id)).toEqual(['crews', 'new_table']);
    expect(screen.queryByText(/changed in another window/)).toBeNull();
  });

  it('holds App settings until the save is over', async () => {
    store.manual = true;
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.puts).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'App settings' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Save settings' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Saving your changes first...')).toBeTruthy();
    await act(async () => {
      store.puts[0].release();
    });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save settings' }).getAttribute('aria-disabled')).toBeNull());
  });
});

describe('the server stores the spec in its own form (V4-4)', () => {
  it('a saved Data draft is clean, sends nothing more and leaves nothing behind', async () => {
    // A default the server fills in: the echoed tables are not the tables that were sent.
    store.normalise = (spec) => ({ ...spec, tables: spec.tables.map((t) => ({ ...t, fields: t.fields.map((f) => (f.type === 'text' ? { ...f, default: 'n/a' } : f)) })) });
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.stored).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    await flush();
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(palette('preview'));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(store.puts).toHaveLength(1);
  });

  it('a saved Design draft is clean and does not start again when the stored form differs', async () => {
    store.normalise = (spec) => ({ ...spec, app: { ...spec.app, description: 'Stored form' } });
    renderAt('design');
    await deleteHeading();
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.stored).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    // Typing after the save keeps the session: nothing remounted and brought the heading back.
    await flush();
    expect(heading()).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(store.puts).toHaveLength(1);
  });
});

describe('a save works from the base it finds when it runs (V4-5, V4-6)', () => {
  it('asks about removed data against the tables the save before it left', async () => {
    store.manual = true;
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.puts).toHaveLength(1));
    // While that save is on its way: the new table goes and the first table is renamed. Against the base the person started
    // from this only renames; against the one the first save leaves, it removes a table.
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: /Crews/ }));
    fireEvent.change(screen.getAllByLabelText('Table name')[0], { target: { value: 'Crews two' } });
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: /Crews two/ })).toBeTruthy());
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('link', { name: /Preview/ }));
    await act(async () => {
      store.puts[0].release();
    });
    const dialog = await screen.findByRole('alertdialog', { name: 'Save and remove data?' });
    expect(dialog.textContent).toContain('New table');
    expect(store.puts).toHaveLength(1);
  });

  it('a left-behind save that failed is not queued again from its old base when the workspace goes', async () => {
    store.manual = true;
    const view = renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(palette('preview'));
    await waitFor(() => expect(store.puts).toHaveLength(1));
    // Another window saved first, so the save is refused; the workspace then goes away. The old draft is not queued again.
    await act(async () => {
      changeElsewhere((s) => {
        s.app.description = 'Other window';
      });
      store.puts[0].release();
    });
    await flush();
    view.unmount();
    await flush();
    expect(store.puts).toHaveLength(1);
  });
});

const undoButton = (): HTMLButtonElement => screen.getAllByRole('button', { name: 'Undo' })[0] as HTMLButtonElement;
const redoButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
/** The server stores each table with one more field, so the echo is never the tables that were sent. */
const echoAddsField = (): void => {
  store.normalise = (spec) => ({
    ...spec,
    tables: spec.tables.map((t) => ({ ...t, fields: t.fields.some((f) => f.id === 'server_note') ? t.fields : [...t.fields, { id: 'server_note', label: 'Server note', type: 'text' as const, required: false }] })),
  });
};

describe('the base after a Data save (V5-1, V5-2, V5-3)', () => {
  it('V5-1: a second save does not ask to remove data the server only added', async () => {
    echoAddsField();
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.stored).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    fireEvent.change(screen.getAllByLabelText('Table name')[0], { target: { value: 'New table two' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.stored).toHaveLength(2));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(store.puts).toHaveLength(2);
  });

  it('V5-2: an App settings save after a Data save keeps Undo', async () => {
    echoAddsField();
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(store.stored).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    expect(undoButton().disabled).toBe(false);
    const dialog = await saveSettings('Renamed');
    await waitFor(() => expect(store.stored).toHaveLength(2));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await flush();
    expect(undoButton().disabled).toBe(false);
  });

  it('V5-3: undoing back to clean onto a newer record says that Redo is cleared', async () => {
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    changeElsewhere((s) => {
      s.tables = [...s.tables, { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    });
    const dialog = await saveSettings('Renamed');
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(undoButton());
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('Started again from the latest saved version. Redo is cleared.'));
    expect(redoButton().disabled).toBe(true);
    expect(await within(screen.getByRole('navigation', { name: 'Tables' })).findByText('People')).toBeTruthy();
  });
});

describe('Design started again from a newer record (V5-3, V5-4)', () => {
  const REDO_CLEARED = 'Started again from the latest saved version. Redo is cleared.';
  /** A Design edit, a change from elsewhere that the shell learns of, then Undo back to clean with the keyboard on Undo. */
  async function undoOntoNewerRecord(): Promise<void> {
    renderAt('design');
    await deleteHeading();
    changeElsewhere((s) => {
      s.theme = { ...FOREST };
    });
    const dialog = await saveSettings('Renamed');
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const undo = screen.getAllByRole('button', { name: 'Undo' })[0] as HTMLButtonElement;
    undo.focus();
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
  }

  it('V5-3: undoing back to clean onto a newer record says that Redo is cleared', async () => {
    await undoOntoNewerRecord();
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain(REDO_CLEARED));
  });

  it('V5-3: starting again with no Redo to lose says nothing', async () => {
    renderAt('design');
    await waitFor(() => expect(heading()).not.toBeNull());
    changeElsewhere((s) => {
      s.theme = { ...FOREST };
    });
    const dialog = await saveSettings('Renamed');
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
    await flush();
    expect(screen.getByTestId('announcer').textContent).not.toContain(REDO_CLEARED);
  });

  it('V5-4: focus that was on Undo goes to the canvas, not the page body', async () => {
    await undoOntoNewerRecord();
    await waitFor(() => expect(canvas().contains(document.activeElement) || document.activeElement?.tagName === 'H3').toBe(true));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('the shell while it waits (V5-5, V5-6)', () => {
  it('V5-5: App settings saving itself does not say it waits for other saves', async () => {
    store.manual = true;
    renderAt('data');
    await screen.findByLabelText('Table name');
    const dialog = await saveSettings('Renamed');
    await waitFor(() => expect(store.puts).toHaveLength(1));
    await flush();
    expect(within(dialog).queryByText('Saving your changes first...')).toBeNull();
    await act(async () => {
      store.puts[0].release();
    });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });

  it('V5-6: the waiting line is not a live region and the shell announcer says it', async () => {
    store.manual = true;
    renderAt('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(palette('design'));
    const line = await screen.findByText('Saving your changes...', { selector: 'p' });
    expect(line.getAttribute('role')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('Saving your changes...'));
    await waitFor(() => expect(store.puts).toHaveLength(1));
    await act(async () => {
      store.puts[0].release();
    });
    await waitFor(() => expect(heading()).not.toBeNull());
  });
});
