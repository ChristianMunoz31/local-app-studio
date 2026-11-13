import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { aiSettingsService } from '@/services/aiSettingsService';
import { __resetPullStoreForTests } from '@/hooks/ollamaPullStore';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID } from '../../__tests__/harness';
import { CHECK_IT, DESIGN_CHANGED, DESIGN_FAILED, DESIGN_REPLACED, DescribeSessionProvider, MADE_DESIGN, NO_CHANGES_SAID, REMOVES_DATA } from '../../hooks/useDescribeSession';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { readPrompt, writePrompt } from '../../lib/appMemory';
import { launchState } from '../../lib/steps';
import type { AppRecord, SaveResult, WorkspaceValue } from '../../types';
import { DESIGN_STALE } from '../../components/ReviewPane';
import DescribeTab, { FIRST_PROMPT_LABEL, NO_FIRST_PROMPT } from '../DescribeTab';

// These tests are about the helper's screens, so the helper is in the build they run in (a public run has no helper: helperNotInBuild.test.tsx).
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('@/services/aiSettingsService', () => ({ aiSettingsService: { setup: vi.fn(), pull: vi.fn() } }));
const setupMock = vi.mocked(aiSettingsService.setup as unknown as (...a: unknown[]) => Promise<unknown>);

const setupState = (over: Record<string, unknown> = {}) => ({
  ollama: 'running',
  models: ['qwen2.5:3b'],
  ready: true,
  ramGb: 16,
  recommended: { tier: 'mid', ramGb: 16, primary: [], optional: [] },
  canPull: true,
  provider: 'ollama',
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setupMock.mockReset();
  setupMock.mockResolvedValue(setupState());
  __resetPullStoreForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sse = (events: Array<[string, unknown]>): Response =>
  new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const proposalSpec = (): AppSpec => {
  const next = baseSpec();
  next.tables = [];
  next.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: { id: 'root_extra', type: 'Page', props: {}, children: [] } });
  return next;
};

const withPage = (): AppSpec => {
  const next = baseSpec();
  next.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: { id: 'root_extra', type: 'Page', props: {}, children: [] } });
  return next;
};

const starterSpec = (): AppSpec => {
  const next = baseSpec();
  next.tables = [];
  return next;
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockApi(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

const Probe = () => {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}|${location.state === null ? 'no-state' : JSON.stringify(location.state)}`}</p>;
};

interface RenderOptions {
  spec?: AppSpec;
  state?: unknown;
  strict?: boolean;
  record?: Partial<AppRecord>;
}

function renderDescribe({ spec = baseSpec(), state, strict = false, record: extra }: RenderOptions = {}) {
  const record: AppRecord = recordOf(spec, extra);
  const value = {
    record,
    spec,
    revision: 3,
    save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, record })),
    reload: vi.fn(),
    setDirty: vi.fn(),
  } as unknown as WorkspaceValue;
  const chrome: StepChrome = { setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: `/apps/${APP_ID}/prompt`, state }]}>
        <WorkspaceContext.Provider value={value}>
          <StepChromeContext.Provider value={chrome}>
            <DescribeSessionProvider>
              <Routes>
                <Route path="/apps/:appId/prompt" element={<DescribeTab />} />
              </Routes>
              <Probe />
            </DescribeSessionProvider>
          </StepChromeContext.Provider>
        </WorkspaceContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { value, chrome };
}

/** The one ask box of a saved app: the right pane's Ask for a change. */
const ask = async (text: string) => {
  fireEvent.change(await screen.findByLabelText('Ask for a change'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
};

/** The first prompt of an app that has none yet: the left box and Make my app. */
const make = async (text: string) => {
  fireEvent.change(await screen.findByLabelText('Your prompt'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
};

const waitingEntry = (over: Record<string, unknown> = {}) => ({
  mode: 'create',
  instruction: 'A crew roster',
  asks: [],
  proposal: withPage(),
  replaced: null,
  fallbacks: [],
  baseRevision: 3,
  at: null,
  ...over,
});

const describeCalls = (calls: Call[]): Call[] => calls.filter((c) => c.url.endsWith('/describe'));
const proposalReply = (spec: AppSpec = proposalSpec(), fallbacks: unknown[] = []) =>
  sse([['proposal', { proposal: spec, fallbacks, baseRevision: 3, steps: 1 }], ['done', {}]]);

/** A stream that sends its events and then stays open, so the helper keeps working. */
const openStream = (events: Array<[string, unknown]>): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')));
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

describe('DescribeTab', () => {
  it('shows progress, then the design beside the prompt without leaving Prompt, announcing that some changes remove data', async () => {
    const calls = mockApi((call) =>
      call.url.endsWith('/describe')
        ? sse([
            ['meta', { ai: { kind: 'local', host: null } }],
            ['progress', { step: 'tables', round: 0, status: 'running' }],
            ['progress', { step: 'tables', round: 0, status: 'ok' }],
            ['proposal', { proposal: proposalSpec(), fallbacks: [], baseRevision: 3, steps: 2 }],
            ['done', {}],
          ])
        : json(404, {}),
    );
    const { value, chrome } = renderDescribe();
    await ask('Drop the tables and add a page');
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/prompt|no-state`);
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith(MADE_DESIGN + REMOVES_DATA));
    expect(describeCalls(calls)[0].body).toEqual({ mode: 'edit', instruction: 'Drop the tables and add a page', baseRevision: 3 });
    expect(value.save).not.toHaveBeenCalled();
    // The pane heading takes focus when the design lands (1.4).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Your changes' })));
  });

  it('puts the prompt pane before the review pane, keeps the words and makes Use this the one primary while a design waits', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    const { chrome } = renderDescribe({ spec: starterSpec() });
    const makeButton = screen.getByRole('button', { name: 'Make my app' });
    expect(makeButton.className).toContain(btnPrimary);
    await make('Add a page');
    const use = await screen.findByRole('button', { name: 'Use this' });
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith(MADE_DESIGN));
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('Add a page');
    const prompt = screen.getByRole('region', { name: 'Prompt' });
    const review = screen.getByRole('region', { name: 'What the helper made' });
    expect(prompt.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make my app' }).className).toContain(btnSecondary);
    expect(screen.getByRole('button', { name: 'Make my app' }).className).not.toContain(btnPrimary);
    expect(use.className).toContain(btnPrimary);
    expect(screen.queryByText('Open Review to check it')).toBeNull();
  });
  it('Try again on a first design keeps the words, focuses the prompt box and says what to do', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    const { chrome } = renderDescribe({ spec: starterSpec() });
    await make('Add a page');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'What the helper made' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('Add a page');
    expect(document.activeElement).toBe(screen.getByLabelText('Your prompt'));
    expect(chrome.announce).toHaveBeenCalledWith('Change your words, then press Make my app.');
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('Try again on a change of a saved app puts the cursor in the Ask box and leaves the first prompt alone', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    writePrompt(APP_ID, 'My first words');
    const { chrome } = renderDescribe();
    await ask('Add a page');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Your changes' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ask for a change')));
    expect(chrome.announce).toHaveBeenCalledWith('Change your words, then press Ask.');
    expect(screen.getByText('My first words')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });
  it('Ask for a change on a waiting design refines it with the new words only and leaves the first prompt alone (P17-04)', async () => {
    const calls = mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    const { chrome } = renderDescribe({ spec: starterSpec() });
    await make('A crew roster');
    await screen.findByRole('button', { name: 'Use this' });
    const box = screen.getByLabelText('Ask for a change') as HTMLInputElement;
    expect(box.maxLength).toBe(2000);
    fireEvent.change(box, { target: { value: 'and a form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(describeCalls(calls)).toHaveLength(2));
    expect(describeCalls(calls)[1].body).toMatchObject({ mode: 'edit', instruction: 'and a form', onto: 'waiting' });
    // Said when the answer lands, once, in the neutral words; never at the ask and never as the replaced line.
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith(DESIGN_CHANGED + CHECK_IT));
    expect(vi.mocked(chrome.announce).mock.calls.filter(([said]) => String(said).includes('waiting design'))).toHaveLength(1);
    expect(chrome.announce).not.toHaveBeenCalledWith(DESIGN_REPLACED + CHECK_IT);
    // The prompt box still holds the first prompt, and the pane quotes the newest ask only.
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('A crew roster');
    expect(await screen.findByText('and a form')).toBeTruthy();
    expect(screen.getByText('Nothing changed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/prompt|no-state`);
  });
  it('shows the current step as one live line while the helper works', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? openStream([['progress', { step: 'tables', round: 0, status: 'running' }]]) : json(404, {})));
    renderDescribe();
    await ask('Add a page');
    expect(await screen.findByText('Planning the tables')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'The helper is working' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'The helper is working' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('This can take a few minutes on this computer.')).toBeTruthy();
    expect(screen.getByLabelText('Working on')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Working on: Planning the tables');
    expect(screen.getByLabelText('Working on').getAttribute('role')).toBe('img');
    const region = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // The same region stays on the page and only its text changes.
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('Cancel on a first prompt puts the cursor in the prompt box, and on a change in Start over with a new prompt', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? openStream([['progress', { step: 'tables', round: 0, status: 'running' }]]) : json(404, {})));
    renderDescribe({ spec: starterSpec() });
    await make('A crew roster');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const box = (await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(box));
    cleanup();

    mockApi((call) => (call.url.endsWith('/describe') ? openStream([['progress', { step: 'tables', round: 0, status: 'running' }]]) : json(404, {})));
    renderDescribe();
    await ask('Add a page');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const startOver = await screen.findByRole('button', { name: 'Start over with a new prompt' });
    await waitFor(() => expect(document.activeElement).toBe(startOver));
  });

  it('P-15: an answer that changes nothing is announced as no changes, judged as Nothing changed, and stays on Prompt', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(baseSpec()) : json(404, {})));
    const { chrome } = renderDescribe();
    await ask('Keep it as it is');
    expect(await screen.findByText('Nothing changed.')).toBeTruthy();
    expect(screen.getByText('Not done: Keep it as it is')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/prompt|no-state`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Your changes' })));
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(chrome.announce).toHaveBeenCalledWith(NO_CHANGES_SAID);
    expect(chrome.announce).not.toHaveBeenCalledWith(MADE_DESIGN);
    expect(NO_CHANGES_SAID).toBe('The helper suggested no changes.');
  });
  it('shows the failure in the right pane, keeps the text, announces it and Try again runs the same words again', async () => {
    const calls = mockApi((call) =>
      call.url.endsWith('/describe')
        ? sse([['error', { code: 'proposal_invalid', message: 'The model could not produce a valid app. Try a shorter description.' }]])
        : json(404, {}),
    );
    writePrompt(APP_ID, 'My first words');
    const { chrome } = renderDescribe();
    await ask('Add a page');
    expect(await screen.findByText('The helper could not make a design.')).toBeTruthy();
    // Announced by the session, so the visible sentence is not a second alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('The model could not produce a valid app. Try a shorter description.')).toBeTruthy();
    expect(screen.getByText('Your text is kept.')).toBeTruthy();
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith(`${DESIGN_FAILED} The model could not produce a valid app. Try a shorter description.`));
    // The ask is not the first prompt: the left pane and the kept words still hold the first prompt.
    expect(screen.getByText('My first words')).toBeTruthy();
    expect(readPrompt(APP_ID)).toBe('My first words');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(describeCalls(calls)).toHaveLength(2));
    expect(describeCalls(calls)[1].body).toMatchObject({ mode: 'edit', instruction: 'Add a page' });
  });
  it('links the character count to the prompt box', async () => {
    mockApi(() => json(404, {}));
    renderDescribe({ spec: starterSpec() });
    const box = await screen.findByLabelText('Your prompt');
    const count = document.getElementById(box.getAttribute('aria-describedby') ?? 'none');
    expect(count?.textContent).toBe('0 of 2000');
  });

  it('says the waiting design was replaced when the words are sent again', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    const { chrome } = renderDescribe({ spec: starterSpec() });
    await make('Add a page');
    expect(await screen.findByRole('heading', { level: 3, name: 'What the helper made' })).toBeTruthy();
    expect(chrome.announce).not.toHaveBeenCalledWith(DESIGN_REPLACED + CHECK_IT);
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    // Not at the press: when the new design lands, once.
    expect(chrome.announce).not.toHaveBeenCalledWith(DESIGN_REPLACED + CHECK_IT);
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith(DESIGN_REPLACED + CHECK_IT));
    expect(vi.mocked(chrome.announce).mock.calls.filter(([said]) => String(said).startsWith(DESIGN_REPLACED))).toHaveLength(1);
    expect(DESIGN_REPLACED).toBe('The helper made a new design in place of the one that was waiting.');
  });
  it('keeps the words per app and shows them again when the step opens again (P-02)', async () => {
    mockApi(() => json(404, {}));
    renderDescribe({ spec: starterSpec() });
    fireEvent.change(await screen.findByLabelText('Your prompt'), { target: { value: 'A roster for my crew' } });
    expect(readPrompt(APP_ID)).toBe('A roster for my crew');
    cleanup();
    renderDescribe({ spec: starterSpec() });
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('A roster for my crew');
    fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: '' } });
    expect(readPrompt(APP_ID)).toBe('');
  });

  it('opens with the kept words after a reload with no router state (P-02)', async () => {
    mockApi(() => json(404, {}));
    writePrompt(APP_ID, 'Kept from before');
    renderDescribe({ spec: starterSpec() });
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('Kept from before');
  });

  it('uses create wording on a starter spec, with a way to build it in Design, and offers to change the design only when designed', async () => {
    mockApi(() => json(404, {}));
    const first = renderDescribe({ spec: starterSpec() });
    expect(await screen.findByText('Say it in plain words. You check the design before it is used.')).toBeTruthy();
    expect(screen.getByLabelText('Your prompt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make my app' })).toBeTruthy();
    expect(screen.getByText('The helper runs on this computer. Nothing changes until you press Use this.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change this app instead' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'No helper? Build it yourself, starting with tables on Data' }));
    expect(first.chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/data`);
    cleanup();
    writePrompt(APP_ID, 'A crew roster');
    renderDescribe();
    expect(await screen.findByText('Change your app')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'No helper? Build it yourself in Design' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start over with a new prompt' }));
    // Starting over opens the first prompt as a box again, with the old words to change.
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('A crew roster');
    expect(screen.getByRole('button', { name: 'Change this app instead' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change this app instead' }));
    expect(screen.getByText(FIRST_PROMPT_LABEL)).toBeTruthy();
  });

  it('L-16: a saved app opened in another window shows the first prompt the server kept, and does not write it to this storage', async () => {
    mockApi(() => json(404, {}));
    renderDescribe({ record: { firstPrompt: 'Words from the other window' } });
    expect(await screen.findByText(FIRST_PROMPT_LABEL)).toBeTruthy();
    expect(screen.getByText('Words from the other window')).toBeTruthy();
    expect(screen.queryByText(NO_FIRST_PROMPT)).toBeNull();
    expect(readPrompt(APP_ID)).toBe('');
  });

  it('P17-05: a saved app has one ask box, the right pane\'s, and shows its first prompt as read-only words', async () => {
    mockApi(() => json(404, {}));
    writePrompt(APP_ID, 'A crew roster for my painting business');
    renderDescribe();
    expect(await screen.findByText(FIRST_PROMPT_LABEL)).toBeTruthy();
    expect(FIRST_PROMPT_LABEL).toBe('Your first prompt');
    const words = screen.getByText('A crew roster for my painting business');
    // The words scroll in their own named group that the keyboard can reach.
    expect(words.tagName).toBe('DIV');
    expect(words.getAttribute('role')).toBe('group');
    expect(words.getAttribute('aria-labelledby')).toBe(screen.getByText(FIRST_PROMPT_LABEL).id);
    expect(words.className).toContain('max-h-48');
    expect(words.className).toContain('overflow-y-auto');
    expect(words.getAttribute('tabindex')).toBe('0');
    expect(screen.queryByRole('textbox', { name: 'Your prompt' })).toBeNull();
    expect(screen.queryByLabelText('What should change?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for changes' })).toBeNull();
    expect(screen.getAllByLabelText('Ask for a change')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start over with a new prompt' })).toBeTruthy();
    cleanup();
    window.localStorage.clear();
    renderDescribe();
    expect(await screen.findByText(NO_FIRST_PROMPT)).toBeTruthy();
    expect(NO_FIRST_PROMPT).toBe('There is no first prompt for this app. Ask for a change in the box on the right.');
    expect(screen.getAllByLabelText('Ask for a change')).toHaveLength(1);
  });

  it('an edit launch from Preview or the page strip just runs with its words and does not replace the first prompt', async () => {
    const calls = mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    writePrompt(APP_ID, 'My first words');
    renderDescribe({ state: launchState({ mode: 'edit', instruction: 'On the page Home: add a chart' }), strict: true });
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(describeCalls(calls)).toHaveLength(1);
    expect(describeCalls(calls)[0].body).toMatchObject({ mode: 'edit', instruction: 'On the page Home: add a chart' });
    expect(screen.getByText('My first words')).toBeTruthy();
    expect(readPrompt(APP_ID)).toBe('My first words');
    expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/prompt|no-state`);
  });

  it('P17-01: a reopened app shows the waiting design the server kept, with Use this, Try again and Ask, and the stored prompt in the empty box', async () => {
    const calls = mockApi((call) => (call.url.endsWith('/waiting') && call.method === 'GET' ? json(200, { data: waitingEntry() }) : json(404, {})));
    renderDescribe({ spec: starterSpec() });
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByLabelText('Ask for a change')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'What the helper made' })).toBeTruthy();
    await waitFor(() => expect(((screen.getByLabelText('Your prompt') as HTMLTextAreaElement).value)).toBe('A crew roster'));
    expect(screen.getByText('A crew roster', { selector: 'q' })).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/describe'))).toBe(false);
    // The design came back with the step: it does not take focus from the page.
    expect(document.activeElement).toBe(document.body);
  });

  it('B-10: the first prompt the server kept reaches browser storage as soon as it fills the box', async () => {
    mockApi((call) => (call.url.endsWith('/waiting') && call.method === 'GET' ? json(200, { data: waitingEntry() }) : json(404, {})));
    expect(readPrompt(APP_ID)).toBe('');
    renderDescribe({ spec: starterSpec() });
    await waitFor(() => expect(((screen.getByLabelText('Your prompt') as HTMLTextAreaElement).value)).toBe('A crew roster'));
    expect(readPrompt(APP_ID)).toBe('A crew roster');
  });

  it('P17-01: the stored prompt does not overwrite words the person has already typed, and a kept edit design leaves the first prompt alone', async () => {
    mockApi((call) => (call.url.endsWith('/waiting') && call.method === 'GET' ? json(200, { data: waitingEntry() }) : json(404, {})));
    writePrompt(APP_ID, 'Typed before');
    renderDescribe({ spec: starterSpec() });
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('Typed before');
    cleanup();
    window.localStorage.clear();
    writePrompt(APP_ID, 'Kept first prompt');
    mockApi((call) => (call.url.endsWith('/waiting') && call.method === 'GET' ? json(200, { data: waitingEntry({ mode: 'edit', instruction: 'Add a page' }) }) : json(404, {})));
    renderDescribe();
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(screen.getByText('Kept first prompt')).toBeTruthy();
    expect(screen.getByText('Add a page', { selector: 'q' })).toBeTruthy();
  });

  it('P17-04: Use this saves the design and clears the waiting copy with it', async () => {
    mockApi((call) => (call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {})));
    const { value } = renderDescribe();
    await ask('Add a page');
    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(value.save).toHaveBeenCalledWith(withPage(), { baseRevision: 3, clearWaiting: true, waitingAt: null }));
  });
  it('a change that fails shows the waiting design again with the reason, and Try again asks the same words onto it', async () => {
    let describes = 0;
    const calls = mockApi((call) => {
      if (call.url.endsWith('/waiting') && call.method === 'GET') return json(200, { data: waitingEntry({ at: 'v1' }) });
      if (!call.url.endsWith('/describe')) return json(404, {});
      describes += 1;
      return describes === 1 ? sse([['error', { code: 'could_not_generate', message: 'The helper could not do that.' }]]) : proposalReply(withPage());
    });
    const { chrome } = renderDescribe({ spec: starterSpec() });
    await screen.findByRole('button', { name: 'Use this' });
    await ask('Add notes');
    expect(await screen.findByText('The helper could not do that.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'What the helper made' })).toBeTruthy();
    expect(chrome.announce).toHaveBeenCalledWith(`${DESIGN_FAILED} The helper could not do that.`);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(describeCalls(calls)).toHaveLength(2));
    expect(describeCalls(calls)[1].body).toMatchObject({ mode: 'edit', instruction: 'Add notes', onto: 'waiting' });
    await waitFor(() => expect(screen.queryByText('The helper could not do that.')).toBeNull());
  });

  it('a waiting design made before the app was saved says so, with Try again as a plain run of the first words and no Ask or Use this', async () => {
    const calls = mockApi((call) => {
      if (call.url.endsWith('/waiting') && call.method === 'GET') return json(200, { data: waitingEntry({ baseRevision: 2 }) });
      return call.url.endsWith('/describe') ? proposalReply(withPage()) : json(404, {});
    });
    renderDescribe({ spec: starterSpec() });
    expect(await screen.findByText(DESIGN_STALE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(screen.queryByLabelText('Ask for a change')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(describeCalls(calls)).toHaveLength(1));
    expect(describeCalls(calls)[0].body).toMatchObject({ mode: 'create', instruction: 'A crew roster' });
    expect(describeCalls(calls)[0].body).not.toHaveProperty('onto');
  });

  it('Start over with a new prompt clears the server copy (its version only) and puts the cursor in the prompt box', async () => {
    const calls = mockApi((call) => (call.url.includes('/waiting') && call.method === 'GET' ? json(200, { data: waitingEntry({ mode: 'edit', instruction: 'Add a page', at: 'v5' }) }) : call.method === 'DELETE' ? json(200, { data: { id: APP_ID } }) : json(404, {})));
    writePrompt(APP_ID, 'Kept first prompt');
    renderDescribe();
    // The server's design is in before the person starts over.
    await screen.findByRole('button', { name: 'Use this' });
    fireEvent.click(screen.getByRole('button', { name: 'Start over with a new prompt' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([expect.stringMatching(/\/waiting\?at=v5$/)]));
    const box = await screen.findByLabelText('Your prompt');
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('a saved app opened for a change puts the cursor on the review heading when Change this app instead is pressed', async () => {
    mockApi(() => json(404, {}));
    renderDescribe();
    fireEvent.click(await screen.findByRole('button', { name: 'Start over with a new prompt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change this app instead' }));
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H3'));
  });

  it('runs a launch once under StrictMode, clears the router state first, and never reruns', async () => {
    const calls = mockApi((call) => (call.url.endsWith('/describe') ? proposalReply() : json(404, {})));
    renderDescribe({ spec: starterSpec(), state: launchState({ mode: 'create', instruction: 'A crew roster' }), strict: true });
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(describeCalls(calls)).toHaveLength(1);
    expect(describeCalls(calls)[0].body).toMatchObject({ mode: 'create', instruction: 'A crew roster' });
    expect(((await screen.findByLabelText('Your prompt')) as HTMLTextAreaElement).value).toBe('A crew roster');
    expect(screen.getByTestId('where').textContent).toBe(`/apps/${APP_ID}/prompt|no-state`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(describeCalls(calls)).toHaveLength(1);
  });

  it('runs the launch only after the router state is cleared', async () => {
    const seen: string[] = [];
    const calls = mockApi((call) => {
      if (call.url.endsWith('/describe')) {
        seen.push(screen.getByTestId('where').textContent ?? '');
        return proposalReply();
      }
      return json(404, {});
    });
    renderDescribe({ spec: starterSpec(), state: launchState({ mode: 'create', instruction: 'A crew roster' }), strict: true });
    // The design shows in the right pane once the helper is done: the run went through the workspace session.
    expect(await screen.findByRole('button', { name: 'Use this' })).toBeTruthy();
    expect(describeCalls(calls)).toHaveLength(1);
    expect(seen).toEqual([`/apps/${APP_ID}/prompt|no-state`]);
  });

  it('does not run anything without a launch state', async () => {
    const calls = mockApi(() => json(404, {}));
    renderDescribe({ spec: starterSpec() });
    await screen.findByLabelText('Your prompt');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(describeCalls(calls)).toHaveLength(0);
  });

  it('shows the helper card with a skip to Design, disables the primary and does not run a pending launch when Ollama is down', async () => {
    setupMock.mockResolvedValue(setupState({ ollama: 'stopped', ready: false, models: [] }));
    const calls = mockApi(() => json(404, {}));
    const { chrome } = renderDescribe({ spec: starterSpec(), state: launchState({ mode: 'create', instruction: 'A crew roster' }) });
    expect(await screen.findByText(/Set up the helper/)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Your prompt') as HTMLTextAreaElement).value).toBe('A crew roster'));
    const make = screen.getByRole('button', { name: 'Make my app' }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    expect(make.className).toBe(btnSecondary);
    expect(describeCalls(calls)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Build it yourself in Design' }));
    expect(chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/data`);
  });

  it('shows the helper card with the server message on a 503 when the setup check itself failed', async () => {
    setupMock.mockRejectedValue(new Error('offline'));
    mockApi((call) =>
      call.url.endsWith('/describe')
        ? json(503, { error: 'ollama_unavailable', reason: 'ollama_unavailable', message: 'Ollama is not running.' })
        : json(404, {}),
    );
    renderDescribe();
    await ask('Add a page');
    expect(await screen.findByText(/Set up the helper/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Ollama is not running.');
    expect(screen.queryByText('The helper could not make a design')).toBeNull();
  });

  it('shows the server message when Describe is refused as local only', async () => {
    const message = 'The helper runs only on the model on this computer. Choose a local Ollama tools model in Settings > AI.';
    mockApi((call) => (call.url.endsWith('/describe') ? json(409, { error: 'describe_local_only', message }) : json(404, {})));
    renderDescribe();
    await ask('Add a page');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/Set up the helper/)).toBeNull();
  });
});
