// Preview step (DESIGN-phase5.md section 7, phase 12 2.5): starts the app being designed in a preview child process on its own and
// mounts the real runtime renderer over it, in process (no iframe). Lazy-loaded: it pulls the renderer, which never reaches the first paint.
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { SpecApp } from '@local-app-studio/runtime/runtime';
import { PRO_PARTS } from '@/proParts.js';
import Modal from '@/components/shared/Modal.jsx';
import { PREVIEW_IMPORT_MAX_BODY } from '@local-app-studio/runtime/runtime/data/importModel.js';
import { btnPrimary, btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';
import CatchBoundary from '../errors/CatchBoundary';
import CanvasFrame from '../components/CanvasFrame';
import PreviewControls from '../components/PreviewControls';
import PreviewDataBanner, { SAMPLE_ADDED } from '../components/PreviewDataBanner';
import WayInOffer from '../components/WayInOffer';
import { HINT_CLASS } from '../components/ui';
import { useHelperDown } from '../hooks/useHelperDown';
import { useOptionalDescribeSession } from '../hooks/useDescribeSession';
import { usePreviewStatus } from '../hooks/usePreviewStatus';
import { useStepChrome } from '../hooks/useStepChrome';
import { useWorkspace } from '../hooks/useWorkspace';
import type { PreviewStatus } from '../types';
import { madeFromExampleNotice, readMadeFromExample, tryTheseLine } from '../lib/examples';
import { STEP_FOCUS, isStarterSpec, launchState, stepPath } from '../lib/steps';
import ThemeScope from '../theme/ThemeScope';
import { scopeStyle } from '../theme/scopeStyle';
import { useThemeEnv } from '../theme/themeEnv';
import { PortalScopeContext } from '@/components/shared/portalScope.js';
import { useViewMode } from '../theme/viewMode';

// The panel is a lazy chunk: it loads when Import rows is pressed.
const ImportPanel = lazy(() => import('@local-app-studio/runtime/runtime/data/ImportPanel.jsx'));
/** In Preview a file can have up to this many data rows (the preview app enforces it too). */
const PREVIEW_IMPORT_MAX_ROWS = 5000;

const IMPORT_LOAD_FAILED = 'The import could not load. Close this and press Import rows again.';
const MAX_CHARS = 2000;
const HELPER_DOWN = 'The helper is not set up. Change the design yourself, or set up the helper on Prompt.';
const HELPER_WORKING = 'The helper is still working on a design. Wait for it, or stop it on Prompt, before you ask for more changes.';
export const STARTER_CARD = 'Describe it on Prompt, or build a page in Design.';
export const STARTER_CARD_NO_HELPER = 'Build a page in Design.';
export const BUILD_A_PAGE = 'Build a page in Design';
export const HELPER_FAILED_NOTE = 'The helper could not answer last time. Ask for changes may work now, or change the design yourself.';
const DESIGN_WAITING = "The helper's design is waiting. Open Prompt and press Use this or Try again before you ask for more changes.";

export default function PreviewTab() {
  const { record, spec, revision } = useWorkspace();
  const appId = record.id;
  const navigate = useNavigate();
  const location = useLocation();
  const chrome = useStepChrome();
  const changeId = useId();
  const helperNoteId = useId();
  const { status, loading, error, busy, start, restart, stop, reset } = usePreviewStatus(appId, revision);
  const helperDown = useHelperDown();
  // Ask for changes starts a new run, which would throw away a design that waits or a run in progress.
  const session = useOptionalDescribeSession();
  const whyNoAsk = helperDown ? HELPER_DOWN : session?.phase === 'running' ? HELPER_WORKING : session?.phase === 'proposal' ? DESIGN_WAITING : null;
  const [change, setChange] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  /** True while the import runs: the dialog cannot be closed then. */
  const [importBusy, setImportBusy] = useState(false);
  /** Counts finished imports: the app below loads its records again. */
  const [imported, setImported] = useState(0);
  const importRef = useRef<HTMLButtonElement>(null);
  const view = useViewMode(appId, spec.theme);
  const designed = !isStarterSpec(spec);
  // A dialog the app opens portals to <body>, out of the theme scope: it carries the look itself (variables, color scheme, color,
  // font; never the page background), as the installed app shows it.
  const env = useThemeEnv();
  const portalScope = useMemo(() => {
    const { background, backgroundImage, ...style } = scopeStyle(spec.theme, view.mode, env);
    void background;
    void backgroundImage;
    return { style, mode: view.mode };
  }, [spec.theme, view.mode, env]);

  // Use this example lands here with a note in the router state. It is read once (the workspace may replace the state later) and
  // its text is set after the region has mounted, so it is read as a change, not skipped as first content.
  const [made] = useState(() => readMadeFromExample(location.state));
  const [madeText, setMadeText] = useState('');
  const [madeDismissed, setMadeDismissed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // The Dismiss row unmounts, which would drop focus to the page: move it to the first Preview control (or the card) first.
  const dismissMade = (): void => {
    const next = cardRef.current?.querySelector<HTMLElement>('button:not([disabled]):not([data-dismiss])');
    (next ?? cardRef.current)?.focus();
    setMadeDismissed(true);
  };
  useEffect(() => {
    if (made === null) return undefined;
    const timer = setTimeout(() => setMadeText(madeFromExampleNotice(made.name)), 0);
    return () => clearTimeout(timer);
  }, [made]);

  // Once per mount: a designed app starts its preview by itself unless it is already running or starting here. A later Stop stays stopped.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || status === null || error !== null || !designed) return;
    autoStarted.current = true;
    const activeHere = status.appId === appId && (status.state === 'running' || status.state === 'starting');
    if (!activeHere) void start();
  }, [status, error, designed, appId, start]);

  const showApp = status !== null && status.state === 'running' && status.appId === appId;
  const stale = showApp && status.revision !== revision;
  const trimmed = change.trim();

  // The app shows for the saved design: the rail may mark Preview done.
  const tried = showApp && !stale;
  const chromeRef = useRef(chrome);
  useEffect(() => {
    chromeRef.current = chrome;
  });
  useEffect(() => {
    if (tried) chromeRef.current.markDone('preview', revision);
  }, [tried, revision]);

  // The server clears the data of a failed preview but does not start it again, so from the failed state the start follows the reset.
  const failedHere = status !== null && status.appId === appId && status.state === 'failed';
  // Held from the reset until the start that follows it has answered, so the buttons do not flicker back on between the two.
  const [following, setFollowing] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const resetData = async (): Promise<PreviewStatus | null> => {
    const wasFailed = failedHere;
    if (wasFailed) setFollowing(true);
    try {
      const answer = await reset();
      // Start only if the person is still here, the answer is for this app, and the preview is not already on its way.
      const idle = answer !== null && (answer.appId === null || answer.appId === appId) && answer.state !== 'running' && answer.state !== 'starting';
      if (wasFailed && mountedRef.current && idle) await start();
      return answer;
    } finally {
      if (mountedRef.current) setFollowing(false);
    }
  };

  const askForChanges = (): void => {
    if (trimmed === '' || whyNoAsk !== null) return;
    navigate(stepPath(appId, 'prompt'), {
      state: launchState({ mode: 'edit', instruction: trimmed }),
    });
  };
  const goDesign = (): void => chrome.go(stepPath(appId, 'design'), { state: STEP_FOCUS });

  if (!designed) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
        <StudioSectionCard>
          <div className="space-y-3">
            <p className="text-sm text-slate-slate300">{PRO_PARTS.helper ? STARTER_CARD : STARTER_CARD_NO_HELPER}</p>
            <div className="flex flex-wrap gap-2">
              {PRO_PARTS.helper ? (
                <>
                  <Link to={stepPath(appId, 'prompt')} className={`${btnPrimary} no-underline`}>
                    Go to Prompt
                  </Link>
                  <button type="button" className={btnSecondary} onClick={goDesign}>
                    {BUILD_A_PAGE}
                  </button>
                </>
              ) : (
                <button type="button" className={btnPrimary} onClick={goDesign}>
                  {BUILD_A_PAGE}
                </button>
              )}
            </div>
          </div>
        </StudioSectionCard>
      </div>
    );
  }

  const runningHere = showApp;
  const canImport = runningHere && spec.tables.length > 0;
  const noteShown = made !== null && !madeDismissed;
  const firstSeeded = status !== null && status.appId === appId && status.data?.reason === 'first_start' && (status.data.seeded ?? 0) > 0;
  const madeLine = noteShown && madeText !== '' ? `${madeText}${firstSeeded ? ` ${SAMPLE_ADDED}` : ''}` : '';

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <StudioSectionCard>
        <div ref={cardRef} tabIndex={-1} className="space-y-4 focus-visible:outline-hidden">
          {/* Always present, so a text set after mount is read as a change; the ideas sit outside the live region. */}
          <p role="status" className="text-sm text-accent-green empty:m-0">
            {madeLine}
          </p>
          {noteShown && made !== null && (
            <div className="flex flex-wrap items-center gap-3">
              {made.tryThese.length > 0 && <p className={HINT_CLASS}>{tryTheseLine(made.tryThese)}</p>}
              <button type="button" data-dismiss="" className={btnSecondary} onClick={dismissMade}>
                Dismiss
              </button>
            </div>
          )}
          {error && status !== null && (
            <p role="alert" className="text-sm text-accent-red">
              {error}
            </p>
          )}
          {status === null && loading ? (
            <p className="text-sm text-slate-slate400">Checking the preview...</p>
          ) : (
            <PreviewControls
              status={status}
              appId={appId}
              busy={busy || following}
              onStart={() => void start()}
              onRestart={() => void restart()}
              onStop={() => void stop()}
              onReset={() => setResetOpen(true)}
            />
          )}
          {canImport && (
            <div>
              <button ref={importRef} type="button" className={btnSecondary} onClick={() => setImporting(true)}>
                Import rows
              </button>
            </div>
          )}
          <PreviewDataBanner
            status={status}
            appId={appId}
            busy={busy || following}
            onReset={resetData}
            showButton={runningHere}
            open={resetOpen}
            onOpenChange={setResetOpen}
            suppressNote={noteShown && firstSeeded}
          />
        </div>
      </StudioSectionCard>
      <WayInOffer />
      {importing && canImport && (
        <Modal title="Import rows" onClose={() => setImporting(false)} dismissible={!importBusy} finalFocusRef={importRef}>
          <CatchBoundary
            resetKey=""
            fallback={() => (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-accent-red">
                  {IMPORT_LOAD_FAILED}
                </p>
                <button type="button" className={btnSecondary} onClick={() => setImporting(false)}>
                  Close
                </button>
              </div>
            )}
          >
            <Suspense fallback={<p role="status" className="text-sm text-slate-slate400">Loading...</p>}>
              <ImportPanel spec={spec} apiBase="/api/preview" maxBytes={PREVIEW_IMPORT_MAX_BODY} maxRows={PREVIEW_IMPORT_MAX_ROWS} onDone={() => setImported((n) => n + 1)} onBusy={setImportBusy} />
            </Suspense>
          </CatchBoundary>
        </Modal>
      )}
      {showApp && (
        <CanvasFrame name={spec.app.name} mode={view.mode} onModeChange={view.setMode} layout="card" enlargeable>
          {stale ? (
            <p role="status" className="text-sm text-slate-slate400">
              Updating the preview with your latest changes...
            </p>
          ) : (
            <ThemeScope theme={spec.theme} mode={view.mode} className="flex-1" testId="preview-theme-scope">
              {/* The key carries startedAt: a Restart or Reset preview data starts a new child, and the app must load its records again. */}
              <PortalScopeContext.Provider value={portalScope}>
                <SpecApp key={`${status.revision ?? 0}:${status.startedAt ?? ''}:${imported}`} spec={spec} apiBase="/api/preview" basePath={`/apps/${appId}/preview`} />
              </PortalScopeContext.Provider>
            </ThemeScope>
          )}
        </CanvasFrame>
      )}
      <StudioSectionCard title="Change something">
        <div className="space-y-3">
          {PRO_PARTS.helper && (
            <div>
              <label htmlFor={changeId} className={labelClass}>
                What should change?
              </label>
              <textarea id={changeId} className={inputClass} rows={3} maxLength={MAX_CHARS} value={change} onChange={(e) => setChange(e.target.value)} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {PRO_PARTS.helper && (
              <button
                type="button"
                className={btnSecondary}
                onClick={askForChanges}
                disabled={trimmed === '' || whyNoAsk !== null}
                aria-describedby={whyNoAsk !== null ? helperNoteId : undefined}
              >
                Ask for changes
              </button>
            )}
            <button type="button" className={btnSecondary} onClick={goDesign}>
              Change the design yourself
            </button>
          </div>
          {whyNoAsk !== null && (
            <p id={helperNoteId} className={HINT_CLASS}>
              {whyNoAsk}
            </p>
          )}
          {whyNoAsk === null && session?.phase === 'error' && <p className={HINT_CLASS}>{HELPER_FAILED_NOTE}</p>}
        </div>
      </StudioSectionCard>
    </div>
  );
}
