import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID, mockWorkspaceFetch } from '../../__tests__/harness';
import type { Call } from '../../__tests__/harness';
import { useDescribeSession } from '../../hooks/useDescribeSession';
import { useStepChrome } from '../../hooks/useStepChrome';
import type { DraftTab, SaveOutcome } from '../../hooks/useStepChrome';
import { useWorkspace } from '../../hooks/useWorkspace';
import ReviewPane from '../../components/ReviewPane';
import { launchState } from '../../lib/steps';
import { markFresh, readStartWords, writePrompt } from '../../lib/appMemory';
import { readDraft, writeDraft } from '../../lib/draftStore';
import { APP_GONE_START } from '../../types';
import AppWorkspace from '../AppWorkspace';

/** How the fake Data and Design tabs register their draft: none, a working save, a blocked save, a failing save or a cancelled one. */
const fake = vi.hoisted(() => ({
  mode: { data: 'none', design: 'none' } as Record<'data' | 'design', 'none' | 'ok' | 'blocked' | 'fail' | 'cancel' | 'throw' | 'gone'>,
  reset: vi.fn(),
  markRevision: 3,
  scope: 'page_a',
}));

function FakeDraftTab({ tab }: { tab: DraftTab }) {
  const { spec, revision, save, setDirty } = useWorkspace();
  const { setDraft } = useStepChrome();
  const mode = fake.mode[tab];
  const dirty = useRef(false);
  useEffect(() => {
    if (mode === 'none') return undefined;
    setDraft(tab, {
      scope: tab === 'design' ? fake.scope : undefined,
      isDirty: () => dirty.current,
      saveBlocked: mode === 'blocked' ? 'Connect the parts that need a table, or delete them, to save.' : null,
      nextBlocked: null,
      reset: () => {
        fake.reset();
        dirty.current = false;
      },
      save: async (): Promise<SaveOutcome> => {
        if (mode === 'throw') throw new Error('boom');
        if (mode === 'fail') return { ok: false, reason: 'The server said no.' };
        if (mode === 'gone') return { ok: false, reason: `${APP_GONE_START} any more. It may have been deleted in another window.` };
        if (mode === 'cancel') return { ok: false, cancelled: true };
        const result = await save({ ...spec, app: { ...spec.app, description: 'changed' } }, { baseRevision: revision });
        if (result.ok) {
          dirty.current = false;
          setDirty(tab, false);
        }
        return { ok: result.ok };
      },
    });
    return () => setDraft(tab, null);
  }, [mode, revision, save, setDirty, setDraft, spec, tab]);
  useEffect(() => () => setDirty(tab, false), [setDirty, tab]);
  return (
    <div>
      <p>{tab === 'data' ? 'Data tab' : 'Design tab'}</p>
      <button
        type="button"
        onClick={() => {
          dirty.current = true;
          setDirty(tab, true);
        }}
      >
        Change something
      </button>
    </div>
  );
}

function FakeDescribe() {
  const describe = useDescribeSession();
  return (
    <div>
      <p>Describe tab</p>
      <p data-testid="helper-words">{describe.instruction ?? ''}</p>
      <button type="button" onClick={() => describe.run('edit', 'Add a page')}>
        Ask the helper
      </button>
      <ReviewPane mode="edit" helperDown={false} setupError={false} onFocusPrompt={() => undefined} />
    </div>
  );
}

function FakePreview() {
  const { markDone } = useStepChrome();
  useEffect(() => markDone('preview', fake.markRevision), [markDone]);
  return <p>Preview tab</p>;
}

// These tests are about the helper's and the installer's screens, so both are in the build they run in (a public run: helperNotInBuild.test.tsx, installerNotInBuild.test.tsx).
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('../DescribeTab', () => ({ default: () => <FakeDescribe /> }));
vi.mock('../PreviewTab', () => ({ default: () => <FakePreview /> }));
vi.mock('../DesignTab', () => ({ default: () => <FakeDraftTab tab="design" /> }));
vi.mock('../DataTab', () => ({ default: () => <FakeDraftTab tab="data" /> }));
vi.mock('../BuildTab', () => ({ default: () => <p>Build tab</p> }));

const starterSpec = (): AppSpec => ({ ...baseSpec(), tables: [] });
const withPage = (): AppSpec => {
  const next = baseSpec();
  next.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: { id: 'root_extra', type: 'Page', props: {}, children: [] } });
  return next;
};
const downloads = vi.hoisted(() => ({ downloadJson: vi.fn() }));
vi.mock('../../lib/download', () => downloads);

const sse = (events: Array<[string, unknown]>): Response =>
  new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
const openStream = (): Response =>
  new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/** PUT saves answer with the next revision; the describe stream answers with `describeReply`. */
function mockApp(spec: AppSpec, describeReply?: () => Response): Call[] {
  return mockWorkspaceFetch(
    () => recordOf(spec),
    (call) => {
      if (call.method === 'PUT') return json(200, { data: recordOf((call.body as { spec: AppSpec }).spec, { revision: 4 }) });
      if (call.url.endsWith('/describe') && describeReply) return describeReply();
      return json(404, { error: 'not_found' });
    },
  );
}

function PaletteButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/features')}>
      Palette
    </button>
  );
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP_ID}/${path}`]}>
      <Link to="/features">Features</Link>
      <Routes>
        <Route path="/apps" element={<p>Apps list</p>} />
        <Route path="/features" element={<p>Features page</p>} />
        <Route path="/apps/:appId/*" element={<AppWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rail = () => screen.getByRole('navigation', { name: 'Steps' });
/** The last location the router showed: path, search, state and how it was reached. */
const seen: { current: { path: string; search: string; state: unknown; type: string } | null } = { current: null };
function Probe() {
  const location = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    seen.current = { path: location.pathname, search: location.search, state: location.state, type };
  });
  return null;
}
const currentStep = () => within(rail()).getAllByRole('link').find((a) => a.getAttribute('aria-current') === 'step')?.textContent ?? null;
const status = () => screen.getByTestId('save-status').textContent;
const announced = () => within(screen.getByTestId('announcer')).getByRole('status').textContent;
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT');

// Announcements wait a short join window before they are spoken, and a busy machine slows the renders around them.
configure({ asyncUtilTimeout: 4000 });

beforeEach(() => {
  vi.unstubAllGlobals();
  downloads.downloadJson.mockClear();
  fake.mode = { data: 'none', design: 'none' };
  fake.reset.mockReset();
  fake.markRevision = 3;
  fake.scope = 'page_a';
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppWorkspace', () => {
  it('opens a starter app on Prompt and lists five steps in the order of work', async () => {
    mockApp(starterSpec());
    renderApp('');
    expect(await screen.findByText('Describe tab')).toBeTruthy();
    expect(within(rail()).getAllByRole('link').map((a) => a.textContent?.replace(/ \((done|next)\)/g, ''))).toEqual([
      '1Prompt',
      '2Design',
      '3Data',
      '4Preview',
      '5Build',
    ]);
    expect(currentStep()).toContain('Prompt');
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Prompt' })).toBeTruthy();
    expect(screen.getByText('Tell the helper what your app is for, then check what it made.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Back/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next: Design' })).toBeTruthy();
    // Focus and the title move in effects after the render the query saw.
    await waitFor(() => expect(document.title).toBe('Prompt, Crew Roster, Local App Studio'));
  });

  it('lands a designed app on Design with only the steps its evidence ticks done, Preview next (P-16)', async () => {
    mockApp(baseSpec());
    renderApp('');
    expect(await screen.findByText('Design tab')).toBeTruthy();
    expect(currentStep()).toContain('Design');
    const done = within(rail())
      .getAllByRole('link')
      .filter((a) => a.textContent?.includes('(done)'))
      .map((a) => a.textContent?.replace(' (done)', ''));
    // No helper design was used and no words were kept: Prompt is not ticked.
    expect(done).toEqual(['Data']);
    expect(within(rail()).getByRole('link', { name: /Prompt/ }).textContent).not.toContain('(done)');
    expect(screen.getByRole('button', { name: 'Back: Prompt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: Data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help' })).toBeTruthy();
  });

  it('ticks Prompt for a designed app a helper design was used for (P-16)', async () => {
    window.localStorage.setItem(`app.studio.helperUsed.${APP_ID}`, '1');
    mockApp(baseSpec());
    renderApp('');
    expect(await screen.findByText('Design tab')).toBeTruthy();
    const done = within(rail())
      .getAllByRole('link')
      .filter((a) => a.textContent?.includes('(done)'))
      .map((a) => a.textContent?.replace(' (done)', ''));
    expect(done).toEqual(['Prompt', 'Data']);
    expect(within(rail()).getByRole('link', { name: /Preview/ }).textContent).toContain('(next)');
  });

  it('redirects an unknown sub-path to the landing step and keeps a page path inside Preview', async () => {
    mockApp(baseSpec());
    const view = renderApp('junk');
    expect(await screen.findByText('Design tab')).toBeTruthy();
    view.unmount();
    mockApp(starterSpec());
    renderApp('preview/about');
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(currentStep()).toContain('Preview');
  });

  it('sends the old Review links to Data and Design with the step current', async () => {
    mockApp(baseSpec());
    const view = render(
      <MemoryRouter initialEntries={[{ pathname: `/apps/${APP_ID}/review/data`, state: { stepFocus: true } }]}>
        <Routes>
          <Route path="/apps/:appId/*" element={<AppWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Data tab')).toBeTruthy();
    expect(currentStep()).toContain('Data');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Data' })));
    await waitFor(() => expect(announced()).toBe('Step 3 of 5.'));
    view.unmount();
    mockApp(baseSpec());
    renderApp('review/design');
    expect(await screen.findByText('Design tab')).toBeTruthy();
    expect(currentStep()).toContain('Design');
  });

  it('sends an old Describe link to Prompt, keeping its search and router state, in place of the old entry', async () => {
    mockApp(starterSpec());
    const launch = launchState({ mode: 'edit', instruction: 'Add a page' });
    seen.current = null;
    render(
      <MemoryRouter initialEntries={['/apps', { pathname: `/apps/${APP_ID}/describe`, search: '?from=bookmark', state: launch }]} initialIndex={1}>
        <Routes>
          <Route path="/apps" element={<p>Apps list</p>} />
          <Route
            path="/apps/:appId/*"
            element={
              <>
                <AppWorkspace />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Describe tab')).toBeTruthy();
    await waitFor(() => expect(seen.current?.path).toBe(`/apps/${APP_ID}/prompt`));
    expect(seen.current).toEqual({ path: `/apps/${APP_ID}/prompt`, search: '?from=bookmark', state: launch, type: 'REPLACE' });
    expect(currentStep()).toContain('Prompt');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Prompt' })));
    await waitFor(() => expect(announced()).toBe('Step 1 of 5.'));
  });

  it('sends an old Review link to Prompt, keeping its search, hash and state, in place of the old entry', async () => {
    mockApp(baseSpec());
    const launch = launchState({ mode: 'edit', instruction: 'Add a page' });
    seen.current = null;
    render(
      <MemoryRouter initialEntries={['/apps', { pathname: `/apps/${APP_ID}/review`, search: '?x=1', hash: '#top', state: launch }]} initialIndex={1}>
        <Routes>
          <Route path="/apps" element={<p>Apps list</p>} />
          <Route
            path="/apps/:appId/*"
            element={
              <>
                <AppWorkspace />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Describe tab')).toBeTruthy();
    await waitFor(() => expect(seen.current?.path).toBe(`/apps/${APP_ID}/prompt`));
    expect(seen.current).toEqual({ path: `/apps/${APP_ID}/prompt`, search: '?x=1', state: launch, type: 'REPLACE' });
    expect(currentStep()).toContain('Prompt');
  });

  it('keeps the search of the old Review links to Data and Design', async () => {
    mockApp(baseSpec());
    seen.current = null;
    render(
      <MemoryRouter initialEntries={[`/apps/${APP_ID}/review/data?x=1`]}>
        <Routes>
          <Route
            path="/apps/:appId/*"
            element={
              <>
                <AppWorkspace />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Data tab')).toBeTruthy();
    await waitFor(() => expect(seen.current).toMatchObject({ path: `/apps/${APP_ID}/data`, search: '?x=1', type: 'REPLACE' }));
  });

  it('saves a valid draft on Next, then moves, focuses the step heading and says both', async () => {
    fake.mode.data = 'ok';
    const calls = mockApp(baseSpec());
    renderApp('data');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    expect(status()).toBe('Unsaved changes on Data');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    expect(puts(calls)).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const heading = screen.getByRole('heading', { level: 3, name: 'Preview' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await waitFor(() => expect(announced()).toBe('All changes saved. Step 4 of 5.'));
    expect(status()).toBe('All changes saved');
  });

  it('marks Preview done for the revision it showed', async () => {
    mockApp(baseSpec());
    renderApp('preview');
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Build' }));
    expect(await screen.findByText('Build tab')).toBeTruthy();
    expect(within(rail()).getByRole('link', { name: /Preview/ }).textContent).toContain('(done)');
    expect(window.localStorage.getItem(`app.studio.progress.${APP_ID}`)).toBe('{"previewed":3}');
  });

  it('marks a step done for the revision the step passes, not the one current when it runs (V-8)', async () => {
    fake.markRevision = 2;
    mockApp(baseSpec());
    renderApp('preview');
    expect(await screen.findByText('Preview tab')).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem(`app.studio.progress.${APP_ID}`)).toBe('{"previewed":2}'));
    // Revision 3 is loaded, so Preview is not done for it.
    expect(within(rail()).getByRole('link', { name: /Preview/ }).textContent).not.toContain('(done)');
  });

  it('keeps the stored Design draft of another page when Discard throws one page away (H2)', async () => {
    fake.mode.design = 'blocked';
    mockApp(baseSpec());
    writeDraft(APP_ID, 'design', 3, { page: 'a' }, 1, 'page_a');
    writeDraft(APP_ID, 'design', 3, { page: 'b' }, 1, 'page_b');
    renderApp('design');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Data' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Data tab')).toBeTruthy();
    expect(readDraft(APP_ID, 'design', 'page_a')).toBeNull();
    expect(readDraft(APP_ID, 'design', 'page_b')).not.toBeNull();
  });

  it('keeps the stored Design draft of another page after a left-behind save of one page (H2)', async () => {
    fake.mode.design = 'ok';
    mockApp(baseSpec());
    writeDraft(APP_ID, 'design', 3, { page: 'a' }, 1, 'page_a');
    writeDraft(APP_ID, 'design', 3, { page: 'b' }, 1, 'page_b');
    render(
      <MemoryRouter initialEntries={[`/apps/${APP_ID}/design`]}>
        <PaletteButton />
        <Routes>
          <Route path="/features" element={<p>Features page</p>} />
          <Route path="/apps/:appId/*" element={<AppWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    // The command palette calls navigate() itself, so the step goes with its edits unsaved and the left-behind save runs.
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    await waitFor(() => expect(readDraft(APP_ID, 'design', 'page_a')).toBeNull());
    expect(readDraft(APP_ID, 'design', 'page_b')).not.toBeNull();
  });

  it('counts a move that replaced the sentinel as a place to go back to, so Back lands on the step before it (N2)', async () => {
    fake.mode.design = 'ok';
    fake.mode.data = 'ok';
    mockApp(baseSpec());
    window.history.replaceState(null, '', `/apps/${APP_ID}/preview`);
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/apps" element={<p>Apps list</p>} />
          <Route path="/apps/:appId/*" element={<AppWorkspace />} />
        </Routes>
      </BrowserRouter>,
    );
    await screen.findByText('Preview tab');
    fireEvent.click(within(rail()).getByRole('link', { name: /Design/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    await waitFor(() => expect(window.history.state).toHaveProperty('studioSentinel', true));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Data' }));
    expect(await screen.findByText('Data tab')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    await waitFor(() => expect(window.history.state).toHaveProperty('studioSentinel', true));
    act(() => window.history.back());
    // The browser has Design before Data; Back must land there, not be rewritten to Preview.
    await waitFor(() => expect(window.location.pathname).toBe(`/apps/${APP_ID}/design`));
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/design`);
    expect(await screen.findByText('Design tab')).toBeTruthy();
  });

  it('opens the stuck dialog when the draft cannot be saved; Stay keeps the step and Discard changes moves', async () => {
    fake.mode.design = 'blocked';
    const calls = mockApp(baseSpec());
    renderApp('design');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    expect(status()).toBe('Unsaved changes on Design');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Data' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' });
    expect(within(dialog).getByText('Connect the parts that need a table, or delete them, to save.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Stay' })));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Design tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Data' }));
    expect(fake.reset).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Data tab')).toBeTruthy();
    // Discard asks the step to throw its edits away too, so nothing stays on screen untracked (V-5).
    expect(fake.reset).toHaveBeenCalled();
    expect(puts(calls)).toHaveLength(0);
    expect(status()).toBe('All changes saved');
  });

  it('a draft whose save throws opens the stuck dialog with the plain reason, and the move can be tried again (V4-7)', async () => {
    fake.mode.data = 'throw';
    mockApp(baseSpec());
    renderApp('data');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Data cannot be saved yet' });
    expect(within(dialog).getByText('Could not save. Your changes are still here. Try again.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next: Preview' }) as HTMLButtonElement).getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('treats a dirty step with no draft as not saved yet, and a failed save as stuck with its reason', async () => {
    mockApp(baseSpec());
    const view = renderApp('data');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(within(rail()).getByRole('link', { name: /Build/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Data cannot be saved yet' });
    expect(within(dialog).getByText('Your changes are not saved yet.')).toBeTruthy();
    view.unmount();

    fake.mode.data = 'fail';
    mockApp(baseSpec());
    renderApp('data');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back: Design' }));
    expect(within(await screen.findByRole('alertdialog')).getByText('The server said no.')).toBeTruthy();
  });

  it('stays quietly when the draft save is cancelled', async () => {
    fake.mode.data = 'cancel';
    mockApp(baseSpec());
    renderApp('data');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Preview' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next: Preview' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Data tab')).toBeTruthy();
  });

  it('saves first when a link outside the workspace is clicked, like the kit sidebar', async () => {
    fake.mode.data = 'ok';
    const calls = mockApp(baseSpec());
    renderApp('data');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
    expect(puts(calls)).toHaveLength(1);
  });

  it('lets links work as usual when nothing needs saving', async () => {
    const calls = mockApp(baseSpec());
    renderApp('data');
    await screen.findByText('Data tab');
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(puts(calls)).toHaveLength(0);
  });

  it('keeps Prompt when the helper design arrives, focuses its pane, and asks before leaving the app without it', async () => {
    mockApp(baseSpec(), () => sse([['proposal', { proposal: withPage(), fallbacks: [], baseRevision: 3, steps: 1 }], ['done', {}]]));
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(currentStep()).toContain('Prompt');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Your changes' })));
    await waitFor(() => expect(announced()).toBe('The helper made a design. Check it, then press Use this.'));
    expect(status()).toBe("The helper's design is not used yet.");
    const next = screen.getByRole('button', { name: 'Next: Design' }) as HTMLButtonElement;
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Press Use this or Try again first.')).toBeTruthy();
    fireEvent.click(next);
    await waitFor(() => expect(announced()).toBe('Press Use this or Try again first.'));
    expect(currentStep()).toContain('Prompt');

    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    const dialog = await screen.findByRole('alertdialog', { name: "Leave without using the helper's design?" });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: 'Use this' })).toBeTruthy();
    fireEvent.click(within(rail()).getByRole('link', { name: /Design/ }));
    expect(await screen.findByText('Design tab')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave without it' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
  });

  it('a stale waiting design is no dead end: Next is not blocked and leaving the app asks nothing', async () => {
    const calls = mockWorkspaceFetch(
      () => recordOf(baseSpec()),
      (call) => {
        if (call.method === 'GET' && call.url.endsWith('/waiting')) {
          return json(200, { data: { mode: 'edit', instruction: 'Add a page', asks: [], proposal: withPage(), replaced: null, fallbacks: [], baseRevision: 2, at: 'v1' } });
        }
        return json(404, { error: 'not_found' });
      },
    );
    renderApp('prompt');
    expect(await screen.findByText(/You saved the app after this design was made/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Throw it away' })).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Next: Design' }) as HTMLButtonElement;
    expect(next.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Press Use this or Try again first.')).toBeNull();
    expect(status()).not.toBe("The helper's design is not used yet.");
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('keeps Prompt when the helper answers with no changes in the turn the guard ends (an unguard never undoes a navigation)', async () => {
    mockApp(baseSpec(), () => sse([['proposal', { proposal: baseSpec(), fallbacks: [], baseRevision: 3, steps: 1 }], ['done', {}]]));
    window.history.replaceState(null, '', `/apps/${APP_ID}/prompt`);
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/apps/:appId/*" element={<AppWorkspace />} />
        </Routes>
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    expect(await screen.findByText('Nothing changed.')).toBeTruthy();
    expect(screen.getByText(/Not done: Add a page/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe(`/apps/${APP_ID}/prompt`);
    expect(currentStep()).toContain('Prompt');
  });

  it('Use this saves the design, goes to Design and says so', async () => {
    const calls = mockApp(baseSpec(), () => sse([['proposal', { proposal: withPage(), fallbacks: [], baseRevision: 3, steps: 1 }], ['done', {}]]));
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    const use = await screen.findByRole('button', { name: 'Use this' });
    await waitFor(() => expect(announced()).toBe('The helper made a design. Check it, then press Use this.'));
    fireEvent.click(use);
    expect(await screen.findByText('Design tab')).toBeTruthy();
    expect(puts(calls)).toHaveLength(1);
    await waitFor(() => expect(announced()).toBe("Saved the helper's design. Step 2 of 5."));
    expect(status()).toBe('All changes saved');
  });

  it('says the helper is working, and asks before stopping it to leave', async () => {
    mockApp(baseSpec(), openStream);
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    await waitFor(() => expect(status()).toBe('The helper is working on a design.'));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Stop the helper and leave?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop and leave' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
  });

  it('offers Export a copy in the stuck dialog when the app was deleted elsewhere (P-09)', async () => {
    fake.mode.design = 'gone';
    mockApp(baseSpec());
    renderApp('design');
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Data' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export a copy' }));
    expect(downloads.downloadJson).toHaveBeenCalledTimes(1);
    expect(downloads.downloadJson.mock.calls[0][0]).toMatch(/ app\.json$/);
    // Export does not close the dialog: Discard changes is still the person's choice.
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('removes the untouched empty app when the person leaves after the helper failed, and puts the words back (P-08)', async () => {
    markFresh(APP_ID, 3);
    writePrompt(APP_ID, 'A roster for my crew');
    const calls = mockWorkspaceFetch(
      () => recordOf(starterSpec()),
      (call) => {
        if (call.method === 'DELETE') return json(200, { data: { id: APP_ID } });
        if (call.url.endsWith('/describe')) return sse([['error', { code: 'ai_failed', message: 'The helper could not finish.' }]]);
        return json(404, { error: 'not_found' });
      },
    );
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    await waitFor(() => expect(status()).toBe('All changes saved'));
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('could not'));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(readStartWords()).toBe('A roster for my crew');
    expect(window.localStorage.getItem(`app.studio.fresh.${APP_ID}`)).toBeNull();
  });

  it('does not remove the app when a Data save was made on the way out after the helper failed (C1)', async () => {
    markFresh(APP_ID, 3);
    writePrompt(APP_ID, 'A roster for my crew');
    fake.mode.data = 'ok';
    // The record stays the untouched starter at the fresh revision for every read: only the move itself knows it saved.
    const calls = mockWorkspaceFetch(
      () => recordOf(starterSpec()),
      (call) => {
        if (call.method === 'DELETE') return json(200, { data: { id: APP_ID } });
        if (call.method === 'PUT') return json(200, { data: recordOf((call.body as { spec: AppSpec }).spec, { revision: 4 }) });
        if (call.url.endsWith('/describe')) return sse([['error', { code: 'ai_failed', message: 'The helper could not finish.' }]]);
        return json(404, { error: 'not_found' });
      },
    );
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('could not'));
    fireEvent.click(within(rail()).getByRole('link', { name: /Data/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change something' }));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(puts(calls)).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(window.localStorage.getItem(`app.studio.fresh.${APP_ID}`)).toBe('3');
  });

  it('reads the app again before removing it, and keeps it when another window saved (C1, H1)', async () => {
    markFresh(APP_ID, 3);
    let reads = 0;
    const calls = mockWorkspaceFetch(
      () => recordOf(starterSpec(), { revision: (reads += 1) > 1 ? 4 : 3 }),
      (call) => {
        if (call.method === 'DELETE') return json(200, { data: { id: APP_ID } });
        if (call.url.endsWith('/describe')) return sse([['error', { code: 'ai_failed', message: 'The helper could not finish.' }]]);
        return json(404, { error: 'not_found' });
      },
    );
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('could not'));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('sends the revision with the delete and keeps the app when the server says it changed (H1)', async () => {
    markFresh(APP_ID, 3);
    const calls = mockWorkspaceFetch(
      () => recordOf(starterSpec()),
      (call) => {
        if (call.method === 'DELETE') return json(409, { error: 'revision_conflict', message: 'This app changed in another window. Reload it and try again.', revision: 4 });
        if (call.url.endsWith('/describe')) return sse([['error', { code: 'ai_failed', message: 'The helper could not finish.' }]]);
        return json(404, { error: 'not_found' });
      },
    );
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('could not'));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`/api/studio/apps/${APP_ID}?ifRevision=3`]);
    expect(window.localStorage.getItem(`app.studio.fresh.${APP_ID}`)).toBe('3');
    expect(screen.queryByText(/Removed the empty app/)).toBeNull();
  });

  it('keeps a reopened untouched starter app whose server entry holds only words: words found on the server are not a stop', async () => {
    markFresh(APP_ID, 3);
    const calls = mockWorkspaceFetch(
      () => recordOf(starterSpec()),
      (call) => {
        if (call.method === 'DELETE') return json(200, { data: { id: APP_ID } });
        if (call.method === 'GET' && call.url.endsWith('/waiting')) {
          return json(200, { data: { mode: 'create', instruction: 'A roster for my crew', asks: [], proposal: null, replaced: null, fallbacks: [], baseRevision: null, at: 'v1' } });
        }
        return json(404, { error: 'not_found' });
      },
    );
    renderApp('prompt');
    // The words from the server fill the box: the helper itself was never stopped in this window.
    await waitFor(() => expect(screen.getByTestId('helper-words').textContent).toBe('A roster for my crew'));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(window.localStorage.getItem(`app.studio.fresh.${APP_ID}`)).toBe('3');
    expect(screen.queryByText(/Removed the empty app/)).toBeNull();
  });

  it('keeps an app that was not made empty by Make my app, or has content, when the helper failed (P-08)', async () => {
    const calls = mockWorkspaceFetch(
      () => recordOf(starterSpec()),
      (call) => (call.url.endsWith('/describe') ? sse([['error', { code: 'ai_failed', message: 'The helper could not finish.' }]]) : json(404, { error: 'not_found' })),
    );
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the helper' }));
    await waitFor(() => expect(screen.getByTestId('announcer').textContent).toContain('could not'));
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(await screen.findByText('Apps list')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('opens the App settings dialog', async () => {
    mockApp(baseSpec());
    renderApp('prompt');
    fireEvent.click(await screen.findByRole('button', { name: 'App settings' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('shows the broken view, exports a copy and repairs through a PUT', async () => {
    const raw = { ...baseSpec(), tables: 'oops' };
    const calls = mockWorkspaceFetch(
      () => recordOf(null, { issues: [{ path: 'tables', code: 'invalid', message: 'tables must be a list' }], raw }),
      (call) => (call.method === 'PUT' ? json(200, { data: recordOf(baseSpec(), { revision: 4 }) }) : json(404, {})),
    );
    renderApp('prompt');
    expect(await screen.findByText(/This app cannot open because part of it is damaged/)).toBeTruthy();
    expect(screen.getByText(/tables must be a list/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export a copy' }));
    expect(downloads.downloadJson).toHaveBeenCalledWith('crew-roster.raw.json', raw);

    fireEvent.change(screen.getByLabelText('App file text'), { target: { value: JSON.stringify(baseSpec()) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the fixed text' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe(`/api/studio/apps/${APP_ID}`);
    expect(put?.body).toEqual({ spec: baseSpec(), baseRevision: 3 });
  });
});
