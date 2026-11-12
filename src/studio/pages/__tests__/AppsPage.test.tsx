import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useReducer } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { readFresh, readPrompt, readStartWords, removedAppState, writePrompt, writeStartWords } from '../../lib/appMemory';
import AppsPage from '../AppsPage';

// Only the metadata is real: the example bodies come through a stub (the JSON has its own test).
const example = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/studio/examples', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/studio/examples')>();
  return { ...actual, loadExample: example.load };
});

// These tests are about the helper's screens, so the helper is in the build they run in (a public run has no helper: helperNotInBuild.test.tsx).
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
const download = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('../../lib/download', () => ({ downloadJson: download.json }));

// the helper state is the one thing the page reads from outside Studio: null is "not known yet"
const helper = vi.hoisted(() => ({ setup: null as null | { ready: boolean; ollama: string }, listeners: new Set<() => void>() }));
vi.mock('@/hooks/useOllamaSetup.js', () => ({
  useOllamaSetup: () => {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      helper.listeners.add(rerender);
      return () => {
        helper.listeners.delete(rerender);
      };
    }, []);
    return {
    setup: helper.setup,
    isLoading: false,
    isFetching: false,
    error: null,
    checkAgain: vi.fn(),
    pull: { status: 'idle' },
    startPull: vi.fn(),
    cancel: vi.fn(),
    };
  },
}));

const summary = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Crew Roster',
  slug: 'crew-roster',
  revision: 1,
  ok: true,
  issueCount: 0,
  tableCount: 1,
  pageCount: 1,
  description: '',
  hasInstaller: false,
  waiting: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
  ...over,
});

const Where = () => {
  const loc = useLocation();
  return (
    <>
      <p data-testid="where">{loc.pathname}</p>
      <p data-testid="state">{JSON.stringify(loc.state)}</p>
    </>
  );
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/apps']}>
      <Routes>
        <Route path="/apps" element={<AppsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

/** Presses the first Create (the header one) and waits for the prompt box. */
const openBox = async (): Promise<HTMLTextAreaElement> => {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Create' }))[0]);
  return (await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement;
};

// jest-dom is not installed: resolve aria-describedby the way assistive tech does
const descriptionOf = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

let fetchMock: ReturnType<typeof vi.fn>;
const mockFetch = (impl: (url: string, init?: RequestInit) => Response) => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  helper.setup = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppsPage', () => {
  it('lists apps with counts and a repair badge for broken rows', async () => {
    mockFetch(() => json(200, { data: [summary(), summary({ id: '22222222-2222-4222-8222-222222222222', name: 'Old', ok: false, tableCount: 0, pageCount: 0 })] }));
    renderPage();
    expect(await screen.findByRole('link', { name: 'Crew Roster' })).toBeTruthy();
    expect(screen.getByText(/1 table, 1 page/)).toBeTruthy();
    expect(screen.getByText('Needs repair')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Old' }));
    expect(screen.getByRole('menuitem', { name: 'Duplicate' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('renders one link per card with description, installer badge and edited time', async () => {
    mockFetch(() =>
      json(200, {
        data: [
          summary({ description: 'Who works which job.', hasInstaller: true }),
          summary({ id: '22222222-2222-4222-8222-222222222222', name: 'Dog Walks' }),
        ],
      }),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: 'Crew Roster' });
    expect(link.getAttribute('href')).toBe('/apps/11111111-1111-4111-8111-111111111111');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Who works which job.')).toBeTruthy();
    expect(screen.getAllByText('No description yet.')).toHaveLength(1);
    expect(screen.getAllByText('Installer built')).toHaveLength(1);
    expect(screen.getAllByText(/Edited /).length).toBe(2);
  });

  it('announces the repair and installer pills in the link description', async () => {
    mockFetch(() =>
      json(200, {
        data: [
          summary({ name: 'Old', ok: false }),
          summary({ id: '22222222-2222-4222-8222-222222222222', name: 'Built', hasInstaller: true }),
          summary({ id: '33333333-3333-4333-8333-333333333333', name: 'Plain' }),
        ],
      }),
    );
    renderPage();
    await screen.findByRole('link', { name: 'Old' });
    expect(descriptionOf(screen.getByRole('link', { name: 'Old' }))).toMatch(/Needs repair/);
    expect(descriptionOf(screen.getByRole('link', { name: 'Built' }))).toMatch(/Installer built/);
    expect(descriptionOf(screen.getByRole('link', { name: 'Plain' }))).not.toMatch(/Needs repair|Installer built/);
  });

  it('exports through the menu, names the file after the app and says what it holds (P17-15)', async () => {
    download.json.mockClear();
    mockFetch((url) => (url.endsWith('/11111111-1111-4111-8111-111111111111') ? json(200, { data: { ...recordOf(baseSpec()), name: 'Crew Roster' } }) : json(200, { data: [summary()] })));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    await waitFor(() => expect(download.json).toHaveBeenCalled());
    expect(download.json.mock.calls[0][0]).toBe('Crew Roster app.json');
    expect((await screen.findByRole('status')).textContent).toBe(
      'Exported "Crew Roster" as Crew Roster app.json. It holds the design. Records added in Preview stay on this computer.',
    );
  });

  it('says on the card that a design is waiting, with plural rules (P17-01)', async () => {
    mockFetch(() =>
      json(200, {
        data: [
          summary({ id: '22222222-2222-4222-8222-222222222222', name: 'Waits', waiting: { tableCount: 1, pageCount: 2 } }),
          summary({ name: 'Plain' }),
          summary({ id: '33333333-3333-4333-8333-333333333333', name: 'Many', waiting: { tableCount: 2, pageCount: 1 } }),
        ],
      }),
    );
    renderPage();
    await screen.findByRole('link', { name: 'Waits' });
    expect(descriptionOf(screen.getByRole('link', { name: 'Waits' }))).toMatch(/A design is waiting: 1 table, 2 pages\./);
    expect(descriptionOf(screen.getByRole('link', { name: 'Many' }))).toMatch(/A design is waiting: 2 tables, 1 page\./);
    expect(descriptionOf(screen.getByRole('link', { name: 'Plain' }))).not.toMatch(/waiting/);
  });

  it('opens Design on the Look tab from Change look', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change look' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/11111111-1111-4111-8111-111111111111/design'));
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({ stepFocus: true, shelfTab: 'look' });
  });

  it('does not offer Change look for an app that needs repair', async () => {
    mockFetch(() => json(200, { data: [summary({ ok: false })] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    expect(screen.getByRole('menuitem', { name: 'Change look' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('Duplicate asks for the copy name first, sends it and says what was made (P17-16)', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: { ...recordOf(baseSpec()), name: 'North Site' } });
      return json(200, { data: [summary()] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Crew Roster' });
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
    const box = within(dialog).getByLabelText('Name') as HTMLInputElement;
    expect(box.value).toBe('Crew Roster Copy');
    expect(within(dialog).getByText('The copy starts with no records.')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'North Site' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ name: 'North Site' });
    expect(screen.getByRole('status').textContent).toBe('Duplicated "Crew Roster" as "North Site". The copy starts with no records.');
  });

  it('Cancel on the Duplicate dialog makes no copy, and a bad name is refused in the dialog', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Crew Roster' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Use 2 to 40 letters/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('Cancel on the Duplicate dialog returns the focus to the card menu button, and the name box is off while it works', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'More actions for Crew Roster' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Crew Roster' });
    expect(within(dialog).getByRole('checkbox').getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('opens an app from its card with the focus state, so the step heading is focused and announced (R-5)', async () => {
    mockFetch(() => json(200, { data: [summary({ name: 'Crew Roster' })] }));
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: 'Crew Roster' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/11111111-1111-4111-8111-111111111111'));
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({ stepFocus: true });
  });

  it('shows the empty state', async () => {
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    expect(await screen.findByText('No apps yet. Press Create to describe one, or import an app file. Or open an example below.')).toBeTruthy();
    // one Blank app button on the screen, in the empty state
    expect(screen.getAllByRole('button', { name: 'Blank app' })).toHaveLength(1);
    // Create is in the header and in the empty row
    expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2);
  });

  it('has no start box on load without saved words, and Create comes first in the Apps card action slot', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    const create = screen.getByRole('button', { name: 'Create' });
    const row = create.parentElement as HTMLElement;
    expect(row.firstElementChild).toBe(create);
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('justify-end');
  });

  it('Create opens the start box under the status line, above the Apps card, with the cursor in it', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const box = await screen.findByLabelText('Your prompt');
    await waitFor(() => expect(document.activeElement).toBe(box));
    const status = screen.getByRole('status');
    const startHeading = screen.getByRole('heading', { name: 'What do you want to build?' });
    const appsHeading = screen.getByRole('heading', { name: 'Apps' });
    expect(status.compareDocumentPosition(startHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(startHeading.compareDocumentPosition(appsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.className).not.toContain('empty:-mb-5');
  });

  it('Cancel closes the box and puts the focus back on the Create that was pressed', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    const create = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(create);
    await screen.findByLabelText('Your prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    expect(document.activeElement).toBe(create);
  });

  it('Cancel from the empty-state Create returns the focus to that button', async () => {
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: 'Create' });
    const emptyOne = buttons[1];
    fireEvent.click(emptyOne);
    await screen.findByLabelText('Your prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(emptyOne);
  });

  it('opens the box on load when start words are saved, with the words in it and without moving focus', async () => {
    writeStartWords('Crew roster for my painting business.');
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    const box = (await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement;
    expect(box.value).toBe('Crew roster for my painting business.');
    expect(document.activeElement).not.toBe(box);
    // Cancel leaves the stored words, so Create brings them back
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('Crew roster for my painting business.');
  });

  it('creates a blank app and opens its Prompt step', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      if (init?.method === 'PUT') return json(200, { data: recordOf(JSON.parse(init.body as string).spec, { revision: 2 }) });
      return json(200, { data: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Blank app' }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Crew Roster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create app' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/11111111-1111-4111-8111-111111111111/prompt'));
    // The new app opens with the focus state, so its step heading is focused and the step announced (R-5).
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({ stepFocus: true });
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ name: 'Crew Roster' });
    // the second request saves the plain look (no id, solid background) on the blank app, on the created revision
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
    const sent = JSON.parse((put?.[1] as RequestInit).body as string);
    expect(sent.spec.theme.id).toBeUndefined();
    expect(sent.spec.theme.preset).toBe('solid');
    expect(sent.baseRevision).toBe(recordOf(baseSpec()).revision);
  });

  it('starts from a description with the derived name and launch state', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      if (init?.method === 'PUT') return json(200, { data: recordOf(JSON.parse(init.body as string).spec, { revision: 2 }) });
      return json(200, { data: [summary({ name: 'Crew Roster' })] });
    });
    renderPage();
    await openBox();
    const make = (await screen.findByRole('button', { name: 'Make my app' })) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: '  Crew roster for my painting business.  ' } });
    fireEvent.click(make);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/11111111-1111-4111-8111-111111111111/prompt'));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ name: 'Crew Roster 2' });
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({
      describe: { mode: 'create', instruction: 'Crew roster for my painting business.' },
      stepFocus: true,
    });
  });

  it('keeps the words with the new app and marks it untouched, and clears the start box words (P-02, P-08)', async () => {
    writeStartWords('Old words');
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      if (init?.method === 'PUT') return json(200, { data: recordOf(JSON.parse(init.body as string).spec, { revision: 2 }) });
      return json(200, { data: [] });
    });
    renderPage();
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('Old words');
    fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: 'Crew roster for my painting business.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/11111111-1111-4111-8111-111111111111/prompt'));
    expect(readPrompt('11111111-1111-4111-8111-111111111111')).toBe('Crew roster for my painting business.');
    expect(readFresh('11111111-1111-4111-8111-111111111111')).toBe(2);
    expect(readStartWords()).toBe('');
  });

  it('says once that an empty app was removed and shows its words in the box (P-08)', async () => {
    writeStartWords('Crew roster for my painting business.');
    mockFetch(() => json(200, { data: [] }));
    render(
      <MemoryRouter initialEntries={[{ pathname: '/apps', state: removedAppState('Crew Roster') }]}>
        <Routes>
          <Route path="/apps" element={<AppsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Removed the empty app Crew Roster. Your words are back in the box.')).toBeTruthy();
    expect((screen.getByLabelText('Your prompt') as HTMLTextAreaElement).value).toBe('Crew roster for my painting business.');
  });

  it('S1: the notice region is on the page while the list loads and gets its text after it mounted, so it is read', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock = vi.fn(async () => {
      await held;
      return json(200, { data: [summary()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[{ pathname: '/apps', state: removedAppState('Crew Roster') }]}>
        <Routes>
          <Route path="/apps" element={<AppsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // Still loading: the region is already there and its text arrives as a change, not as first content.
    const notice = await screen.findByText('Removed the empty app Crew Roster. Your words are back in the box.');
    expect(notice.getAttribute('role')).toBe('status');
    release();
    await screen.findByRole('link', { name: 'Crew Roster' });
    expect(screen.getByText('Removed the empty app Crew Roster. Your words are back in the box.')).toBe(notice);
    expect(notice.isConnected).toBe(true);
  });

  it('shows a create error under the box and does not navigate', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(409, { error: 'too_many_apps', message: 'You have too many apps.' });
      return json(200, { data: [] });
    });
    renderPage();
    await screen.findByText(/No apps yet/);
    await openBox();
    fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: 'Dog walks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    expect(screen.queryByTestId('where')).toBeNull();
    expect((screen.getByRole('button', { name: 'Make my app' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rejects a bad name without a request', async () => {
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Blank app' }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: '1x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create app' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/2 to 40 letters/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks before deleting and removes the row', async () => {
    writePrompt('11111111-1111-4111-8111-111111111111', 'Crew roster');
    mockFetch((url, init) => {
      if (init?.method === 'DELETE') return json(200, { data: { id: 'x' } });
      return json(200, { data: [summary()] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Crew Roster?' });
    expect(within(dialog).getByText(/Its design and build history are removed/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Keep app' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete app' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Crew Roster' })).toBeNull());
    // Everything the browser kept about the app goes with it.
    expect(readPrompt('11111111-1111-4111-8111-111111111111')).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Apps' })));
  });

  it('shows the issues of an invalid import file and sends nothing', async () => {
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    await screen.findByText(/No apps yet/);
    const bad = new File([JSON.stringify({ specVersion: 1 })], 'bad.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [bad] } });
    expect(await screen.findByText('This file cannot be imported')).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/This is not an app file from Local App Studio, or it was changed by hand. Nothing was imported./)).toBeTruthy();
    // the problems are folded, in words, with no code path
    expect(dialog.textContent).toContain('App: This is missing.');
    expect(dialog.textContent).not.toMatch(/specVersion|Invalid input/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says a file with problems inside is not an Export file, with the next step', async () => {
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    await screen.findByText(/No apps yet/);
    const spec = baseSpec();
    spec.tables[0].fields[0].label = '';
    const odd = new File([JSON.stringify(spec)], 'odd.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [odd] } });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('This file has problems, so nothing was imported. Ask the person who sent it for a new export.')).toBeTruthy();
    expect(dialog.textContent).toMatch(/Table 1, field 1/);
  });

  it('shows a file that is not an app file in the card body', async () => {
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    await screen.findByText(/No apps yet/);
    const text = new File(['hello'], 'x.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [text] } });
    expect((await screen.findByRole('alert')).textContent).toBe('That file is not an app file. Pick a file exported from Local App Studio.');
    expect(screen.getByRole('button', { name: 'Import an app' })).toBeTruthy();
  });

  it('imports a valid file', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      return json(200, { data: [] });
    });
    renderPage();
    await screen.findByText(/No apps yet/);
    const good = new File([JSON.stringify(baseSpec())], 'good.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [good] } });
    expect(await screen.findByText('Imported "Crew Roster".')).toBeTruthy();
  });

  it('names an imported app apart when another app has its name, and says so (P-41)', async () => {
    let posted: { spec?: { app?: { name?: string } } } = {};
    mockFetch((url, init) => {
      if (init?.method === 'POST') {
        posted = JSON.parse(String(init.body)) as typeof posted;
        const spec = baseSpec();
        spec.app.name = 'Crew Roster 2';
        return json(201, { data: recordOf(spec, { name: 'Crew Roster 2' }) });
      }
      return json(200, { data: [summary()] });
    });
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    const file = new File([JSON.stringify(baseSpec())], 'again.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });
    expect(await screen.findByText('Imported "Crew Roster" as "Crew Roster 2".')).toBeTruthy();
    expect(posted.spec?.app?.name).toBe('Crew Roster 2');
  });

  it('shows one import message at a time (P-42)', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      return json(200, { data: [] });
    });
    renderPage();
    await screen.findByText(/No apps yet/);
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [new File([JSON.stringify(baseSpec())], 'good.json', { type: 'application/json' })] } });
    expect(await screen.findByText('Imported "Crew Roster".')).toBeTruthy();
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [new File(['hello'], 'x.json', { type: 'application/json' })] } });
    expect((await screen.findByRole('alert')).textContent).toBe('That file is not an app file. Pick a file exported from Local App Studio.');
    expect(screen.queryByText('Imported "Crew Roster".')).toBeNull();
  });

  it('makes no app while the helper is down, shows the setup card and keeps the text', async () => {
    helper.setup = { ready: false, ollama: 'missing' };
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    fireEvent.change(await openBox(), { target: { value: 'Crew roster for my painting business.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    const heading = await screen.findByRole('heading', { name: 'Set up the helper (Ollama)' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method === undefined)).toBe(true);
    expect((screen.getByLabelText('Your prompt') as HTMLTextAreaElement).value).toBe('Crew roster for my painting business.');
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('shows the setup card under the opened box, and Cancel removes both', async () => {
    helper.setup = { ready: false, ollama: 'missing' };
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    fireEvent.change(await openBox(), { target: { value: 'Crew roster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    const setup = await screen.findByRole('heading', { name: 'Set up the helper (Ollama)' });
    const boxHeading = screen.getByRole('heading', { name: 'What do you want to build?' });
    expect(boxHeading.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Set up the helper (Ollama)' })).toBeNull();
  });

  it('says the helper is ready, in the status line, once the card under the opened box finds it ready', async () => {
    helper.setup = { ready: false, ollama: 'missing' };
    mockFetch(() => json(200, { data: [] }));
    renderPage();
    const box = await openBox();
    fireEvent.change(box, { target: { value: 'Crew roster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    await screen.findByRole('heading', { name: 'Set up the helper (Ollama)' });
    expect(screen.queryByText('The helper is ready. Press Make my app.')).toBeNull();
    act(() => {
      helper.setup = { ready: true, ollama: 'ready' };
      helper.listeners.forEach((fn) => fn());
    });
    expect((await screen.findByRole('status')).textContent).toContain('The helper is ready. Press Make my app.');
    expect(screen.queryByRole('heading', { name: 'Set up the helper (Ollama)' })).toBeNull();
  });

  it('starts a blank app instead, with the name made from the description', async () => {
    helper.setup = { ready: false, ollama: 'missing' };
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      if (init?.method === 'PUT') return json(200, { data: recordOf(JSON.parse(init.body as string).spec, { revision: 2 }) });
      return json(200, { data: [] });
    });
    renderPage();
    fireEvent.change(await openBox(), { target: { value: 'Dog walks for the street.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start a blank app instead' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a blank app' });
    expect((within(dialog).getByLabelText('App name') as HTMLInputElement).value).toBe('Dog Walks');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create app' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/11111111-1111-4111-8111-111111111111/prompt'));
  });

  it('keeps the old path while the helper state is not known', async () => {
    helper.setup = null;
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      if (init?.method === 'PUT') return json(200, { data: recordOf(JSON.parse(init.body as string).spec, { revision: 2 }) });
      return json(200, { data: [] });
    });
    renderPage();
    fireEvent.change(await openBox(), { target: { value: 'Dog walks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/prompt'));
  });

  it('offers Try again next to a list that did not load', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return calls === 1 ? json(500, { error: 'boom' }) : json(200, { data: [summary()] });
    });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach Local App Studio/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Crew Roster' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what failed and what to do when an export fails or a duplicate is refused', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return json(500, { error: 'boom', message: 'internal detail' });
      if (url.endsWith('/11111111-1111-4111-8111-111111111111')) return json(500, { error: 'boom', message: 'internal detail' });
      return json(200, { data: [summary()] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not export the app. Nothing was changed. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Duplicate Crew Roster' })).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('internal detail'));
  });

  it('shows the waiting line in the same pill tone as the other card pills', async () => {
    mockFetch(() => json(200, { data: [summary({ name: 'Waits', waiting: { tableCount: 1, pageCount: 2 }, hasInstaller: true })] }));
    renderPage();
    await screen.findByRole('link', { name: 'Waits' });
    const line = screen.getByText('A design is waiting: 1 table, 2 pages.');
    const sibling = screen.getByText('Installer built');
    // The pill with rounded-full swapped for rounded-lg (one radius class, not two that depend on stylesheet order).
    expect(line.className).toContain(PILL.replace('rounded-full', 'rounded-lg'));
    expect(line.className).not.toContain('rounded-full');
    // Pending, not done: not the green of Installer built; and it wraps inside the card.
    expect(sibling.className).toContain(TONE_CLASS.ok);
    expect(line.className).toContain(TONE_CLASS.warn);
    expect(line.className).not.toContain(TONE_CLASS.ok);
    expect(line.className).toContain('max-w-full');
    expect(line.className).toContain('whitespace-normal');
  });

  it('keeps one status region on the page that exists before a notice and only changes its text', async () => {
    download.json.mockClear();
    mockFetch((url) => (url.endsWith('/11111111-1111-4111-8111-111111111111') ? json(200, { data: { ...recordOf(baseSpec()), name: 'Crew Roster' } }) : json(200, { data: [summary()] })));
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    await waitFor(() => expect(region.textContent).toMatch(/^Exported "Crew Roster"/));
    expect(screen.getByRole('status')).toBe(region);
  });

  it('the Duplicate dialog joins its error to the name box with the hint, and clears it when the name changes', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Crew Roster' });
    const box = within(dialog).getByLabelText('Name');
    const hintId = box.getAttribute('aria-describedby') ?? '';
    expect(hintId.split(' ')).toHaveLength(1);
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    const error = within(dialog).getByRole('alert');
    expect(box.getAttribute('aria-describedby')?.split(' ')).toEqual([hintId, error.id]);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(box, { target: { value: 'North Site' } });
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(box.getAttribute('aria-describedby')).toBe(hintId);
    expect(box.getAttribute('aria-invalid')).toBeNull();
  });

  it('has a Help button in the Apps card and a page title', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Help' }));
    expect(await screen.findByRole('dialog', { name: 'Help and keyboard shortcuts' })).toBeTruthy();
    expect(document.title).toBe('Apps, Local App Studio');
  });
});

describe('AppsPage examples gallery', () => {
  const body = () => ({ spec: { app: { name: 'Crew Board' }, tables: [] }, records: { v: 1, tables: { crews: [{ _id: 'c1', name: 'North' }] } } });
  const crewBoard = (extra: Record<string, unknown> = {}) => summary({ id: '33333333-3333-4333-8333-333333333333', name: 'Crew Board', ...extra });
  const madeRecord = () => json(201, { data: recordOf(null, { id: '99999999-9999-4999-8999-999999999999', name: 'Crew Board 2' }) });
  const importFetch = (list: unknown[], reply: () => Response = madeRecord) => mockFetch((url, init) => (init?.method === 'POST' ? reply() : json(200, { data: list })));
  const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
  const useButton = (name: string) => within(screen.getByRole('region', { name: 'Examples' })).getByRole('button', { name: 'Use this example ' + name });
  const status = () => screen.getAllByRole('status')[0];
  const failure = () => screen.getByRole('alert');

  beforeEach(() => example.load.mockReset());

  it('lists the eight examples in their own region, apart from the Apps grid', async () => {
    importFetch([summary()]);
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    const apps = screen.getByRole('region', { name: 'Apps' });
    const gallery = screen.getByRole('region', { name: 'Examples' });
    expect(within(apps).getAllByRole('listitem')).toHaveLength(1);
    expect(within(gallery).getAllByRole('listitem')).toHaveLength(8);
    expect(within(gallery).getAllByRole('button', { name: /^Use this example / })).toHaveLength(8);
    expect(within(gallery).queryAllByRole('link')).toHaveLength(0);
    expect(within(apps).queryByText('Crew Board')).toBeNull();
    expect(gallery.textContent).toContain('Open one, try it with sample data, then change it as your own.');
  });

  it('shows the gallery when the list failed', async () => {
    mockFetch(() => json(500, { error: 'Nope.', code: 'server_error' }));
    renderPage();
    expect(await screen.findByRole('region', { name: 'Examples' })).toBeTruthy();
  });

  it('makes the app from the example, named apart, with its records, and opens Preview with the note', async () => {
    example.load.mockResolvedValue(body());
    importFetch([crewBoard()]);
    renderPage();
    await screen.findByRole('link', { name: 'Crew Board' });
    fireEvent.click(useButton('Crew Board'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/99999999-9999-4999-8999-999999999999/preview'));
    expect(example.load).toHaveBeenCalledWith('crew-board', expect.any(AbortSignal));
    const sent = JSON.parse(String((posts()[0][1] as RequestInit).body)) as { spec: { app: { name: string } }; sample: unknown };
    expect(sent.spec.app.name).toBe('Crew Board 2');
    expect(sent.sample).toEqual(body().records);
    const state = JSON.parse(screen.getByTestId('state').textContent ?? '') as Record<string, unknown>;
    expect(state.stepFocus).toBe(true);
    expect(state.madeFromExample).toEqual({
      name: 'Crew Board 2',
      tryThese: ['Add a Phone field to People', 'Put a chart of people per crew on the Crews page', 'Move the menu to the side'],
    });
  });

  it('shows Making your app... while it works, keeps focus on the button, and ignores a second press', async () => {
    example.load.mockResolvedValue(body());
    let release: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock = vi.fn((url: string, init?: RequestInit) => (init?.method === 'POST' ? pending : Promise.resolve(json(200, { data: [] }))));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText(/No apps yet/);
    const button = useButton('Crew Board');
    button.focus();
    // both presses in one act(): the state has not re-rendered between them, so only the ref stops the second
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.textContent).toBe('Making your app...');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(useButton('Job Tracker').getAttribute('aria-disabled')).toBe('true');
    expect(status().textContent).toBe('Making your app...');
    expect((screen.getAllByRole('button', { name: 'Create' })[0] as HTMLButtonElement).disabled).toBe(true);
    release(madeRecord());
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/preview'));
    expect(posts()).toHaveLength(1);
    expect(example.load).toHaveBeenCalledTimes(1);
  });

  it('gives the pressed button the name it shows, and turns Import and Change look off while busy', async () => {
    example.load.mockResolvedValue(body());
    fetchMock = vi.fn((url: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Promise<Response>(() => undefined) : Promise.resolve(json(200, { data: [summary()] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByRole('link', { name: 'Crew Roster' });
    fireEvent.click(useButton('Crew Board'));
    const pressed = await screen.findByRole('button', { name: 'Making your app...' });
    expect(pressed.hasAttribute('aria-label')).toBe(false);
    expect((screen.getByRole('button', { name: 'Import an app' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Crew Roster' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change look' }));
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('puts focus back on the pressed button after a failure, but leaves it where the person moved it', async () => {
    example.load.mockRejectedValueOnce(new Error('chunk')).mockRejectedValueOnce(new Error('chunk'));
    importFetch([]);
    renderPage();
    await screen.findByText(/No apps yet/);
    const button = useButton('Crew Board');
    button.focus();
    fireEvent.click(button);
    button.blur();
    await waitFor(() => expect(failure()).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(useButton('Crew Board')));
    const other = useButton('Job Tracker');
    fireEvent.click(useButton('Crew Board'));
    other.focus();
    await waitFor(() => expect(example.load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(failure()).toBeTruthy());
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(other);
  });

  it('names the app apart from the names taken while the example loads', async () => {
    let list: unknown[] = [];
    let failList = true;
    let release: (v: ReturnType<typeof body>) => void = () => undefined;
    example.load.mockReturnValue(
      new Promise<ReturnType<typeof body>>((resolve) => {
        release = resolve;
      }),
    );
    mockFetch((url, init) => (init?.method === 'POST' ? madeRecord() : failList ? json(500, { error: 'Nope.', code: 'server_error' }) : json(200, { data: list })));
    renderPage();
    await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(useButton('Crew Board'));
    list = [crewBoard()];
    failList = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: 'Crew Board' });
    release(body());
    await waitFor(() => expect(posts()).toHaveLength(1));
    const sent = JSON.parse(String((posts()[0][1] as RequestInit).body)) as { spec: { app: { name: string } } };
    expect(sent.spec.app.name).toBe('Crew Board 2');
  });

  it('does nothing after unmount: no navigation and no state update warning', async () => {
    example.load.mockResolvedValue(body());
    let release: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock = vi.fn((url: string, init?: RequestInit) => (init?.method === 'POST' ? pending : Promise.resolve(json(200, { data: [] }))));
    vi.stubGlobal('fetch', fetchMock);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPage();
    await screen.findByText(/No apps yet/);
    fireEvent.click(useButton('Crew Board'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    cleanup();
    await act(async () => {
      release(madeRecord());
      await pending;
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('says plainly when the example could not load, stays on the page and works on a second press', async () => {
    example.load.mockRejectedValueOnce(new Error('chunk')).mockResolvedValue(body());
    importFetch([]);
    renderPage();
    await screen.findByText(/No apps yet/);
    fireEvent.click(useButton('Crew Board'));
    await waitFor(() => expect(failure().textContent).toBe('Could not make the app from the example. Nothing was changed. Try again.'));
    expect(status().textContent).toBe('');
    expect(posts()).toHaveLength(0);
    expect(useButton('Crew Board').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(useButton('Crew Board'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/preview'));
  });

  it('says the same for a refused import, and gives the server sentence for too many apps', async () => {
    example.load.mockResolvedValue(body());
    importFetch([], () => json(400, { error: 'Bad sample.', code: 'invalid_request' }));
    renderPage();
    await screen.findByText(/No apps yet/);
    fireEvent.click(useButton('Inventory'));
    await waitFor(() => expect(failure().textContent).toContain('Could not make the app from the example.'));
    cleanup();
    importFetch([], () => json(409, { error: 'Studio keeps up to 50 apps.', code: 'too_many_apps', action: 'Delete one first.' }));
    renderPage();
    await screen.findByText(/No apps yet/);
    fireEvent.click(useButton('Inventory'));
    await waitFor(() => expect(failure().textContent).toBe('Studio keeps up to 50 apps. Delete one first.'));
  });

  it('says the copy of an example app starts with the sample records', async () => {
    importFetch([crewBoard({ sample: true })], () => json(201, { data: recordOf(null, { name: 'Crew Board Copy' }) }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Crew Board' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Crew Board' });
    expect(within(dialog).getByText('The copy starts with the sample records.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(status().textContent).toBe('Duplicated "Crew Board" as "Crew Board Copy". The copy starts with the sample records.');
  });
});
