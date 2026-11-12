import type { AppSpec, Page } from '@local-app-studio/runtime/spec/schema';
import { PRO_PARTS } from '@/proParts.js';

export type StepId = 'prompt' | 'design' | 'data' | 'preview' | 'build';
export type StepState = 'done' | 'current' | 'todo';

export const STEPS: ReadonlyArray<{ id: StepId; label: string; intro: string }> = [
  { id: 'prompt', label: 'Prompt', intro: 'Tell the helper what your app is for, then check what it made.' },
  { id: 'design', label: 'Design', intro: 'Put parts on your pages and pick the look.' },
  { id: 'data', label: 'Data', intro: 'The tables your app keeps and their fields.' },
  { id: 'preview', label: 'Preview', intro: 'Try your app here. Records you add are preview data, kept apart from any app you build.' },
  { id: 'build', label: 'Build', intro: 'Make a Windows installer you can share.' },
];

/** Said in place of the Prompt intro in a build without the helper. */
export const PROMPT_INTRO_NO_HELPER = 'Build your app in Design.';
/** Said in place of the Build intro in a build without the installer. */
export const BUILD_INTRO_NO_INSTALLER = 'Share your app as a file.';

/** The intro of a step for this build: Prompt and Build say what works when the helper or the installer is not in the build. */
export function stepIntro(id: StepId): string {
  if (id === 'prompt' && !PRO_PARTS.helper) return PROMPT_INTRO_NO_HELPER;
  if (id === 'build' && !PRO_PARTS.installer) return BUILD_INTRO_NO_INSTALLER;
  return STEPS[STEPS.findIndex((s) => s.id === id)].intro;
}

const STEP_IDS: ReadonlyArray<StepId> = STEPS.map((s) => s.id);
const MAX_INSTRUCTION = 2000;

export const stepPath = (appId: string, step: StepId): string => `/apps/${appId}/${step}`;

/** Position of a step in the rail, 0 based. */
export const stepIndex = (step: StepId): number => STEP_IDS.indexOf(step);

const labelOf = (step: StepId): string => STEPS[stepIndex(step)].label;
export const nextLabel = (step: StepId): string => `Next: ${labelOf(step)}`;
export const backLabel = (step: StepId): string => `Back: ${labelOf(step)}`;

/** Router state that asks the workspace to focus the step heading on arrival. */
export const STEP_FOCUS: { stepFocus: true } = { stepFocus: true };
export const wantsStepFocus = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as { stepFocus?: unknown }).stepFocus === true;

/** True when a page holds nothing but the heading a new app starts with (or nothing at all). */
export function holdsOnlyStarterHeading(page: Page): boolean {
  const kids = page.layout.children;
  if (page.sources.length > 0 || !Array.isArray(kids)) return false;
  return kids.length === 0 || (kids.length === 1 && kids[0].type === 'Heading');
}

/** True when some page holds more than the starter heading: the Design step has something in it. */
export const hasDesignedPage = (spec: AppSpec): boolean => spec.pages.some((page) => !holdsOnlyStarterHeading(page));

/** Same rule the Prompt step uses for its default mode: no tables and one page that holds only the starter heading. */
export const isStarterSpec = (spec: AppSpec): boolean => spec.tables.length === 0 && spec.pages.length === 1 && holdsOnlyStarterHeading(spec.pages[0]);

/** Where a new app opens: Prompt when the helper is in the build, else Design (Prompt has nothing to do there). */
export const startStep = (): StepId => (PRO_PARTS.helper ? 'prompt' : 'design');

/** Where /apps/:id (index) and unknown sub paths land. */
export const landingStep = (spec: AppSpec): StepId => (isStarterSpec(spec) ? startStep() : 'design');

/**
 * Segment 3 (and 4 for the legacy /review/data and /review/design) to a step; the legacy /describe and /review are Prompt;
 * anything else null.
 */
export function routeOf(segment: string | undefined, sub?: string): StepId | null {
  if (segment === 'describe') return 'prompt';
  if (segment === 'review') return sub === 'data' || sub === 'design' ? sub : 'prompt';
  return STEP_IDS.find((id) => id === segment) ?? null;
}

export interface StepFacts {
  /** Some page holds more than the starter heading. */
  designed: boolean;
  /** A helper design was used for this app (or the app was made from words and has a design). */
  helperUsed: boolean;
  tableCount: number;
  proposalWaiting: boolean;
  revision: number;
  previewedRevision: number | null;
  builtRevision: number | null;
}

/** The mark of every step; the current one overrides everything. */
export function stepStates(facts: StepFacts, current: StepId | null): Record<StepId, StepState> {
  const done: Record<StepId, boolean> = {
    prompt: facts.helperUsed && !facts.proposalWaiting,
    design: facts.designed,
    data: facts.tableCount > 0,
    preview: facts.previewedRevision === facts.revision,
    build: facts.builtRevision === facts.revision,
  };
  const mark = (id: StepId): StepState => (current === id ? 'current' : done[id] ? 'done' : 'todo');
  return {
    prompt: mark('prompt'),
    design: mark('design'),
    data: mark('data'),
    preview: mark('preview'),
    build: mark('build'),
  };
}

/** The step marked "(next)": Prompt while a design waits (unless Prompt is open), else the first step after current (or from the start) that is not done; null when all are done. */
export function nextStepOf(states: Record<StepId, StepState>, current: StepId | null, proposalWaiting: boolean): StepId | null {
  if (proposalWaiting && current !== 'prompt') return 'prompt';
  const from = current === null ? 0 : stepIndex(current) + 1;
  return STEP_IDS.slice(from).find((id) => states[id] !== 'done') ?? null;
}

/** The prefix of an Ask from the page strip; the strip's box limits its words to `MAX_INSTRUCTION - length`. */
export const pageAskPrefix = (pageTitle: string): string => `On the page ${pageTitle}: `;

/** The words for a run asked from the Design page strip: the page is named first. */
export const pageAskInstruction = (pageTitle: string, words: string): string =>
  `${pageAskPrefix(pageTitle)}${words.trim()}`.slice(0, MAX_INSTRUCTION).trim();

export interface DescribeLaunch {
  mode: 'create' | 'edit';
  instruction: string;
}

/** The launch plus STEP_FOCUS, so arriving on Prompt with it focuses the heading and says the step. */
export const launchState = (l: DescribeLaunch): { describe: DescribeLaunch; stepFocus: true } => ({ describe: l, ...STEP_FOCUS });

/** Reads router location.state; anything malformed gives null. */
export function readLaunch(state: unknown): DescribeLaunch | null {
  if (typeof state !== 'object' || state === null) return null;
  const launch: unknown = (state as { describe?: unknown }).describe;
  if (typeof launch !== 'object' || launch === null) return null;
  const { mode, instruction } = launch as { mode?: unknown; instruction?: unknown };
  if (mode !== 'create' && mode !== 'edit') return null;
  if (typeof instruction !== 'string') return null;
  const trimmed = instruction.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_INSTRUCTION) return null;
  return { mode, instruction: trimmed };
}
