import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseSpec } from '../../__tests__/fixtures';
import {
  BUILD_INTRO_NO_INSTALLER,
  PROMPT_INTRO_NO_HELPER,
  STEPS,
  pageAskInstruction,
  STEP_FOCUS,
  backLabel,
  hasDesignedPage,
  isStarterSpec,
  landingStep,
  launchState,
  nextLabel,
  nextStepOf,
  readLaunch,
  routeOf,
  startStep,
  stepIndex,
  stepIntro,
  stepPath,
  stepStates,
  wantsStepFocus,
} from '../steps';
import type { StepFacts, StepId, StepState } from '../steps';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';

// The flag module is the one thing that differs between builds: each test sets the parts it is about.
const parts = vi.hoisted(() => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('@/proParts.js', () => parts);
afterEach(() => {
  parts.PRO_PARTS.helper = true;
  parts.PRO_PARTS.installer = true;
});

const starter = { ...baseSpec(), tables: [] };
const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  designed: true,
  helperUsed: true,
  tableCount: 1,
  proposalWaiting: false,
  revision: 3,
  previewedRevision: null,
  builtRevision: null,
  ...over,
});
const all = (s: StepState): Record<StepId, StepState> => ({ prompt: s, design: s, data: s, preview: s, build: s });

describe('steps', () => {
  it('has five steps in order with plain intros', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['prompt', 'design', 'data', 'preview', 'build']);
    expect(STEPS.map((s) => s.label)).toEqual(['Prompt', 'Design', 'Data', 'Preview', 'Build']);
    expect(STEPS.every((s) => s.intro.length > 0)).toBe(true);
    expect(STEPS[0]).toEqual({ id: 'prompt', label: 'Prompt', intro: 'Tell the helper what your app is for, then check what it made.' });
    expect(STEPS[2].intro).toBe('The tables your app keeps and their fields.');
  });

  it('builds paths, indexes and labels', () => {
    expect(stepPath('a1', 'design')).toBe('/apps/a1/design');
    expect(stepIndex('prompt')).toBe(0);
    expect(stepIndex('build')).toBe(4);
    expect(nextLabel('data')).toBe('Next: Data');
    expect(backLabel('design')).toBe('Back: Design');
  });

  it('detects a starter spec and lands a designed app on Design', () => {
    expect(isStarterSpec(starter)).toBe(true);
    expect(isStarterSpec(baseSpec())).toBe(false);
    expect(landingStep(starter)).toBe('prompt');
    expect(landingStep(baseSpec())).toBe('design');
  });

  it('lands a starter app on Design, not Prompt, when the helper is not in the build', () => {
    parts.PRO_PARTS.helper = false;
    expect(startStep()).toBe('design');
    expect(landingStep(starter)).toBe('design');
    expect(landingStep(baseSpec())).toBe('design');
    parts.PRO_PARTS.helper = true;
    expect(startStep()).toBe('prompt');
  });

  it('words the Prompt and Build intros for what the build has', () => {
    expect(stepIntro('prompt')).toBe('Tell the helper what your app is for, then check what it made.');
    expect(stepIntro('build')).toBe('Make a Windows installer you can share.');
    parts.PRO_PARTS.helper = false;
    parts.PRO_PARTS.installer = false;
    expect(stepIntro('prompt')).toBe('Build your app in Design.');
    expect(stepIntro('build')).toBe('Share your app as a file.');
    expect(PROMPT_INTRO_NO_HELPER).toBe('Build your app in Design.');
    expect(BUILD_INTRO_NO_INSTALLER).toBe('Share your app as a file.');
    expect(stepIntro('data')).toBe('The tables your app keeps and their fields.');
  });

  it('is a starter only while the one page holds nothing but the starter heading (P-06)', () => {
    const page = starter.pages[0];
    const withKids = (children: LayoutLayer['children'], sources = page.sources): AppSpec => ({
      ...starter,
      pages: [{ ...page, sources, layout: { ...page.layout, children } }],
    });
    const heading: LayoutLayer = { id: 'heading_1', type: 'Heading', props: {}, children: 'Crew Roster' };
    const text: LayoutLayer = { id: 'text_1', type: 'Text', props: {}, children: 'Hello' };
    expect(isStarterSpec(withKids([heading]))).toBe(true);
    expect(isStarterSpec(withKids([]))).toBe(true);
    expect(isStarterSpec(withKids([heading, text]))).toBe(false);
    expect(isStarterSpec(withKids([text]))).toBe(false);
    expect(isStarterSpec(withKids([heading], [{ id: 'crews', table: 'crews' } as AppSpec['pages'][number]['sources'][number]]))).toBe(false);
    expect(isStarterSpec({ ...starter, pages: [page, { ...page, id: 'two', route: '/two' }] })).toBe(false);
    expect(isStarterSpec(baseSpec())).toBe(false);
    expect(landingStep(withKids([heading, text]))).toBe('design');
    expect(hasDesignedPage(starter)).toBe(false);
    expect(hasDesignedPage(withKids([heading, text]))).toBe(true);
  });

  it('maps route segments to steps, with the legacy review paths', () => {
    for (const id of ['prompt', 'design', 'data', 'preview', 'build'] as const) expect(routeOf(id)).toBe(id);
    expect(routeOf('describe')).toBe('prompt');
    expect(routeOf('review')).toBe('prompt');
    expect(STEPS.some((s) => (s.id as string) === 'describe')).toBe(false);
    expect(routeOf('review', 'data')).toBe('data');
    expect(routeOf('review', 'design')).toBe('design');
    expect(routeOf('review', 'junk')).toBe('prompt');
    expect(routeOf('preview', 'data')).toBe('preview');
    expect(routeOf('junk')).toBeNull();
    expect(routeOf(undefined)).toBeNull();
  });

  it('asks for step focus only through the router state flag', () => {
    expect(wantsStepFocus(STEP_FOCUS)).toBe(true);
    expect(wantsStepFocus(null)).toBe(false);
    expect(wantsStepFocus('x')).toBe(false);
    expect(wantsStepFocus({})).toBe(false);
  });

  describe('stepStates', () => {
    it('marks each step done by its own fact', () => {
      expect(stepStates(facts(), null)).toEqual({ prompt: 'done', design: 'done', data: 'done', preview: 'todo', build: 'todo' });
      expect(stepStates(facts({ designed: false, helperUsed: false, tableCount: 0 }), null)).toEqual(all('todo'));
      expect(stepStates(facts({ proposalWaiting: true }), null).prompt).toBe('todo');
      expect(stepStates(facts({ tableCount: 0 }), null).data).toBe('todo');
      expect(stepStates(facts({ previewedRevision: 3 }), null).preview).toBe('done');
      expect(stepStates(facts({ previewedRevision: 2 }), null).preview).toBe('todo');
      expect(stepStates(facts({ builtRevision: 3 }), null).build).toBe('done');
      expect(stepStates(facts({ builtRevision: 1 }), null).build).toBe('todo');
    });

    it('ticks Prompt only on evidence of a helper design, Design only on page content (P-16)', () => {
      const noHelper = stepStates(facts({ helperUsed: false }), null);
      expect(noHelper.prompt).toBe('todo');
      expect(noHelper.design).toBe('done');
      const blankPage = stepStates(facts({ designed: false }), null);
      expect(blankPage.design).toBe('todo');
      expect(blankPage.prompt).toBe('done');
      expect(stepStates(facts({ helperUsed: true, proposalWaiting: true }), null).prompt).toBe('todo');
      expect(stepStates(facts({ helperUsed: false, tableCount: 2 }), null).data).toBe('done');
    });

    it('lets current override everything', () => {
      expect(stepStates(facts({ previewedRevision: 3 }), 'preview').preview).toBe('current');
      expect(stepStates(facts({ designed: false, helperUsed: false, tableCount: 0 }), 'build').build).toBe('current');
      expect(stepStates(facts(), 'data').data).toBe('current');
    });
  });

  describe('nextStepOf', () => {
    it('is Prompt while a design waits and another step is open', () => {
      expect(nextStepOf(stepStates(facts({ proposalWaiting: true }), 'design'), 'design', true)).toBe('prompt');
    });

    it('never marks Prompt itself while it is open with a design waiting', () => {
      expect(nextStepOf(stepStates(facts({ designed: false, tableCount: 0, proposalWaiting: true }), 'prompt'), 'prompt', true)).toBe('design');
    });

    it('is the first step after current that is not done', () => {
      expect(nextStepOf(stepStates(facts(), 'design'), 'design', false)).toBe('preview');
      expect(nextStepOf(stepStates(facts({ tableCount: 0 }), 'prompt'), 'prompt', false)).toBe('data');
    });

    it('starts from the first step with no current one and is null when all are done', () => {
      expect(nextStepOf(stepStates(facts(), null), null, false)).toBe('preview');
      expect(nextStepOf(stepStates(facts({ designed: false, helperUsed: false, tableCount: 0 }), null), null, false)).toBe('prompt');
      expect(nextStepOf(stepStates(facts({ previewedRevision: 3, builtRevision: 3 }), null), null, false)).toBeNull();
      expect(nextStepOf(stepStates(facts({ previewedRevision: 3 }), 'build'), 'build', false)).toBeNull();
    });
  });

  it('names the page in an ask from the page strip, and caps at 2000', () => {
    expect(pageAskInstruction('Home', ' add a chart ')).toBe('On the page Home: add a chart');
    expect(pageAskInstruction('Home', 'x'.repeat(3000))).toHaveLength(2000);
  });

  it('round-trips launch state and rejects bad shapes', () => {
    expect(readLaunch(launchState({ mode: 'edit', instruction: '  add a field ' }))).toEqual({ mode: 'edit', instruction: 'add a field' });
    // A launch also asks for the step heading to take focus on arrival (R-5).
    expect(wantsStepFocus(launchState({ mode: 'create', instruction: 'x' }))).toBe(true);
    expect(readLaunch(null)).toBeNull();
    expect(readLaunch('x')).toBeNull();
    expect(readLaunch({})).toBeNull();
    expect(readLaunch({ describe: { mode: 'other', instruction: 'x' } })).toBeNull();
    expect(readLaunch({ describe: { mode: 'create', instruction: 5 } })).toBeNull();
    expect(readLaunch({ describe: { mode: 'create', instruction: '   ' } })).toBeNull();
    expect(readLaunch({ describe: { mode: 'create', instruction: 'x'.repeat(2001) } })).toBeNull();
  });
});
