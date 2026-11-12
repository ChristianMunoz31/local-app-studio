// The save on move rule with the real Data step (the shell's own tests use fake steps): overlapping saves, browser Back and
// Forward, moves go() does not run (the one fallback), a confirm that never settles, and focus.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID } from '../../__tests__/harness';
import AppWorkspace from '../AppWorkspace';

vi.mock('../DescribeTab', () => ({ default: () => <p>Describe tab</p> }));
vi.mock('../PreviewTab', () => ({ default: () => <p>Preview tab</p> }));
vi.mock('../DesignTab', () => ({ default: () => <p>Design tab</p> }));
vi.mock('../BuildTab', () => ({ default: () => <p>Build tab</p> }));

interface Put {
  url: string;
  baseRevision: number;
  spec: AppSpec;
  answer(response: Response): void;
}

const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const GONE_ID = '33333333-3333-4333-8333-333333333333';

const server = vi.hoisted(() => ({ mode: 'auto' as 'auto' | 'manual' | 'fail', puts: [] as Put[], revision: 3 }));

/** GET gives the app; PUT answers at once ("auto"), when the test says ("manual") or with a server error ("fail"). */
function mockServer(): void {
  server.mode = 'auto';
  server.puts = [];
  server.revision = 3;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url === `/api/studio/apps/${APP_ID}`) return json(200, { data: recordOf(baseSpec(), { revision: server.revision }) });
      if (method === 'GET' && url === `/api/studio/apps/${OTHER_ID}`) {
        const other = baseSpec();
        other.app.name = 'Other App';
        return json(200, { data: recordOf(other, { id: OTHER_ID, name: 'Other App', slug: 'other-app', revision: 7 }) });
      }
      if (method === 'GET' && url === `/api/studio/apps/${GONE_ID}`) return json(404, { error: 'app_not_found', message: 'That app does not exist.' });
      if (method === 'PUT') {
        const body = JSON.parse(init?.body as string) as { spec: AppSpec; baseRevision: number };
        const ok = (): Response => {
          server.revision = body.baseRevision + 1;
          return json(200, { data: recordOf(body.spec, { revision: server.revision }) });
        };
        if (server.mode === 'fail') return json(500, { error: 'server_error', message: 'The server said no.' });
        if (server.mode === 'auto') return ok();
        return new Promise<Response>((resolve) => {
          server.puts.push({ url, baseRevision: body.baseRevision, spec: body.spec, answer: (r) => resolve(r) });
        });
      }
      return json(404, { error: 'not_found' });
    }),
  );
}
const answerOk = (put: Put): void => put.answer(json(200, { data: recordOf(put.spec, { revision: put.baseRevision + 1 }) }));
const putCalls = (): unknown[][] => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');

/** Stands in for the kit command palette: it calls navigate() itself. */
function Palette({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Palette
    </button>
  );
}

const routes = (
  <Routes>
    <Route path="/apps" element={<p>Apps list</p>} />
    <Route path="/features" element={<p>Features page</p>} />
    <Route path="/apps/:appId/*" element={<AppWorkspace />} />
  </Routes>
);
const renderApp = (path: string, state?: unknown, palette = '/features') =>
  render(
    <MemoryRouter initialEntries={[{ pathname: `/apps/${APP_ID}/${path}`, state }]}>
      <Palette to={palette} />
      {routes}
    </MemoryRouter>,
  );

const addTable = (): void => {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: 'Add table' }));
};
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const rail = () => screen.getByRole('navigation', { name: 'Steps' });
const announced = () => within(screen.getByTestId('announcer')).getByRole('status').textContent;
const detached = () => document.querySelector('[data-testid="detached-announcer"]')?.textContent ?? '';
/** Lets every promise that is already settled run (and React render what they set): what has not happened by then waits on something. */
const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

// Announcements wait a short join window before they are spoken, and a busy machine slows the renders around them.
configure({ asyncUtilTimeout: 4000 });

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.querySelectorAll('[data-testid="detached-announcer"]').forEach((n) => n.remove());
  mockServer();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppWorkspace saves with the real Data step', () => {
  it('saves both edits when a move starts before the first save has answered, with no conflict (V-1)', async () => {
    server.mode = 'manual';
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(screen.getByTestId('save-status').textContent).toBe('Saving...');
    addTable();
    // Next and Back wait while a save is on its way; a link click is the move that starts anyway.
    fireEvent.click(within(rail()).getByRole('link', { name: /Preview/ }));
    await flush();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0].spec.tables).toHaveLength(2);
    await act(async () => {
      answerOk(server.puts[0]);
    });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].baseRevision).toBe(4);
    expect(server.puts[1].spec.tables).toHaveLength(3);
    await act(async () => {
      answerOk(server.puts[1]);
    });
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText(/changed in another window/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
  });

  it('saves a valid dirty step when Back leaves it, through the same gate as the rail (P-01, V-2a, R-4)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    act(() => window.history.back());
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/preview`);
    expect(putCalls()).toHaveLength(1);
    expect(JSON.parse((putCalls()[0][1] as RequestInit).body as string).spec.tables).toHaveLength(2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(putCalls()).toHaveLength(1);
  });

  it('does not grow the history on a guarded Back, and puts the sentinel back after it is used (M1, M2)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const armed = window.history.length;
    expect(window.history.state).toHaveProperty('studioSentinel', true);
    act(() => window.history.back());
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(window.history.length).toBe(armed);
    expect(window.history.state).not.toHaveProperty('studioSentinel');
    expect(putCalls()).toHaveLength(1);
  });

  it('lands on the real previous entry after a guarded Back, and Forward returns to the step with the saved change (J5)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    act(() => window.history.back());
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await flush();
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/preview`);
    act(() => window.history.forward());
    await screen.findByLabelText('Table name');
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/data`);
    expect(putCalls()).toHaveLength(1);
    expect(JSON.parse((putCalls()[0][1] as RequestInit).body as string).spec.tables).toHaveLength(2);
  });

  it('takes the sentinel off when the guard turns off, so one Back press leaves after a save (M2)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(window.history.state).toHaveProperty('studioSentinel', true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    await waitFor(() => expect(window.history.state).not.toHaveProperty('studioSentinel'));
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/data`);
    act(() => window.history.back());
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/preview`);
    // Editing again re-arms the guard with a new sentinel.
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(window.history.state).toHaveProperty('studioSentinel', true));
  });

  it('asks before Back drops a draft that cannot be saved, and Stay keeps it (P-01, B1b, V-2a)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    const name = await screen.findByLabelText('Table name');
    fireEvent.change(name, { target: { value: '' } });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    act(() => window.history.back());
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Data cannot be saved yet' });
    expect(screen.queryByText('Preview tab')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/data`);
    expect(screen.getByLabelText('Table name')).toBeTruthy();
    // A second Back asks again, and Discard changes lets it through.
    act(() => window.history.back());
    const again = await screen.findByRole('alertdialog', { name: 'Your changes on Data cannot be saved yet' });
    fireEvent.click(within(again).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(putCalls()).toHaveLength(0);
  });

  it('saves to the app it was made in, from its own revision, when the person opens another app (V2-1)', async () => {
    renderApp('data', undefined, `/apps/${OTHER_ID}/data`);
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    await waitFor(() => expect(detached()).toBe('Saved your changes on Data.'));
    const puts = putCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe(`/api/studio/apps/${APP_ID}`);
    const body = JSON.parse((puts[0][1] as RequestInit).body as string) as { baseRevision: number; spec: AppSpec };
    expect(body.baseRevision).toBe(3);
    expect(body.spec.tables).toHaveLength(2);
    // The new app loads normally and the old save's answer did not touch it.
    expect(await screen.findByRole('heading', { level: 2, name: 'Other App' })).toBeTruthy();
    expect(screen.getByTestId('save-status').textContent).toBe('All changes saved');
    expect(screen.getByLabelText('Table name')).toBeTruthy();
  });

  it('holds App settings until a Data save that is on its way is over, then sends the revision it made (V2-2, V4-2)', async () => {
    server.mode = 'manual';
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'App settings' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Renamed' } });
    const submit = within(dialog).getByRole('button', { name: 'Save settings' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Saving your changes first...')).toBeTruthy();
    fireEvent.click(submit);
    await flush();
    expect(server.puts).toHaveLength(1);
    await act(async () => {
      answerOk(server.puts[0]);
    });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save settings' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(server.puts).toHaveLength(2));
    // The revision is read when Save settings is pressed: the Data save made revision 4.
    expect(server.puts[1].baseRevision).toBe(4);
    await act(async () => {
      server.puts[1].answer(json(409, { error: 'revision_conflict', message: 'Changed elsewhere.', revision: 5 }));
    });
    expect(await within(dialog).findByText(/changed in another window/)).toBeTruthy();
  });

  it('does not pull the person back to the step it was heading for when a navigate() call took them elsewhere (V2-3)', async () => {
    server.mode = 'manual';
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    await waitFor(() => expect(server.puts).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
    await act(async () => {
      answerOk(server.puts[0]);
    });
    await flush();
    expect(screen.getByText('Features page')).toBeTruthy();
    expect(screen.queryByText('Preview tab')).toBeNull();
    // One save only: the move's save counted for the tab, so the fallback did not save it again.
    expect(server.puts).toHaveLength(1);
  });

  it('saves edits typed while the move was saving before it leaves (V2-4)', async () => {
    server.mode = 'manual';
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    await waitFor(() => expect(server.puts).toHaveLength(1));
    addTable();
    await act(async () => {
      answerOk(server.puts[0]);
    });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].baseRevision).toBe(4);
    expect(server.puts[1].spec.tables).toHaveLength(3);
    expect(screen.queryByText('Preview tab')).toBeNull();
    await act(async () => {
      answerOk(server.puts[1]);
    });
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('saves a dirty step that a navigate() call closes, and says so (V-2b, R-4)', async () => {
    renderApp('data', undefined, `/apps/${APP_ID}/preview`);
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse((putCalls()[0][1] as RequestInit).body as string).spec.tables).toHaveLength(2);
    await waitFor(() => expect(detached()).toBe('Saved your changes on Data.'));
  });

  it('saves when a navigate() call leaves the whole app', async () => {
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    await waitFor(() => expect(detached()).toBe('Saved your changes on Data.'));
  });

  it('says the changes were not saved when a navigate() call closes a step that cannot save', async () => {
    server.mode = 'fail';
    renderApp('data', undefined, `/apps/${APP_ID}/preview`);
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await waitFor(() => expect(detached()).toBe('Your changes on Data were not saved.'));
  });

  it('does not save a second time for a step that the move already saved', async () => {
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await flush();
    expect(putCalls()).toHaveLength(1);
    expect(detached()).toBe('');
  });

  it('does not lock the next move when the data question closes with its step (V-3, R-16)', async () => {
    renderApp('data', undefined, `/apps/${APP_ID}/build`);
    await screen.findByLabelText('Table name');
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    await screen.findByRole('alertdialog', { name: 'Save and remove data?' });
    // The step goes (a navigate() call) while the question is open.
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Build tab')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
    // The rail is not stuck in a move: Back works.
    const back = screen.getByRole('button', { name: 'Back: Preview' });
    expect(back.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(back);
    expect(await screen.findByText('Preview tab')).toBeTruthy();
  });

  it('keeps focus on Next while the save runs, and returns it there after Stay (R-2)', async () => {
    server.mode = 'manual';
    renderApp('data');
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const next = screen.getByRole('button', { name: 'Next: Preview' });
    next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(server.puts).toHaveLength(1));
    const busy = within(screen.getByRole('group', { name: 'Move between steps' })).getByRole('button', { name: 'Saving...' });
    expect(busy).toBe(next);
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(next);
    // A second press while busy does nothing.
    fireEvent.click(busy);
    expect(server.puts).toHaveLength(1);
    await act(async () => {
      answerOk(server.puts[0]);
    });
    expect(await screen.findByText('Preview tab')).toBeTruthy();
  });

  it('hands focus back to Back when the stuck dialog is closed with Stay (R-2)', async () => {
    renderApp('data');
    const name = await screen.findByLabelText('Table name');
    fireEvent.change(name, { target: { value: '' } });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    const back = screen.getByRole('button', { name: 'Back: Design' });
    back.focus();
    fireEvent.click(back);
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Stay' })));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back: Design' })));
  });

  it('tells a keyboard user why Next does not move (R-11)', async () => {
    renderApp('data');
    const name = await screen.findByLabelText('Table name');
    fireEvent.change(name, { target: { value: '' } });
    const next = screen.getByRole('button', { name: 'Next: Preview' });
    await waitFor(() => expect(next.getAttribute('aria-disabled')).toBe('true'));
    next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(announced()).toMatch(/^Fix the tables marked Needs a fix to go on: /));
    expect(document.activeElement).toBe(next);
  });

  it('asks the browser to confirm closing the window while Data has unsaved changes, with returnValue set (V-10)', async () => {
    renderApp('data');
    await screen.findByLabelText('Table name');
    const early = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(false);
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', { value: 'unset', writable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect((event as Event & { returnValue: unknown }).returnValue).toBe('');
  });

  it('saves again with the new table when Back leaves Data while the move to Preview is still saving (V3-1)', async () => {
    server.mode = 'manual';
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].spec.tables).toHaveLength(2);
    addTable();
    act(() => window.history.back());
    await flush();
    // The second save waits for the first: it must not be sent from the revision the first one is replacing.
    expect(server.puts).toHaveLength(1);
    await act(async () => {
      answerOk(server.puts[0]);
    });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].baseRevision).toBe(4);
    expect(server.puts[1].spec.tables).toHaveLength(3);
    await act(async () => {
      answerOk(server.puts[1]);
    });
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(screen.queryByText(/changed in another window/)).toBeNull();
    expect(server.puts).toHaveLength(2);
  });

  it('sends the edits made after Ctrl+S from the revision Ctrl+S returned when Back leaves before its answer (V3-2)', async () => {
    server.mode = 'manual';
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(server.puts).toHaveLength(1));
    addTable();
    act(() => window.history.back());
    await flush();
    await act(async () => {
      answerOk(server.puts[0]);
    });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].baseRevision).toBe(4);
    expect(server.puts[1].spec.tables).toHaveLength(3);
    // The server would refuse a second save sent from revision 3 with a conflict; this one is from 4, so it is kept.
    await act(async () => {
      answerOk(server.puts[1]);
    });
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(screen.queryByText(/changed in another window/)).toBeNull();
  });

  it('sends nothing after Discard, not even when the step closes', async () => {
    renderApp('data');
    const name = await screen.findByLabelText('Table name');
    fireEvent.change(name, { target: { value: '' } });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Back: Design' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Data cannot be saved yet' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Design tab')).toBeTruthy();
    await flush();
    expect(putCalls()).toHaveLength(0);
    expect(detached()).toBe('');
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('All changes saved'));
  });

  it('sends nothing when StrictMode mounts the workspace twice, and one save for one move', async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/apps/${APP_ID}/data`]}>{routes}</MemoryRouter>
      </StrictMode>,
    );
    await screen.findByLabelText('Table name');
    await flush();
    expect(putCalls()).toHaveLength(0);
    expect(detached()).toBe('');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await flush();
    expect(putCalls()).toHaveLength(1);
    expect(detached()).toBe('');
  });

  it('focuses the step heading and says the step when an app is opened with the focus state (R-5)', async () => {
    renderApp('', { stepFocus: true });
    await screen.findByText('Design tab');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Design' })));
    await waitFor(() => expect(announced()).toBe('Step 2 of 5.'));
  });

  it('a Back on the first history entry of a tab saves, replaces the sentinel and never leaves a swallow behind (N1)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/data`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(window.history.state).toHaveProperty('studioSentinel', true);
    expect(window.history.state).toHaveProperty('idx', 0);
    act(() => window.history.back());
    // Nothing could be popped (no entry before the step), so the move replaced the sentinel instead of waiting for ever.
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(window.location.pathname).toBe('/apps');
    expect(putCalls()).toHaveLength(1);
    expect(window.history.state).not.toHaveProperty('studioSentinel');
  });

  it('keeps the place Back came from, such as Features, when the workspace was opened from it (N2)', async () => {
    window.history.replaceState(null, '', '/features');
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/features" element={<Link to={`/apps/${APP_ID}/data`}>Open the app</Link>} />
          <Route path="/apps" element={<p>Apps list</p>} />
          <Route path="/apps/:appId/*" element={<AppWorkspace />} />
        </Routes>
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Open the app' }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/features'));
    await flush();
    expect(window.location.pathname).toBe('/features');
    expect(screen.queryByText('Apps list')).toBeNull();
    expect(putCalls()).toHaveLength(1);
  });

  it('does nothing more when a newer navigation got in before the step back happened (N3)', async () => {
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(
      <BrowserRouter>
        <Palette to="/features" />
        {routes}
      </BrowserRouter>,
    );
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const realGo = window.history.go.bind(window.history);
    const spy = vi.spyOn(window.history, 'go').mockImplementation((delta?: number) => {
      // A palette or link navigation lands between the call and the browser's step.
      fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
      realGo(delta);
    });
    act(() => window.history.back());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    spy.mockRestore();
    // The step back is not followed by a second, stale replace toward the place Back was heading for.
    expect(window.location.pathname).not.toBe(`/apps/${APP_ID}/preview`);
    expect(putCalls()).toHaveLength(1);
  });

  it('replaces a deleted app reached by Forward with the Apps list, but a first visit still says it is gone (L3)', async () => {
    window.history.replaceState(null, '', `/apps/${GONE_ID}/data`);
    render(<BrowserRouter>{routes}</BrowserRouter>);
    expect(await screen.findByText('That app does not exist.')).toBeTruthy();
    cleanup();
    window.history.replaceState(null, '', '/apps');
    render(
      <BrowserRouter>
        <Palette to={`/apps/${GONE_ID}/data`} />
        {routes}
      </BrowserRouter>,
    );
    await screen.findByText('Apps list');
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/apps/${GONE_ID}/data`));
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/apps'));
    act(() => window.history.forward());
    await waitFor(() => expect(window.location.pathname).toBe('/apps'));
    expect(screen.queryByText('That app does not exist.')).toBeNull();
    expect(await screen.findByText('Apps list')).toBeTruthy();
  });
});
