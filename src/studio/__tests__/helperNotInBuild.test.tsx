// The helper in and out of a build (docs/ARCHITECTURE.md, 'The pro seam'; docs/DESIGN.md "Studio copy"): without it the Prompt step and
// the Apps start card say so in one line with one button, the Design page strip has no ask box, the Preview step offers no ask, and
// nothing asks the server about the helper (its waiting design, Ollama). With it, nothing changes.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseSpec, json, recordOf } from './fixtures';
import { APP_ID } from './harness';
import HelperNotInBuild, { BUILD_IT_YOURSELF, HELPER_NOT_IN_BUILD, START_BLANK_INSTEAD } from '../components/HelperNotInBuild';
import PageStrip, { STRIP_WAITING, STRIP_WORKING } from '../design/PageStrip';
import { DescribeSessionProvider } from '../hooks/useDescribeSession';
import { StepChromeContext } from '../hooks/useStepChrome';
import type { StepChrome } from '../hooks/useStepChrome';
import { WorkspaceContext } from '../hooks/useWorkspace';
import { crewRosterSpec } from '../lib/__tests__/promptBulletsFixtures';
import AppsPage from '../pages/AppsPage';
import DescribeTab from '../pages/DescribeTab';
import PreviewTab, { BUILD_A_PAGE, STARTER_CARD, STARTER_CARD_NO_HELPER } from '../pages/PreviewTab';
import type { SaveResult, WorkspaceValue } from '../types';

// The flag module is the one thing that differs between builds: each test sets the parts it is about.
const parts = vi.hoisted(() => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('@/proParts.js', () => parts);
const helperIs = (on: boolean): void => {
  parts.PRO_PARTS.helper = on;
};
const installerIs = (on: boolean): void => {
  parts.PRO_PARTS.installer = on;
};

// The Ollama probe is the one call the helper's screens make that is not to the Studio server: count it.
const probe = vi.hoisted(() => ({ setup: vi.fn() }));
vi.mock('@/services/aiSettingsService', async (importOriginal) => {
  const actual = await importOriginal<{ aiSettingsService: Record<string, unknown> }>();
  return { ...actual, aiSettingsService: { ...actual.aiSettingsService, setup: probe.setup } };
});

// A session the strip reads in place of the real one (null: the real provider's own).
const forced = vi.hoisted(() => ({ phase: null as null | 'running' | 'proposal' }));
vi.mock('../hooks/useDescribeSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useDescribeSession')>();
  return {
    ...actual,
    useOptionalDescribeSession: () => {
      const real = actual.useOptionalDescribeSession();
      return forced.phase === null ? real : { ...real, phase: forced.phase };
    },
  };
});

vi.mock('@local-app-studio/runtime/runtime', () => ({ SpecApp: () => <div data-testid="spec-app" /> }));

/** The URLs the page asked the server for. */
const asked = (fn: ReturnType<typeof vi.fn>): string[] => fn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  helperIs(true);
  installerIs(true);
  forced.phase = null;
  probe.setup.mockReset();
  probe.setup.mockResolvedValue({ ready: true, ollama: 'running' });
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HelperNotInBuild', () => {
  it('says the one line and runs the button it is given', () => {
    const onAction = vi.fn();
    render(<HelperNotInBuild actionLabel={BUILD_IT_YOURSELF} onAction={onAction} />);
    expect(screen.getByText(HELPER_NOT_IN_BUILD)).toBeTruthy();
    expect(HELPER_NOT_IN_BUILD).toBe('The helper is not in this build. Build it yourself in Design.');
    fireEvent.click(screen.getByRole('button', { name: 'Build it yourself' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(START_BLANK_INSTEAD).toBe('Start a blank app instead');
  });

  it('is a named region when it is given a label, and has none without one', () => {
    const { rerender } = render(<HelperNotInBuild actionLabel="Go" onAction={vi.fn()} label="Start" />);
    expect(screen.getByRole('region', { name: 'Start' }).textContent).toContain(HELPER_NOT_IN_BUILD);
    rerender(<HelperNotInBuild actionLabel="Go" onAction={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('the Prompt step', () => {
  const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
  function show() {
    const spec = baseSpec();
    const record = recordOf(spec);
    const value = { record, spec, revision: 3, save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, record })), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
    const go = vi.fn();
    const chrome: StepChrome = { setDraft: vi.fn(), go, announce: vi.fn(), markDone: vi.fn() };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async (url: string) => json(200, { data: url.includes('/waiting') ? null : [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/apps/${APP_ID}/prompt`]}>
          <WorkspaceContext.Provider value={value}>
            <StepChromeContext.Provider value={chrome}>
              <DescribeSessionProvider>
                <Routes>
                  <Route path="/apps/:appId/prompt" element={<DescribeTab />} />
                </Routes>
                <Where />
              </DescribeSessionProvider>
            </StepChromeContext.Provider>
          </WorkspaceContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { go, fetchMock };
  }

  it('without the helper shows the line and Build it yourself, which opens Design, and no prompt box', () => {
    helperIs(false);
    const { go, fetchMock } = show();
    expect(screen.getByRole('region', { name: 'Prompt' })).toBeTruthy();
    expect(screen.getByText(HELPER_NOT_IN_BUILD)).toBeTruthy();
    expect(screen.queryByLabelText('Ask for a change')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make my app' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Build it yourself' }));
    expect(go).toHaveBeenCalledWith(`/apps/${APP_ID}/design`);
    // Nothing waits in a build without the helper, so the server is not asked for a waiting design and Ollama is not probed.
    expect(asked(fetchMock).filter((u) => u.includes('/waiting'))).toEqual([]);
    expect(probe.setup).not.toHaveBeenCalled();
  });

  it('with the helper shows the prompt box and not the line', async () => {
    helperIs(true);
    show();
    // The seeded app has a design, so the pane on the right takes the ask.
    expect(await screen.findByLabelText('Ask for a change')).toBeTruthy();
    expect(screen.queryByText(HELPER_NOT_IN_BUILD)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build it yourself' })).toBeNull();
  });

  it('with the helper asks the server for the waiting design', async () => {
    helperIs(true);
    const { fetchMock } = show();
    await waitFor(() => expect(asked(fetchMock).some((u) => u.includes('/waiting'))).toBe(true), { timeout: 5000 });
  });
});

describe('the Apps start card', () => {
  const summary = {
    id: APP_ID,
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
  };
  const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
  const showApps = async (list: unknown[] = [summary]) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json(201, { data: recordOf(baseSpec()) });
      if (init?.method === 'PUT') return json(200, { data: recordOf(baseSpec(), { revision: 2 }) });
      return json(200, { data: list });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/apps']}>
          <Routes>
            <Route path="/apps" element={<AppsPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    if (list.length > 0) await screen.findByRole('link', { name: 'Crew Roster' });
    else await screen.findByRole('button', { name: 'Blank app' });
    return fetchMock;
  };

  it('without the helper shows the line in a region named Start, and Start a blank app instead, which opens the Blank app dialog, and no prompt box', async () => {
    helperIs(false);
    await showApps();
    expect(screen.getByRole('region', { name: 'Start' }).textContent).toContain(HELPER_NOT_IN_BUILD);
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make my app' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a blank app instead' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Start a blank app');
  });

  it('with the helper keeps the prompt box off the page until Create is pressed, and shows no line', async () => {
    helperIs(true);
    await showApps();
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByLabelText('Your prompt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make my app' })).toBeTruthy();
    expect(screen.queryByText(HELPER_NOT_IN_BUILD)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a blank app instead' })).toBeNull();
  });

  it('does not probe Ollama without the helper, and does with it', async () => {
    helperIs(false);
    await showApps();
    expect(probe.setup).not.toHaveBeenCalled();
    cleanup();
    helperIs(true);
    await showApps();
    await waitFor(() => expect(probe.setup).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('says the empty list for the build: without the helper nothing is described above', async () => {
    helperIs(false);
    await showApps([]);
    expect(screen.getByText('No apps yet. Start a blank app, or import an app file. Or open an example below.')).toBeTruthy();
    cleanup();
    helperIs(true);
    await showApps([]);
    expect(screen.getByText('No apps yet. Press Create to describe one, or import an app file. Or open an example below.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2);
  });

  it('says the subtitle for the build: the installer is only named when it is in the build', async () => {
    installerIs(false);
    await showApps();
    expect(screen.getByText('Open an app to change it or try it.')).toBeTruthy();
    cleanup();
    installerIs(true);
    await showApps();
    expect(screen.getByText('Open an app to change it, try it or make an installer.')).toBeTruthy();
  });

  const createBlank = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('button', { name: 'Blank app' }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Crew Roster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create app' }));
  };

  it('opens a new blank app on Design without the helper', async () => {
    helperIs(false);
    await showApps([]);
    await createBlank();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/design`), { timeout: 5000 });
  });

  it('Create opens the Blank app dialog without the helper, and the line stays', async () => {
    helperIs(false);
    await showApps();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('dialog', { name: 'Start a blank app' })).toBeTruthy();
    expect(screen.queryByLabelText('Your prompt')).toBeNull();
    expect(screen.getByText(HELPER_NOT_IN_BUILD)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a blank app instead' })).toBeTruthy();
  });

  it('opens a new blank app on Prompt with the helper', async () => {
    helperIs(true);
    await showApps([]);
    await createBlank();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/prompt`), { timeout: 5000 });
  });
});

describe('the Preview step', () => {
  const stopped = { state: 'stopped', appId: null, revision: null, startedAt: null, message: null, data: null };
  function show(tables: boolean) {
    const base = baseSpec();
    const spec = tables ? base : { ...base, tables: [] };
    const record = recordOf(spec);
    const value = { record, spec, revision: 3, save: vi.fn(), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
    const go = vi.fn();
    const chrome: StepChrome = { setDraft: vi.fn(), go, announce: vi.fn(), markDone: vi.fn() };
    const fetchMock = vi.fn(async () => json(200, { data: stopped }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/apps/${APP_ID}/preview`]}>
          <WorkspaceContext.Provider value={value}>
            <StepChromeContext.Provider value={chrome}>
              <Routes>
                <Route path="/apps/:appId/preview" element={<PreviewTab />} />
              </Routes>
            </StepChromeContext.Provider>
          </WorkspaceContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { go };
  }

  it('without the helper a starter app says Build a page in Design, with Design as the one primary button and no Go to Prompt', async () => {
    helperIs(false);
    const { go } = show(false);
    expect(STARTER_CARD_NO_HELPER).toBe('Build a page in Design.');
    expect(await screen.findByText(STARTER_CARD_NO_HELPER)).toBeTruthy();
    expect(screen.queryByText(/Prompt/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Go to Prompt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: BUILD_A_PAGE }));
    expect(go).toHaveBeenCalledWith(`/apps/${APP_ID}/design`, expect.anything());
    expect(probe.setup).not.toHaveBeenCalled();
  });

  it('with the helper a starter app offers Go to Prompt and Build a page in Design', async () => {
    helperIs(true);
    show(false);
    expect(await screen.findByText(STARTER_CARD)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Prompt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: BUILD_A_PAGE })).toBeTruthy();
  });

  it('without the helper Change something keeps only Change the design yourself and does not probe Ollama', async () => {
    helperIs(false);
    show(true);
    expect(await screen.findByRole('button', { name: 'Change the design yourself' })).toBeTruthy();
    expect(screen.getByText('Change something')).toBeTruthy();
    expect(screen.queryByLabelText('What should change?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for changes' })).toBeNull();
    expect(probe.setup).not.toHaveBeenCalled();
  });

  it('with the helper Change something has the box and Ask for changes, and probes Ollama', async () => {
    helperIs(true);
    show(true);
    expect(await screen.findByLabelText('What should change?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for changes' })).toBeTruthy();
    await waitFor(() => expect(probe.setup).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('reads the helper as not down without the helper, even when Ollama would say it is', async () => {
    probe.setup.mockResolvedValue({ ready: false, ollama: 'missing' });
    helperIs(false);
    show(true);
    await screen.findByRole('button', { name: 'Change the design yourself' });
    expect(screen.queryByText(/The helper is not set up/)).toBeNull();
    expect(probe.setup).not.toHaveBeenCalled();
  });
});

describe('the Design page strip', () => {
  const spec = crewRosterSpec();
  const show = () =>
    render(
      <StepChromeContext.Provider value={{ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }}>
        <PageStrip spec={spec} pageId={spec.pages[0].id} appId="app1" />
      </StepChromeContext.Provider>,
    );

  it('without the helper keeps the page line and has no ask box', async () => {
    helperIs(false);
    show();
    expect(screen.getByRole('region', { name: 'This page' }).textContent).toContain('Home shows a Crews list.');
    expect(screen.queryByLabelText('Ask the helper to change this page')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Prompt' })).toBeNull();
  });

  it.each(['running', 'proposal'] as const)('without the helper shows no helper line and no Open Prompt while a session is %s', (phase) => {
    helperIs(false);
    forced.phase = phase;
    show();
    expect(screen.getByRole('region', { name: 'This page' }).textContent).toContain('Home shows a Crews list.');
    expect(screen.queryByText(STRIP_WORKING)).toBeNull();
    expect(screen.queryByText(STRIP_WAITING)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Prompt' })).toBeNull();
    expect(screen.queryByLabelText('Ask the helper to change this page')).toBeNull();
  });

  it('with the helper shows Open Prompt while a session is running', () => {
    helperIs(true);
    forced.phase = 'running';
    show();
    expect(screen.getByText(STRIP_WORKING)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Prompt' })).toBeTruthy();
  });

  it('with the helper has the ask box', () => {
    helperIs(true);
    show();
    expect(screen.getByLabelText('Ask the helper to change this page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
  });
});
