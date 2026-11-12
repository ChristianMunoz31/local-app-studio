// Apps list: one-box start (DESIGN-phase5.md 3), import, blank app, open, duplicate, export, delete.
// Phase 12 (DESIGN-phase12.md 2.3): with the helper known to be down, Make my app makes no app and shows the setup card.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { PageSkeleton } from '@/components/shared/Skeleton.jsx';
import { btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import { PRO_PARTS } from '@/proParts.js';
import { EXAMPLES, loadExample } from '@/studio/examples';
import type { ExampleId, ExampleMeta } from '@/studio/examples';
import AppCard from '../components/AppCard';
import ExamplesCard from '../components/ExamplesCard';
import { HelpButton } from '../components/HelpSheet';
import HelperSetupCard from '../components/HelperSetupCard';
import ImportSpecButton from '../components/ImportSpecButton';
import DuplicateAppDialog from '../components/DuplicateAppDialog';
import HelperNotInBuild, { START_BLANK_INSTEAD } from '../components/HelperNotInBuild';
import NewAppDialog from '../components/NewAppDialog';
import StartBox from '../components/StartBox';
import StudioConfirm from '../components/StudioConfirm';
import { useApps } from '../hooks/useApps';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useHelperDown } from '../hooks/useHelperDown';
import { deriveAppName, uniqueAppName } from '../lib/appName';
import { markFresh, readRemovedApp, readStartWords, removedAppNotice, writePrompt, writeStartWords } from '../lib/appMemory';
import { EXPORT_FAILED, EXPORT_RECORDS_FAILED, defaultCopyName, duplicatedNotice, exportFileName, exportedNotice, exportedWithRecordsNotice } from '../lib/appFiles';
import { downloadBlob, downloadJson } from '../lib/download';
import { EMPTY_EXAMPLES_SUFFIX, EXAMPLE_FAILED, USE_EXAMPLE_BUSY, madeFromExampleState } from '../lib/examples';
import { STEP_FOCUS, launchState, startStep, stepPath } from '../lib/steps';
import { StudioApiError, exportWithRecords, getApp } from '../services/studioApi';
import type { AppSummary } from '../types';

const APPS_SUBTITLE = 'Open an app to change it, try it or make an installer.';
const APPS_SUBTITLE_NO_INSTALLER = 'Open an app to change it or try it.';
const CREATE = 'Create';
const EMPTY_APPS = `No apps yet. Press Create to describe one, or import an app file. ${EMPTY_EXAMPLES_SUFFIX}`;
const EMPTY_APPS_NO_HELPER = `No apps yet. Start a blank app, or import an app file. ${EMPTY_EXAMPLES_SUFFIX}`;
const HELPER_READY = 'The helper is ready. Press Make my app.';
const importedAs = (asked: string, given: string): string => `Imported "${asked}" as "${given}".`;
const nameOf = (spec: unknown): string | null => {
  if (typeof spec !== 'object' || spec === null || !('app' in spec)) return null;
  const app = spec.app;
  return typeof app === 'object' && app !== null && 'name' in app && typeof app.name === 'string' ? app.name : null;
};
/** An app file whose name another app has comes in under a free name ("Crew Roster 2"); the file itself is not changed. */
const nameApart = (spec: unknown, taken: readonly string[]): unknown => {
  const name = nameOf(spec);
  if (name === null || typeof spec !== 'object' || spec === null || !('app' in spec) || typeof spec.app !== 'object' || spec.app === null) return spec;
  const free = uniqueAppName(name, taken);
  return free === name ? spec : { ...spec, app: { ...spec.app, name: free } };
};

const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'Could not start a new app. Try again.');

export default function AppsPage() {
  useDocumentTitle('Apps, Local App Studio');
  const navigate = useNavigate();
  const location = useLocation();
  const { apps, loading, error, reload, create, duplicate, remove, importSpec } = useApps();
  const helperDown = useHelperDown();
  const [blankName, setBlankName] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  /** The description that waits for the helper: set while the setup card is shown under the box. */
  const [helperText, setHelperText] = useState<string | null>(null);
  const [helperReady, setHelperReady] = useState(false);
  const [deleting, setDeleting] = useState<AppSummary | null>(null);
  const [duplicating, setDuplicating] = useState<AppSummary | null>(null);
  const [actionError, setActionError] = useState('');
  /** The example being made. The ref closes the gap before the state shows: a second press in the same tick is ignored. */
  const [usingExample, setUsingExample] = useState<ExampleId | null>(null);
  const usingRef = useRef(false);
  /** A failed example, shown in its own alert line under the status region until the next action. */
  const [exampleProblem, setExampleProblem] = useState('');
  const exampleButtons = useRef(new Map<ExampleId, HTMLButtonElement>());
  const mountedRef = useRef(true);
  /** Leaving the page cancels the example's two downloads. */
  const exampleAbort = useRef(new AbortController());
  const focusFrame = useRef<number | null>(null);
  const appsRef = useRef(apps);
  useEffect(() => {
    appsRef.current = apps;
  });
  useEffect(() => {
    mountedRef.current = true;
    // A fresh controller per mount: a development double mount aborts the first one.
    const abort = new AbortController();
    exampleAbort.current = abort;
    return () => {
      mountedRef.current = false;
      abort.abort();
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  // The workspace removes an empty app whose first helper run failed and sends the person here: say it once, then clear the note.
  const removedApp = readRemovedApp(location.state);
  // The text is set after the region has mounted (the effect below), so it is read as a change, not skipped as first content.
  const [notice, setNotice] = useState('');
  const [removedNotice] = useState(() => (removedApp === null ? '' : removedAppNotice(removedApp)));
  useEffect(() => {
    if (removedNotice === '') return undefined;
    const timer = setTimeout(() => setNotice(removedNotice), 0);
    return () => clearTimeout(timer);
  }, [removedNotice]);
  const [startWords] = useState(readStartWords);
  // Saved start words open the box on load with the words in it (no focus move); otherwise Create opens it.
  const [startOpen, setStartOpen] = useState(() => PRO_PARTS.helper && startWords.trim() !== '');
  const [focusAsk, setFocusAsk] = useState(0);
  const createRef = useRef<HTMLButtonElement | null>(null);
  const createOpener = useRef<HTMLElement | null>(null);
  const startTextRef = useRef<HTMLTextAreaElement | null>(null);
  const startId = useId();
  useEffect(() => {
    if (focusAsk > 0) startTextRef.current?.focus();
  }, [focusAsk]);
  useEffect(() => {
    if (removedApp !== null) navigate(location.pathname, { replace: true, state: null });
  }, [removedApp, navigate, location.pathname]);
  const headingId = useId();
  const helperHeadingId = useId();
  const deleteOpener = useRef<HTMLElement | null>(null);
  const needsHelper = helperText !== null;

  useEffect(() => {
    if (needsHelper) document.getElementById(helperHeadingId)?.focus();
  }, [needsHelper, helperHeadingId]);

  const guard = async (action: () => Promise<void>, failure: string): Promise<void> => {
    setActionError('');
    setNotice('');
    setExampleProblem('');
    try {
      await action();
    } catch {
      setActionError(failure);
    }
  };

  const onExport = (app: AppSummary): Promise<void> =>
    guard(async () => {
      const record = await getApp(app.id);
      if (record.spec) {
        const file = exportFileName(record.name);
        downloadJson(file, record.spec);
        setNotice(exportedNotice(record.name, file));
      } else {
        downloadJson(`${record.slug}.raw.json`, record.raw ?? null);
      }
    }, EXPORT_FAILED);

  const onExportWithRecords = (app: AppSummary): Promise<void> => {
    setActionError('');
    setNotice('');
    setExampleProblem('');
    return (async () => {
      try {
        const blob = await exportWithRecords(app.id);
        const file = exportFileName(app.name, 'zip');
        downloadBlob(file, blob);
        setNotice(exportedWithRecordsNotice(app.name, file));
      } catch (err) {
        // The server's own sentence says to start the preview first; anything else is the general failure.
        setActionError(err instanceof StudioApiError && err.code === 'preview_not_running' ? err.message : EXPORT_RECORDS_FAILED);
      }
    })();
  };

  const onStart = async (text: string): Promise<void> => {
    setStartError('');
    setHelperReady(false);
    if (helperDown) {
      // no app is made for a description nobody can read: the card shows what to do, the text stays in the box
      setHelperText(text);
      return;
    }
    setStarting(true);
    try {
      const record = await create(
        deriveAppName(
          text,
          apps.map((a) => a.name),
        ),
      );
      // The words are kept with the app from here on; the revision marks it as untouched until something is saved.
      writePrompt(record.id, text);
      markFresh(record.id, record.revision);
      writeStartWords('');
      navigate(stepPath(record.id, 'prompt'), {
        state: launchState({ mode: 'create', instruction: text }),
      });
    } catch (err) {
      setStartError(messageOf(err));
      setStarting(false);
    }
  };

  const onCreate = (e: MouseEvent<HTMLButtonElement>): void => {
    if (!PRO_PARTS.helper) {
      setBlankName('');
      return;
    }
    createOpener.current = e.currentTarget;
    setStartOpen(true);
    setFocusAsk((n) => n + 1);
  };

  const onCancelStart = (): void => {
    setStartOpen(false);
    setHelperText(null);
    setHelperReady(false);
    setStartError('');
    const opener = createOpener.current;
    (opener !== null && opener.isConnected ? opener : createRef.current)?.focus();
  };

  const onUseExample = async (meta: ExampleMeta): Promise<void> => {
    if (usingRef.current) return;
    usingRef.current = true;
    setUsingExample(meta.id);
    setExampleProblem('');
    setActionError('');
    setNotice(USE_EXAMPLE_BUSY);
    try {
      const { spec, records } = await loadExample(meta.id, exampleAbort.current.signal);
      const record = await importSpec(
        nameApart(
          spec,
          appsRef.current.map((a) => a.name),
        ),
        records,
      );
      if (!mountedRef.current) return;
      navigate(stepPath(record.id, 'preview'), {
        state: {
          ...STEP_FOCUS,
          ...madeFromExampleState(record.name, meta.tryThese),
        },
      });
    } catch (err) {
      usingRef.current = false;
      if (!mountedRef.current) return;
      setNotice('');
      setExampleProblem(err instanceof StudioApiError && err.code === 'too_many_apps' ? err.message : EXAMPLE_FAILED);
      setUsingExample(null);
      // The button is only aria-disabled while busy, so it keeps focus; this puts it back only if focus was lost (body or nowhere).
      const button = exampleButtons.current.get(meta.id);
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        const active = document.activeElement;
        if (active === null || active === document.body) button?.focus();
      });
    }
  };

  const setExampleButton = useCallback((id: ExampleId, el: HTMLButtonElement | null): void => {
    if (el === null) exampleButtons.current.delete(id);
    else exampleButtons.current.set(id, el);
  }, []);
  const exampleBusy = usingExample !== null;
  const empty = !error && apps.length === 0;

  // One tree for loading and loaded: the status region keeps its place (the slots around it switch between content and `false`),
  // so it is never remounted and a notice set after mount is read as a change.
  return (
    <div className={loading ? undefined : 'mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6'}>
      {!loading && !PRO_PARTS.helper && <HelperNotInBuild label="Start" actionLabel={START_BLANK_INSTEAD} onAction={() => setBlankName('')} />}
      {/* The helper-ready line and the page notices share this one region; only its text changes. Empty, it takes no room. */}
      <p role="status" className="text-sm text-accent-green empty:m-0">
        {helperReady ? HELPER_READY : notice}
      </p>
      {exampleProblem !== '' && (
        <p role="alert" className="text-sm text-accent-red">
          {exampleProblem}
        </p>
      )}
      {loading ? <PageSkeleton /> : false}
      {loading ? (
        false
      ) : (
        <>
          {PRO_PARTS.helper && startOpen && (
            <StartBox
              id={startId}
              textRef={startTextRef}
              busy={starting}
              error={startError}
              initialText={startWords}
              onStart={(text) => void onStart(text)}
              onCancel={onCancelStart}
            />
          )}
          {needsHelper && (
            <HelperSetupCard
              headingId={helperHeadingId}
              onReady={() => {
                setHelperText(null);
                setHelperReady(true);
              }}
              onSkip={() =>
                setBlankName(
                  deriveAppName(
                    helperText ?? '',
                    apps.map((a) => a.name),
                  ),
                )
              }
              skipLabel="Start a blank app instead"
            />
          )}
          <section aria-labelledby={headingId} className="relative z-10">
            <StudioSectionCard
              title="Apps"
              headingId={headingId}
              icon={LayoutGrid}
              subtitle={PRO_PARTS.installer ? APPS_SUBTITLE : APPS_SUBTITLE_NO_INSTALLER}
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" ref={createRef} className={btnPrimary} onClick={onCreate} disabled={exampleBusy}>
                    {CREATE}
                  </button>
                  <ImportSpecButton
                    disabled={exampleBusy}
                    onError={setActionError}
                    onStart={() => {
                      setNotice('');
                      setExampleProblem('');
                    }}
                    onImport={async (spec) => {
                      if (usingRef.current) return;
                      const record = await importSpec(
                        nameApart(
                          spec,
                          appsRef.current.map((a) => a.name),
                        ),
                      );
                      const asked = nameOf(spec);
                      setNotice(asked !== null && asked !== record.name ? importedAs(asked, record.name) : `Imported "${record.name}".`);
                    }}
                  />
                  {!empty && (
                    <button type="button" className={btnSecondary} onClick={() => setBlankName('')} disabled={exampleBusy}>
                      Blank app
                    </button>
                  )}
                  <HelpButton />
                </div>
              }
            >
              {error && (
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <p role="alert" className={formErrorClass}>
                    {error}
                  </p>
                  <button type="button" className={btnSecondary} onClick={() => void reload()}>
                    Try again
                  </button>
                </div>
              )}
              {actionError && (
                <p role="alert" className={`${formErrorClass} mb-2`}>
                  {actionError}
                </p>
              )}
              {empty ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-slate-slate300">{PRO_PARTS.helper ? EMPTY_APPS : EMPTY_APPS_NO_HELPER}</p>
                  <button type="button" className={btnPrimary} onClick={onCreate} disabled={exampleBusy}>
                    {CREATE}
                  </button>
                  <button type="button" className={btnSecondary} onClick={() => setBlankName('')} disabled={exampleBusy}>
                    Blank app
                  </button>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {apps.map((app) => (
                    <AppCard
                      key={app.id}
                      app={app}
                      onChangeLook={() => {
                        if (usingRef.current) return;
                        navigate(stepPath(app.id, 'design'), {
                          state: { ...STEP_FOCUS, shelfTab: 'look' },
                        });
                      }}
                      onDuplicate={() => {
                        if (usingRef.current) return;
                        setActionError('');
                        setNotice('');
                        setExampleProblem('');
                        setDuplicating(app);
                      }}
                      onExport={() => void onExport(app)}
                      onExportWithRecords={() => void onExportWithRecords(app)}
                      onDelete={(trigger) => {
                        if (usingRef.current) return;
                        deleteOpener.current = trigger;
                        setDeleting(app);
                      }}
                    />
                  ))}
                </ul>
              )}
            </StudioSectionCard>
          </section>
          <ExamplesCard examples={EXAMPLES} busyId={usingExample} onUse={(meta) => void onUseExample(meta)} buttonRef={setExampleButton} />
          {blankName !== null && (
            <NewAppDialog
              initialName={blankName}
              onCancel={() => setBlankName(null)}
              onCreate={async (name) => {
                const record = await create(name);
                navigate(stepPath(record.id, startStep()), {
                  state: STEP_FOCUS,
                });
              }}
            />
          )}
          {duplicating && (
            <DuplicateAppDialog
              sourceName={duplicating.name}
              initialName={uniqueAppName(
                defaultCopyName(duplicating.name),
                apps.map((a) => a.name),
              )}
              withSample={duplicating.sample === true}
              onCancel={() => setDuplicating(null)}
              onDuplicate={async (name, withRecords) => {
                const record = await duplicate(duplicating.id, name, withRecords);
                setNotice(duplicatedNotice(duplicating.name, record.name, duplicating.sample === true, withRecords, record.recordsCopied));
                setDuplicating(null);
              }}
            />
          )}
          {deleting && (
            <StudioConfirm
              title={`Delete ${deleting.name}?`}
              message="Its design and build history are removed from Local App Studio. Apps you already installed are not affected."
              confirmLabel="Delete app"
              busyLabel="Deleting..."
              cancelLabel="Keep app"
              finalFocusRef={deleteOpener}
              onConfirm={async () => {
                await remove(deleting.id);
                // the trigger is gone with its card, so the dialog hands focus to the page heading
                deleteOpener.current = document.getElementById(headingId);
                setDeleting(null);
              }}
              onCancel={() => setDeleting(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
