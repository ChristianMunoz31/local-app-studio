import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID } from '../../__tests__/harness';
import type { UseDescribe } from '../../hooks/useDescribe';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { STEP_FOCUS } from '../../lib/steps';
import type { SaveResult, WorkspaceValue } from '../../types';
import ReviewPane, { CHANGE_NOT_MADE, DESIGN_STALE, STALE_HELPER_DOWN, THROW_AWAY } from '../ReviewPane';
import type { ReviewPaneProps } from '../ReviewPane';

const session = vi.hoisted(() => ({ current: null as UseDescribe | null }));
vi.mock('../../hooks/useDescribeSession', () => ({
  useDescribeSession: () => {
    if (!session.current) throw new Error('no session');
    return session.current;
  },
}));

const withExtraPage = (): AppSpec => {
  const next = structuredClone(baseSpec());
  next.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: { id: 'root_extra', type: 'Page', props: {}, children: [] } });
  return next;
};
const starter = (): AppSpec => ({ ...baseSpec(), tables: [] });

const describeState = (over: Partial<UseDescribe> = {}): UseDescribe => ({
  phase: 'idle',
  progress: [],
  proposal: null,
  fallbacks: [],
  baseRevision: null,
  error: null,
  ai: null,
  instruction: null,
  mode: null,
  asks: [],
  replaced: null,
  hydrated: true,
  waitingAt: null,
  stale: false,
  stopped: false,
  lastAsk: null,
  landed: null,
  run: vi.fn(),
  refine: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
  ...over,
});

const waiting = (over: Partial<UseDescribe> = {}): UseDescribe =>
  describeState({ phase: 'proposal', proposal: withExtraPage(), baseRevision: 3, instruction: 'Add an extra page', mode: 'edit', ...over });

interface Setup {
  spec?: AppSpec;
  save?: WorkspaceValue['save'];
  props?: Partial<ReviewPaneProps>;
}

function setupPane({ spec = baseSpec(), save, props = {} }: Setup = {}) {
  const record = recordOf(spec);
  const value = {
    record,
    spec,
    revision: 3,
    save: save ?? vi.fn(async (): Promise<SaveResult> => ({ ok: true, record })),
    reload: vi.fn(),
    setDirty: vi.fn(),
  } as unknown as WorkspaceValue;
  const chrome: StepChrome = { setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() };
  const paneProps: ReviewPaneProps = { mode: 'edit', helperDown: false, setupError: false, onFocusPrompt: vi.fn(), ...props };
  const tree = (): ReactElement => (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <StepChromeContext.Provider value={chrome}>
          <ReviewPane {...paneProps} />
        </StepChromeContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>
  );
  const view = render(tree());
  return { value, chrome, props: paneProps, rerender: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(404, {})),
  );
  session.current = describeState();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReviewPane states', () => {
  it('has nothing to check on a starter app and says what to do', () => {
    setupPane({ spec: starter() });
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing to check yet' })).toBeTruthy();
    expect(screen.getByText("Write your prompt and the helper's design shows here.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(screen.queryByLabelText('Ask for a change')).toBeNull();
  });

  it('shows the bullets of a designed app with Show everything holding the old summary, and an Ask box', () => {
    setupPane();
    expect(screen.getByRole('heading', { level: 3, name: 'Your app' })).toBeTruthy();
    expect(screen.getByText('Crew Roster has 1 page and 1 table. No page shows Crews yet.')).toBeTruthy();
    expect(screen.getByText('Crews: Name, Size, Status')).toBeTruthy();
    expect(screen.getByText('Home has words only.')).toBeTruthy();
    const fold = screen.getByText('Show everything').closest('details') as HTMLElement;
    expect(fold.textContent).toContain('1 table and 1 page.');
    expect(fold.textContent).toContain('Crews: 3 fields (Name, Size, Status)');
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(screen.getByLabelText('Ask for a change')).toBeTruthy();
  });

  it('shows the helper at work with the progress lines and marks the pane busy', () => {
    session.current = describeState({
      phase: 'running',
      progress: [
        { step: 'tables', status: 'done', message: 'Planned the tables' },
        { step: 'outline', status: 'running', message: 'Planning the pages' },
      ] as UseDescribe['progress'],
    });
    setupPane();
    expect(screen.getByRole('heading', { level: 3, name: 'The helper is working' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'The helper is working' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('This can take a few minutes on this computer.')).toBeTruthy();
    expect(screen.getByText('Planned the tables')).toBeTruthy();
    expect(screen.getByLabelText('Working on')).toBeTruthy();
    expect(screen.getByLabelText('Done')).toBeTruthy();
    expect(screen.queryByLabelText('Ask for a change')).toBeNull();
  });

  it('shows the waiting design with the words asked, the bullets and all four actions', () => {
    session.current = waiting();
    setupPane();
    expect(screen.getByRole('heading', { level: 3, name: 'Your changes' })).toBeTruthy();
    expect(screen.getByText('You asked for:')).toBeTruthy();
    expect(screen.getByText('Add an extra page')).toBeTruthy();
    // The ask is judged in code: Done by the page it added, which is then not repeated as a side effect.
    expect(screen.getByText('Done: Add an extra page')).toBeTruthy();
    expect(screen.queryByText('Added the page Extra')).toBeNull();
    expect(screen.queryByText('It also changed')).toBeNull();
    for (const name of ['Use this', 'Use this and try it', 'Try again']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByText('Show everything')).toBeTruthy();
    expect(screen.getByLabelText('Ask for a change')).toBeTruthy();
  });

  it('titles a created design What the helper made', () => {
    session.current = waiting({ mode: 'create' });
    setupPane({ props: { mode: 'create' } });
    expect(screen.getByRole('heading', { level: 3, name: 'What the helper made' })).toBeTruthy();
  });

  it('shows an answer with no changes as the plain no-changes words with Try again, no Use this, and the Ask box', () => {
    session.current = waiting({ phase: 'unchanged', proposal: baseSpec() });
    setupPane();
    expect(screen.getByRole('heading', { level: 3, name: 'Your changes' })).toBeTruthy();
    expect(screen.getByText('Nothing changed.')).toBeTruthy();
    expect(screen.getByText('Not done: Add an extra page')).toBeTruthy();
    expect(screen.getByText('The helper did not do what you asked. Try other words, or do it yourself.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByLabelText('Ask for a change')).toBeTruthy();
  });

  it('after a failed run says so with the reason, Try again and Build it yourself, not "Nothing to check yet"', () => {
    const run = vi.fn();
    session.current = describeState({
      phase: 'error',
      error: { code: 'model_unusable', message: 'The helper on this computer did not give a usable answer. Try again, or build it yourself.', reason: null },
      instruction: 'A crew roster',
      mode: 'create',
      run,
    });
    const { chrome } = setupPane({ spec: starter() });
    expect(screen.queryByText('Nothing to check yet')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'The helper could not make a design.' })).toBeTruthy();
    // The session hook announces the failure, so the visible words are not a second alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/did not give a usable answer/)).toBeTruthy();
    expect(screen.getByText('Your text is kept.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(run).toHaveBeenCalledWith('create', 'A crew roster');
    fireEvent.click(screen.getByRole('button', { name: 'Build it yourself, starting with tables on Data' }));
    expect(chrome.go).toHaveBeenLastCalledWith(`/apps/${APP_ID}/data`);
  });

  it('sends Build it yourself to Design once the app has tables, and says nothing of a setup failure', () => {
    session.current = describeState({ phase: 'error', error: { code: null, message: 'x', reason: null } });
    const { chrome } = setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Build it yourself in Design' }));
    expect(chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/design`);
    cleanup();
    session.current = describeState({ phase: 'error', error: { code: 'ollama_unavailable', message: 'Ollama is not running.', reason: null } });
    setupPane({ props: { setupError: true } });
    expect(screen.queryByText('The helper could not make a design.')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Your app' })).toBeTruthy();
  });
});

describe('ReviewPane actions', () => {
  it('Use this saves, announces and goes to Design', async () => {
    session.current = waiting();
    const { value, chrome } = setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/design`));
    expect(value.save).toHaveBeenCalledWith(withExtraPage(), { baseRevision: 3, clearWaiting: true, waitingAt: null });
    // The save already cleared the server's copy of this version: no second delete.
    expect(session.current?.discard).toHaveBeenCalledWith({ keepServerCopy: true });
    expect(chrome.announce).toHaveBeenCalledWith("Saved the helper's design.");
  });

  it('Use this and try it saves and goes to Preview', async () => {
    session.current = waiting();
    const { value, chrome } = setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Use this and try it' }));
    await waitFor(() => expect(chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/preview`));
    expect(value.save).toHaveBeenCalledTimes(1);
  });

  it('Try again throws the design away, keeps the words and says what to do: the Ask box for a change, the prompt box for a first design', async () => {
    session.current = waiting();
    const { value, chrome, props, rerender } = setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(session.current?.discard).toHaveBeenCalledWith({ keepInstruction: true });
    // A change is asked for in this pane's box: the prompt box on the left is not the place.
    expect(props.onFocusPrompt).not.toHaveBeenCalled();
    expect(chrome.announce).toHaveBeenCalledWith('Change your words, then press Ask.');
    expect(chrome.go).not.toHaveBeenCalled();
    expect(value.save).not.toHaveBeenCalled();
    // The design is gone: the Ask box shows and takes the cursor.
    session.current = describeState();
    rerender();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ask for a change')));
    cleanup();
    session.current = waiting({ mode: 'create' });
    const second = setupPane({ props: { mode: 'create' } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(second.chrome.announce).toHaveBeenCalledWith('Change your words, then press Make my app.');
    expect(second.props.onFocusPrompt).toHaveBeenCalledTimes(1);
  });

  it('says the app changed on a conflict and stays, in the words of the mode', async () => {
    session.current = waiting({ mode: 'create' });
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: false, code: 'revision_conflict', message: 'x', issues: [] }));
    const { chrome } = setupPane({ save, props: { mode: 'create' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByText('This app changed while the helper worked. Press Make my app again.')).toBeTruthy();
    expect(chrome.go).not.toHaveBeenCalled();
    cleanup();
    session.current = waiting();
    setupPane({ save });
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByText('This app changed while the helper worked. Press Ask again.')).toBeTruthy();
  });

  it('does not move to the next step when the person left Prompt while the save was on its way', async () => {
    session.current = waiting();
    let finish: (r: SaveResult) => void = () => undefined;
    const save = vi.fn(() => new Promise<SaveResult>((resolve) => (finish = resolve)));
    const { chrome, value } = setupPane({ save });
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    cleanup();
    finish({ ok: true, record: value.record });
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith("Saved the helper's design."));
    expect(chrome.go).not.toHaveBeenCalled();
  });

  it('shows another refusal with its own message', async () => {
    session.current = waiting();
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: false, code: 'invalid_spec', message: 'Could not save.', issues: [] }));
    setupPane({ save });
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByText('Could not save.')).toBeTruthy();
  });
});

describe('ReviewPane Ask for a change', () => {
  it('on a saved app runs an edit with the words, and is the only box: nothing is handed to a prompt box', () => {
    const run = vi.fn();
    session.current = describeState({ run });
    setupPane();
    const box = screen.getByLabelText('Ask for a change') as HTMLInputElement;
    expect(box.tagName).toBe('INPUT');
    expect(box.maxLength).toBe(2000);
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: ' add a chart ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(run).toHaveBeenCalledWith('edit', 'add a chart');
    expect(session.current?.refine).not.toHaveBeenCalled();
    expect(box.value).toBe('');
  });

  it('on a waiting design refines that design with the new words only, whatever the first words were (P17-04)', () => {
    const run = vi.fn();
    const refine = vi.fn();
    session.current = waiting({ run, refine, instruction: 'x'.repeat(1999) });
    const { chrome } = setupPane();
    const box = screen.getByLabelText('Ask for a change') as HTMLInputElement;
    expect(box.maxLength).toBe(2000);
    fireEvent.change(box, { target: { value: 'and a form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(refine).toHaveBeenCalledWith('and a form');
    expect(run).not.toHaveBeenCalled();
    // What the helper did is said when its answer lands (useDescribeSession), not when the ask starts.
    expect(chrome.announce).not.toHaveBeenCalled();
  });

  it('on an answer that changed nothing runs an edit of the saved app, since no design waits', () => {
    const run = vi.fn();
    const refine = vi.fn();
    session.current = waiting({ phase: 'unchanged', proposal: baseSpec(), run, refine });
    setupPane();
    fireEvent.change(screen.getByLabelText('Ask for a change'), { target: { value: 'add a page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(run).toHaveBeenCalledWith('edit', 'add a page');
    expect(refine).not.toHaveBeenCalled();
  });

  it('shows only the newest ask, the earlier ones as asked before, and judges the newest against the design it replaced', () => {
    session.current = waiting({ asks: ['Add a Size field', 'Add an Extra page'], replaced: baseSpec() });
    setupPane();
    expect(screen.getByText('Add an Extra page').tagName).toBe('Q');
    expect(screen.getByText('Asked before:')).toBeTruthy();
    expect(screen.getByText('Done: Add an Extra page')).toBeTruthy();
  });

  it('does not announce when Ask starts: the answer says what happened, once', () => {
    session.current = waiting();
    const { chrome } = setupPane();
    fireEvent.change(screen.getByLabelText('Ask for a change'), { target: { value: 'and a form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(chrome.announce).not.toHaveBeenCalled();
  });

  it('moves focus to the heading when the run starts from the Ask box', async () => {
    session.current = describeState();
    const pane = setupPane();
    fireEvent.change(screen.getByLabelText('Ask for a change'), { target: { value: 'add a chart' } });
    screen.getByLabelText('Ask for a change').focus();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    session.current = describeState({ phase: 'running' });
    pane.rerender();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'The helper is working' })));
  });

  it('is off while the helper is down', () => {
    setupPane({ props: { helperDown: true } });
    fireEvent.change(screen.getByLabelText('Ask for a change'), { target: { value: 'x' } });
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends a not done ask to Data, to Design, or to the Look tab of Design', () => {
    session.current = waiting({ instruction: 'Add a Phone field to Crews.', asks: [], mode: 'edit' });
    const first = setupPane();
    // The button's name carries the clause it belongs to, so a list of them is not read as the same words.
    fireEvent.click(screen.getByRole('button', { name: /^Do it on Data\. / }));
    expect(first.chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/data`);
    cleanup();
    session.current = waiting({ instruction: 'Remove the Home page.', asks: [], mode: 'edit', proposal: withExtraPage() });
    const second = setupPane();
    fireEvent.click(screen.getByRole('button', { name: /^Do it in Design\. / }));
    expect(second.chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/design`, undefined);
    cleanup();
    session.current = waiting({ instruction: 'Make the look dark green.', asks: [], mode: 'edit' });
    const third = setupPane();
    fireEvent.click(screen.getByRole('button', { name: /^Change the look in Design\. / }));
    expect(third.chrome.go).toHaveBeenCalledWith(`/apps/${APP_ID}/design`, { state: { ...STEP_FOCUS, shelfTab: 'look' } });
  });
});

describe('ReviewPane focus', () => {
  it('moves focus to the heading when a design lands, and not on a remount with one waiting', async () => {
    const pane = setupPane();
    expect(document.activeElement).toBe(document.body);
    session.current = waiting();
    pane.rerender();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Your changes' })));
    cleanup();
    (document.activeElement as HTMLElement | null)?.blur();
    session.current = waiting();
    setupPane();
    expect(document.activeElement).toBe(document.body);
  });

  it('does not move focus when a change is cancelled and the design comes back as it was', async () => {
    session.current = waiting({ landed: 'new' });
    const pane = setupPane();
    session.current = waiting({ phase: 'running', proposal: null });
    pane.rerender();
    (document.activeElement as HTMLElement | null)?.blur();
    session.current = waiting({ landed: null });
    pane.rerender();
    expect(await screen.findByRole('heading', { level: 3, name: 'Your changes' })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it('does not take focus when the design the server kept comes back as the step opens', async () => {
    session.current = describeState({ hydrated: false });
    const pane = setupPane();
    session.current = waiting({ hydrated: true });
    pane.rerender();
    expect(await screen.findByRole('heading', { level: 3, name: 'Your changes' })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the heading for an answer with no changes, and leaves it alone on an error', async () => {
    const pane = setupPane();
    session.current = waiting({ phase: 'unchanged', proposal: baseSpec() });
    pane.rerender();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Your changes' })));
    cleanup();
    const second = setupPane();
    session.current = describeState({ phase: 'error', error: { code: null, message: 'x', reason: null } });
    second.rerender();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('ReviewPane a change that failed, and a design made before the app was saved', () => {
  const failedAsk = (over: Partial<UseDescribe> = {}): UseDescribe =>
    waiting({ asks: ['Add jobs'], lastAsk: 'Add notes', error: { code: 'could_not_generate', message: 'The helper could not do that.', reason: null }, ...over });

  it('shows the design again with the reason above it, and Try again asks the same words again', () => {
    const refine = vi.fn();
    const run = vi.fn();
    session.current = failedAsk({ refine, run });
    setupPane();
    expect(screen.getByText('The helper could not do that.')).toBeTruthy();
    expect(screen.getByText(CHANGE_NOT_MADE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refine).toHaveBeenCalledWith('Add notes');
    expect(run).not.toHaveBeenCalled();
    expect(session.current?.discard).not.toHaveBeenCalled();
  });

  it('a waiting design with no failed ask shows no note', () => {
    session.current = waiting();
    setupPane();
    expect(screen.queryByText(CHANGE_NOT_MADE)).toBeNull();
  });

  it('a stale design says the app was saved since, offers only Try again as a plain run of the first words, and no Ask or Use this', () => {
    const run = vi.fn();
    session.current = waiting({ stale: true, run, mode: 'create', instruction: 'A crew roster' });
    setupPane({ spec: starter(), props: { mode: 'create' } });
    expect(DESIGN_STALE).toBe('You saved the app after this design was made. Make a new design to use the helper again.');
    expect(screen.getByText(DESIGN_STALE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use this and try it' })).toBeNull();
    expect(screen.queryByLabelText('Ask for a change')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(run).toHaveBeenCalledWith('create', 'A crew roster');
  });

  it('a stale design offers Throw it away, which discards it', () => {
    const discard = vi.fn();
    session.current = waiting({ stale: true, discard, instruction: 'A crew roster' });
    setupPane();
    expect(THROW_AWAY).toBe('Throw it away');
    fireEvent.click(screen.getByRole('button', { name: THROW_AWAY }));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(STALE_HELPER_DOWN)).toBeNull();
  });

  it('a stale design with the helper down says why Try again is off', () => {
    session.current = waiting({ stale: true, instruction: 'A crew roster' });
    setupPane({ props: { helperDown: true } });
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(STALE_HELPER_DOWN)).toBeTruthy();
  });

  it('Try again on a stale design is a change for a saved app and a first design for a starter, whatever mode the old design had', () => {
    const run = vi.fn();
    session.current = waiting({ stale: true, run, mode: 'create', instruction: 'A crew roster' });
    setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(run).toHaveBeenLastCalledWith('edit', 'A crew roster');
    cleanup();
    const run2 = vi.fn();
    session.current = waiting({ stale: true, run: run2, mode: 'edit', instruction: 'A crew roster' });
    setupPane({ spec: starter() });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(run2).toHaveBeenLastCalledWith('create', 'A crew roster');
  });

  it('a design that turns stale after a Use this conflict swaps the design for the stale words', async () => {
    session.current = waiting();
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: false, code: 'revision_conflict', message: 'x', issues: [] }));
    const pane = setupPane({ save });
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await screen.findByText('This app changed while the helper worked. Press Ask again.');
    session.current = waiting({ stale: true });
    pane.rerender();
    expect(screen.getByText(DESIGN_STALE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('Use this sends the version it holds so only that design is cleared', async () => {
    session.current = waiting({ waitingAt: 'v9' });
    const { value } = setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(value.save).toHaveBeenCalledWith(withExtraPage(), { baseRevision: 3, clearWaiting: true, waitingAt: 'v9' }));
  });
});

describe('ReviewPane focus requests', () => {
  it('the Ask box takes the cursor once after Try again, and not again when it mounts later', async () => {
    session.current = waiting();
    const pane = setupPane();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    session.current = describeState();
    pane.rerender();
    const box = await screen.findByLabelText('Ask for a change');
    await waitFor(() => expect(document.activeElement).toBe(box));
    (document.activeElement as HTMLElement).blur();
    session.current = describeState({ phase: 'running' });
    pane.rerender();
    session.current = describeState();
    pane.rerender();
    expect(document.activeElement).not.toBe(screen.getByLabelText('Ask for a change'));
  });

  it('the heading takes the cursor when the focus token counts up, and not on the first render', async () => {
    const pane = setupPane({ props: { headingFocusToken: 0 } });
    expect(document.activeElement).toBe(document.body);
    pane.props.headingFocusToken = 1;
    pane.rerender();
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H3'));
  });
});
