// The Design page strip: the page bullet, the kept words, and Ask for a change (it goes to Prompt with the launch state).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { writePrompt } from '../../lib/appMemory';
import { pageAskInstruction, pageAskPrefix } from '../../lib/steps';
import { crewRosterSpec } from '../../lib/__tests__/promptBulletsFixtures';
import PageStrip from '../PageStrip';

// These tests are about the helper's screens, so the helper is in the build they run in (a public run has no helper: helperNotInBuild.test.tsx).
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
const session = vi.hoisted(() => ({ phase: 'idle' as 'idle' | 'running' | 'proposal' | 'unchanged' | 'error' }));
vi.mock('../../hooks/useDescribeSession', () => ({ useOptionalDescribeSession: () => ({ phase: session.phase }) }));

const go = vi.fn();
const chrome: StepChrome = { setDraft: vi.fn(), go, announce: vi.fn(), markDone: vi.fn() };
const spec = crewRosterSpec();
const pageId = spec.pages[0].id;

function show() {
  return render(
    <StepChromeContext.Provider value={chrome}>
      <PageStrip spec={spec} pageId={pageId} appId="app1" />
    </StepChromeContext.Provider>,
  );
}

beforeEach(() => {
  session.phase = 'idle';
  go.mockClear();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('PageStrip', () => {
  it('is a labelled section with the page line', () => {
    show();
    const region = screen.getByRole('region', { name: 'This page' });
    expect(region.textContent).toContain('Home shows a Crews list.');
  });

  it('says the kept words, cut at 120 characters with dots, and nothing when none are kept', () => {
    const { unmount } = show();
    expect(screen.queryByText(/Your words:/)).toBeNull();
    unmount();
    writePrompt('app1', 'a'.repeat(130));
    show();
    expect(screen.getByText(`Your words: "${'a'.repeat(120)}..."`)).toBeTruthy();
  });

  it('cuts long words at a word, never in the middle of one', () => {
    writePrompt('app1', `${'crew '.repeat(30)}tail`);
    show();
    const shown = screen.getByText(/^Your words:/).textContent ?? '';
    expect(shown.endsWith('crew..."')).toBe(true);
    expect(shown).not.toContain('tail');
    expect(shown).not.toMatch(/cre\.\.\./);
  });

  it('shows short words whole, with no dots', () => {
    writePrompt('app1', 'A roster of crews');
    show();
    expect(screen.getByText('Your words: "A roster of crews"')).toBeTruthy();
  });

  it('Ask goes to Prompt with the page named first and an edit launch', () => {
    show();
    const ask = screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Ask the helper to change this page'), { target: { value: ' add a notes column ' } });
    fireEvent.click(ask);
    expect(go).toHaveBeenCalledTimes(1);
    const [to, opts] = go.mock.calls[0] as [string, { state: { describe: { mode: string; instruction: string }; stepFocus: boolean } }];
    expect(to).toBe('/apps/app1/prompt');
    expect(opts.state.describe).toEqual({ mode: 'edit', instruction: 'On the page Home: add a notes column' });
    expect(opts.state.stepFocus).toBe(true);
  });

  it('limits the words so the prefix always fits the 2000 character cap', () => {
    show();
    const input = screen.getByLabelText('Ask the helper to change this page') as HTMLInputElement;
    // The prefix keeps its trailing space, so the longest words still make exactly 2000 characters (no spare character).
    expect(input.maxLength).toBe(2000 - pageAskPrefix('Home').length);
    expect(pageAskInstruction('Home', 'x'.repeat(input.maxLength)).length).toBe(2000);
  });

  it('while the helper runs, the form is replaced by the working line and Open Prompt', () => {
    session.phase = 'running';
    show();
    expect(screen.getByText('The helper is working on a design.')).toBeTruthy();
    expect(screen.queryByLabelText('Ask the helper to change this page')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Prompt' }));
    expect(go).toHaveBeenCalledWith('/apps/app1/prompt');
  });

  it.each(['proposal', 'unchanged'] as const)('a design waiting (%s) says so and offers Open Prompt, not Ask', (phase) => {
    session.phase = phase;
    show();
    expect(screen.getByText("The helper's design is waiting on Prompt.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Prompt' })).toBeTruthy();
  });

  it('renders nothing for a page that is gone', () => {
    const { container } = render(<PageStrip spec={spec} pageId="gone" appId="app1" />);
    expect(container.textContent).toBe('');
  });
});
