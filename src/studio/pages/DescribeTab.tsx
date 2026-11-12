// Prompt step (DESIGN-phase16.md 1.3): write the first prompt on the left, check what the helper made on the right (ReviewPane). A
// saved app shows its first prompt as read-only words on the left: the only box to ask for a change in is the right pane's
// (DESIGN-phase17.md P17-05). The run lives in the workspace (useDescribeSession), so moving between steps keeps it. A launch
// from the Apps page, the Preview step or the Design page strip arrives as router state and runs once.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { PRO_PARTS } from '@/proParts.js';
import { btnPrimary, btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { useOllamaSetup } from '@/hooks/useOllamaSetup.js';
import HelperNotInBuild, { BUILD_IT_YOURSELF } from '../components/HelperNotInBuild';
import HelperSetupCard from '../components/HelperSetupCard';
import ReviewPane from '../components/ReviewPane';
import { FOCUS_RING, HINT_CLASS, TEXT_BUTTON } from '../components/ui';
import { useDescribeSession } from '../hooks/useDescribeSession';
import { useStepChrome } from '../hooks/useStepChrome';
import { useWorkspace } from '../hooks/useWorkspace';
import { buildYourselfLabel, buildYourselfStep } from '../lib/buildYourself';
import { readPrompt, writePrompt } from '../lib/appMemory';
import { isStarterSpec, readLaunch, stepPath, type DescribeLaunch } from '../lib/steps';

const MAX_CHARS = 2000;
export const FIRST_PROMPT_LABEL = 'Your first prompt';
export const NO_FIRST_PROMPT = 'There is no first prompt for this app. Ask for a change in the box on the right.';
const AI_SETUP_CODES = new Set(['ai_not_configured', 'ollama_unavailable']);

type Mode = 'create' | 'edit';

/** A build without the helper (docs/ARCHITECTURE.md, 'The pro seam'): one line and the way to Design. */
function PromptWithoutHelper() {
  const { record } = useWorkspace();
  const { go } = useStepChrome();
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <section aria-label="Prompt">
        <HelperNotInBuild actionLabel={BUILD_IT_YOURSELF} onAction={() => go(stepPath(record.id, 'design'))} />
      </section>
    </div>
  );
}

export default function DescribeTab() {
  return PRO_PARTS.helper ? <PromptWithHelper /> : <PromptWithoutHelper />;
}

function PromptWithHelper() {
  const { spec, record } = useWorkspace();
  const describe = useDescribeSession();
  const { go } = useStepChrome();
  const { setup, isLoading: setupLoading } = useOllamaSetup();
  const location = useLocation();
  const navigate = useNavigate();
  const textId = useId();
  const countId = useId();
  const firstId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const startOverRef = useRef<HTMLButtonElement>(null);
  // Set when Cancel is pressed: the Cancel button unmounts once the run stops, so the cursor goes to the box that takes its place.
  const cancelFocus = useRef(false);
  // Where the cursor goes after the left pane flips mode: the box (a new prompt) or the review pane's heading (a saved app).
  const focusBox = useRef(false);
  const [headingToken, setHeadingToken] = useState(0);
  const [modeOverride, setModeOverride] = useState<Mode | null>(describe.mode);
  // The first prompt is kept per app in browser storage, so a reload or coming back to Prompt finds it again. The words of an edit
  // run are an ask, not the first prompt: they never go into this box or this storage.
  // Another window's first prompt comes with the app (Use this keeps it on the server); it is shown, not written to this storage.
  const kept = (): string => readPrompt(record.id) || (record.firstPrompt ?? '');
  const [instruction, setInstructionState] = useState(() => (describe.mode === 'edit' ? kept() : (describe.instruction ?? kept())));
  const setInstruction = useCallback(
    (text: string): void => {
      setInstructionState(text);
      writePrompt(record.id, text);
    },
    [record.id],
  );

  const designed = !isStarterSpec(spec);
  const mode: Mode = modeOverride ?? (designed ? 'edit' : 'create');
  const running = describe.phase === 'running';
  const trimmed = instruction.trim();
  const helperDown = setup !== null && !setup.ready;
  // A failed change to a waiting design shows the design again with the reason; a helper that is not set up still shows its card.
  const errored = describe.phase === 'error' || (describe.phase === 'proposal' && describe.lastAsk !== null);
  const errorCode = errored ? (describe.error?.code ?? null) : null;
  const setupError = errorCode !== null && AI_SETUP_CODES.has(errorCode) ? describe.error : null;
  const toDesign = (): void => go(stepPath(record.id, buildYourselfStep(spec)));

  // The launch is consumed once per navigation, only after the helper state is known, and cleared from history before it runs
  // so a reload never runs it again. The timer lets StrictMode's simulated unmount cancel it before anything starts.
  // Two phases: the router applies the cleared location as a low priority transition, so the launch is parked in a ref and
  // only runs once that location has rendered. Otherwise the stream's urgent updates can render ahead of it.
  const consumedKey = useRef<string | null>(null);
  const pendingLaunch = useRef<DescribeLaunch | null>(null);
  const { run } = describe;
  useEffect(() => {
    const launch = readLaunch(location.state);
    if (launch === null) {
      const parked = pendingLaunch.current;
      if (parked === null) return undefined;
      pendingLaunch.current = null;
      if (parked.mode === 'create') setInstruction(parked.instruction);
      setModeOverride(parked.mode);
      if (!helperDown) run(parked.mode, parked.instruction);
      return undefined;
    }
    if (setupLoading || consumedKey.current === location.key) return undefined;
    const timer = setTimeout(() => {
      consumedKey.current = location.key;
      pendingLaunch.current = launch;
      navigate(location.pathname, { replace: true, state: null });
    }, 0);
    return () => clearTimeout(timer);
  }, [location.key, location.pathname, location.state, setupLoading, helperDown, navigate, run, setInstruction]);

  // The server keeps the first prompt with a waiting design. Once, when it has been asked for: the mode of that design is the mode here,
  // and its words fill the box when the box has none, and are written to browser storage at once so a reload finds them.
  const { hydrated, instruction: storedWords, mode: storedMode } = describe;
  const [adopted, setAdopted] = useState(false);
  if (hydrated && !adopted) {
    setAdopted(true);
    if (storedMode !== null && modeOverride === null) setModeOverride(storedMode);
    if (storedMode === 'create' && storedWords !== null && storedWords.trim() !== '' && instruction.trim() === '') setInstruction(storedWords);
  }

  useEffect(() => {
    if (!focusBox.current || mode !== 'create') return;
    focusBox.current = false;
    textRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (running || !cancelFocus.current) return;
    cancelFocus.current = false;
    (mode === 'create' ? textRef.current : startOverRef.current)?.focus();
  }, [running, mode]);

  const cancelRun = (): void => {
    cancelFocus.current = true;
    describe.cancel();
  };
  const waiting = describe.phase === 'proposal';
  // What happens to a design that waits is said when the new one lands (useDescribeSession), not when the run starts.
  const send = (): void => describe.run('create', trimmed);
  const startOver = (): void => {
    // The waiting design goes too (the server's copy as well), as the box says: the new prompt starts clean.
    describe.discard();
    setModeOverride('create');
    focusBox.current = true;
  };
  const changeInstead = (): void => {
    setModeOverride('edit');
    setHeadingToken((n) => n + 1);
  };

  const current = [...describe.progress].reverse().find((p) => p.status === 'running') ?? describe.progress[describe.progress.length - 1];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      {(helperDown || setupError !== null) && (
        <HelperSetupCard
          serverMessage={setupError?.message ?? null}
          onReady={() => {
            if (describe.phase === 'error') describe.discard({ keepInstruction: true });
          }}
          onSkip={toDesign}
        />
      )}

      {/* One region that stays on the page; only its text changes, so each new step of the run is read. */}
      <p role="status" className="sr-only">
        {running && current !== undefined ? `Working on: ${current.message || 'Working on your app'}` : ''}
      </p>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section aria-label="Prompt">
          <StudioSectionCard
            title={mode === 'create' ? 'Write your prompt' : 'Change your app'}
            subtitle={
              mode === 'create'
                ? 'Say it in plain words. You check the design before it is used.'
                : 'Ask for a change in the box on the right. You check the design before it is used.'
            }
          >
            {mode === 'create' ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor={textId} className={labelClass}>
                    Your prompt
                  </label>
                  <textarea
                    id={textId}
                    ref={textRef}
                    className={inputClass}
                    rows={5}
                    maxLength={MAX_CHARS}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    aria-describedby={countId}
                    disabled={running}
                  />
                  <p id={countId} className="mt-1 text-xs text-slate-slate400 tabular-nums">{`${instruction.length} of ${MAX_CHARS}`}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* While the helper runs the button is aria-disabled, not disabled: the pressed button keeps focus. */}
                  <button
                    type="button"
                    className={`${helperDown || waiting ? btnSecondary : btnPrimary}${running ? ' cursor-not-allowed opacity-50' : ''}`}
                    onClick={() => !running && send()}
                    disabled={trimmed === '' || helperDown}
                    aria-disabled={running ? true : undefined}
                  >
                    Make my app
                  </button>
                  {running && (
                    <button type="button" className={btnSecondary} onClick={cancelRun}>
                      Cancel
                    </button>
                  )}
                </div>
                {designed && (
                  <div>
                    <button type="button" className={TEXT_BUTTON} onClick={changeInstead} disabled={running}>
                      Change this app instead
                    </button>
                  </div>
                )}
                <p className={HINT_CLASS}>The helper runs on this computer. Nothing changes until you press Use this.</p>
                <div>
                  <button type="button" className={TEXT_BUTTON} onClick={toDesign}>
                    {buildYourselfLabel(spec, true)}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p id={firstId} className={labelClass}>
                    {FIRST_PROMPT_LABEL}
                  </p>
                  {/* Long words scroll inside their own box, which the keyboard can reach. */}
                  <div
                    role="group"
                    aria-labelledby={firstId}
                    tabIndex={0}
                    className={`max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-slate200 ${FOCUS_RING}`}
                  >
                    {trimmed === '' ? NO_FIRST_PROMPT : instruction}
                  </div>
                </div>
                {running && (
                  <button type="button" className={btnSecondary} onClick={cancelRun}>
                    Cancel
                  </button>
                )}
                <div>
                  <button type="button" ref={startOverRef} className={TEXT_BUTTON} onClick={startOver} disabled={running}>
                    Start over with a new prompt
                  </button>
                </div>
                <p className={HINT_CLASS}>The helper runs on this computer. Nothing changes until you press Use this.</p>
              </div>
            )}
          </StudioSectionCard>
        </section>
        <ReviewPane
          mode={mode}
          helperDown={helperDown}
          setupError={setupError !== null}
          onFocusPrompt={() => textRef.current?.focus()}
          headingFocusToken={headingToken}
        />
      </div>
    </div>
  );
}
