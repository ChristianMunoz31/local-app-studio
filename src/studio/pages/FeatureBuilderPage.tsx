// The Feature builder: a screen where a reusable feature is composed without an app, on the same Design canvas, over a bench (a small app
// in memory that stands for the feature). A thin host over src/studio/design: this page owns the slot panel, the save and Try it in an app,
// and the session owns the canvas, the shelf, drag and drop, Undo and the draft kept in this browser (DESIGN-phase16.md section 4).
import { ArrowLeft, Puzzle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CatalogDataSource } from '@/catalog/context';
import type { FeatureLibrary } from '@/catalog/features';
import { Skeleton } from '@/components/shared/Skeleton.jsx';
import { btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { LiveAnnouncer } from '../components/LiveAnnouncer';
import { HINT_CLASS } from '../components/ui';
import DesignSession from '../design/DesignSession';
import type { DesignHost, HostDoc, HostEdit } from '../design/DesignSession';
import { SAMPLE_TABLES, benchFromFeature, builderHidesEntry, emptyBench, renameBenchField, renameTableSlot, sampleOf, switchSample } from '../builder/bench';
import type { BenchStart, PanelState, SampleId } from '../builder/bench';
import BuilderSaveDialog from '../builder/BuilderSaveDialog';
import FeatureRenameDialog from '../builder/FeatureRenameDialog';
import { refusalWords } from '../builder/featureRefusal';
import SlotPanel from '../builder/SlotPanel';
import SlotTableDialog from '../builder/SlotTableDialog';
import { builderSlots, settingCount } from '../builder/slotModel';
import { BUILDER_WORDS, FIELD_SLOT_WORDS, RENAME_WORDS, SAVE_WORDS } from '../builder/words';
import { clearDraft } from '../lib/draftStore';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useFeatures } from '../hooks/useFeatures';
import { StepChromeContext } from '../hooks/useStepChrome';
import type { SaveOutcome, StepChrome, StepDraft } from '../hooks/useStepChrome';
import UseInAppDialog from '../showcase/UseInAppDialog';
import { buildShowcaseEntries } from '../showcase/entries';
import type { ShowcaseEntry } from '../showcase/entries';
import type { FeatureInput, FeatureRecord, SaveResult } from '../types';


const noop = (): void => undefined;
const OFF = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((k) => b.has(k));
/** True when the ticks and labels are the same. */
function samePanel(a: PanelState, b: PanelState): boolean {
  const ka = Object.keys(a.labels);
  return sameSet(a.textOn, b.textOn) && ka.length === Object.keys(b.labels).length && ka.every((k) => a.labels[k] === b.labels[k]);
}
/** The save of the workspace is never called in the builder: the host ends every save. */
const unusedSave = async (): Promise<SaveResult> => ({ ok: false, code: 'error', message: 'Not used.', issues: [] });
const NO_SOURCE = undefined as CatalogDataSource | undefined;

/** The router state `{ builderStart }` of Save as feature, read defensively. */
function startInputOf(state: unknown): FeatureInput | null {
  if (typeof state !== 'object' || state === null || !('builderStart' in state)) return null;
  const input = (state as { builderStart: unknown }).builderStart;
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Partial<FeatureInput>;
  const ok = typeof o.id === 'string' && typeof o.label === 'string' && typeof o.description === 'string' && Array.isArray(o.params) && Array.isArray(o.bindings) && typeof o.fragment === 'object' && o.fragment !== null;
  return ok ? (input as FeatureInput) : null;
}

const inputOfRecord = (r: FeatureRecord): FeatureInput | null =>
  r.fragment === null ? null : { id: r.id, label: r.label, description: r.description, params: r.params, fragment: r.fragment, bindings: r.bindings };

function Frame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-screen-2xl space-y-3 p-4 sm:p-6">{children}</div>;
}

function BackLink({ unsaved }: { unsaved: boolean }) {
  return (
    <Link
      to="/features"
      onClick={(e) => {
        // Words ticked or renamed in the panel are not in the draft kept in this browser: leaving loses them unless the person says so.
        if (unsaved && !window.confirm(BUILDER_WORDS.leaveUnsaved)) e.preventDefault();
      }}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-slate200 underline underline-offset-2 hover:text-slate-slate100"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      {BUILDER_WORDS.back}
    </Link>
  );
}

interface RenameProps {
  record: FeatureRecord;
  library: FeatureLibrary;
  reload(): Promise<void>;
}

function CannotOpen({ words, rename }: { words: string; rename?: RenameProps }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useDocumentTitle('Features, Local App Studio');
  const stored = rename === undefined ? null : inputOfRecord(rename.record);
  return (
    <Frame>
      <div className="glass space-y-3 rounded-2xl p-5">
        <p role="alert" className={formErrorClass}>
          {words}
        </p>
        {saved !== null && (
          <p role="status" className="text-sm text-slate-slate100">
            {BUILDER_WORDS.saved(saved)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={() => navigate('/features')}>
            {BUILDER_WORDS.backToFeatures}
          </button>
          {rename !== undefined && stored !== null && (
            <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
              {RENAME_WORDS.open}
            </button>
          )}
        </div>
      </div>
      {open && rename !== undefined && stored !== null && (
        <FeatureRenameDialog
          stored={stored}
          version={rename.record.version}
          library={rename.library}
          onCancel={() => setOpen(false)}
          onSaved={(record) => {
            setOpen(false);
            setSaved(record.label);
            void rename.reload();
          }}
        />
      )}
    </Frame>
  );
}

interface ScreenProps {
  start: BenchStart;
  /** The saved feature being edited, or null for a new one. */
  initial: FeatureRecord | null;
  features: readonly FeatureRecord[];
  library: FeatureLibrary;
  reload(): Promise<void>;
}

interface DialogIntent {
  lead?: string;
  then: 'none' | 'use';
}

function BuilderScreen({ start, initial, features, library, reload }: ScreenProps) {
  const navigate = useNavigate();
  const announcer = useAnnouncer();
  const { announce } = announcer;
  const spec: AppSpec = start.spec;
  const page = spec.pages[0];

  const [saved, setSaved] = useState<FeatureRecord | null>(initial);
  // The newer of the list entry and the record this screen saved: a list that is stale (or failed to reload) never sends an old version.
  const listed = saved === null ? undefined : features.find((f) => f.id === saved.id);
  const editing = saved === null ? null : listed !== undefined && listed.version >= saved.version ? listed : saved;
  const editingId = editing?.id ?? null;
  useDocumentTitle(editing === null ? BUILDER_WORDS.documentNew : BUILDER_WORDS.documentEdit(editing.label));

  const [doc, setDoc] = useState<HostDoc | null>(null);
  const [panel, setPanel] = useState<PanelState>({ textOn: start.state.textOn, labels: start.state.labels });
  // The panel as last saved: ticks and labels are not in the canvas history, so a difference from this is unsaved work too.
  const [savedPanel, setSavedPanel] = useState<PanelState>(panel);
  const panelDirty = !samePanel(panel, savedPanel);
  // The view mode and the shelf fold keep one key for the life of the screen (the first save must not move them). The draft is kept
  // under the feature once it has a record, so edits after the first save are offered back on its edit address, never on New feature.
  const [appId] = useState(() => (initial === null ? 'builder-new' : `builder-${initial.id}`));
  const draftKey = saved === null ? 'builder-new' : `builder-${saved.id}`;
  const [goEdit, setGoEdit] = useState<string | null>(null);
  const went = useRef(false);
  // Moves the address to the edit address once the list holds the new record (a failed reload leaves the person where they are).
  useEffect(() => {
    if (goEdit === null || went.current || !features.some((f) => f.id === goEdit)) return;
    went.current = true;
    navigate(`/features/${goEdit}/edit`, { replace: true });
  }, [goEdit, features, navigate]);
  const [draft, setDraft] = useState<StepDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<DialogIntent | null>(null);
  const [using, setUsing] = useState<ShowcaseEntry | null>(null);
  const [notice, setNotice] = useState<{ name: string } | null>(null);
  const [problem, setProblem] = useState('');
  const editRef = useRef<HostEdit | null>(null);
  const resolver = useRef<((outcome: SaveOutcome) => void) | null>(null);
  const intent = useRef<DialogIntent>({ then: 'none' });

  const onDoc = useCallback((next: HostDoc): void => setDoc(next), []);
  const bindEdit = useCallback((edit: HostEdit | null): void => {
    editRef.current = edit;
  }, []);
  const onDraft = useCallback((next: StepDraft | null): void => setDraft(next), []);

  // Unsaved work is kept in this browser by the session; leaving the tab while it is not saved asks first.
  useEffect(() => {
    if (!dirty && !panelDirty) return;
    const guard = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, panelDirty]);

  // A save that is waiting for the dialog never stays open when the screen goes.
  useEffect(
    () => () => {
      resolver.current?.({ ok: false, cancelled: true });
      resolver.current = null;
    },
    [],
  );

  const chrome = useMemo<StepChrome>(
    () => ({ setDraft: noop, go: (to, opts) => navigate(to, opts?.state === undefined ? undefined : { state: opts.state }), announce, markDone: noop }),
    [navigate, announce],
  );

  /** The host save: the dialog asks for a name and one line, and the session is clean once it saved. */
  const hostSave = useCallback((): Promise<SaveOutcome> => {
    resolver.current?.({ ok: false, cancelled: true });
    return new Promise<SaveOutcome>((resolve) => {
      resolver.current = resolve;
      setDialog(intent.current);
      intent.current = { then: 'none' };
    });
  }, []);

  const hidesEntry = useCallback((key: string): boolean => builderHidesEntry(key, editingId, library), [editingId, library]);

  const edit = (make: Parameters<HostEdit>[0], label: string): void => {
    const refusal = editRef.current?.(make, label) ?? null;
    setProblem(refusal ?? '');
  };

  const needsSlots = draft !== null && draft.saveBlocked !== null;
  const blocked = refusalWords('feature_needs_slots');
  const blockedLine = `${blocked.sentence} ${blocked.action}`;
  const slots = useMemo(() => (doc === null ? [] : builderSlots(doc, spec, library, panel)), [doc, spec, library, panel]);
  const count = doc === null ? 0 : settingCount(doc, library, panel);

  const entryOf = (record: FeatureRecord): ShowcaseEntry | undefined => buildShowcaseEntries([record]).find((e) => e.key === `feature:${record.id}`);

  const saveClicked = (): void => {
    if (draft === null) return;
    intent.current = { then: 'none' };
    void draft.save();
  };

  const tryClicked = (): void => {
    if (draft === null) return;
    const clean = !draft.isDirty() && !panelDirty;
    const entry = editing !== null && editing.ok && clean ? entryOf(editing) : undefined;
    if (entry !== undefined) {
      setUsing(entry);
      return;
    }
    intent.current = { lead: SAVE_WORDS.tryFirst, then: 'use' };
    void draft.save();
  };

  const finishSave = (record: FeatureRecord): void => {
    const next = dialog;
    setDialog(null);
    const isNew = editing === null;
    setSaved(record);
    setSavedPanel(panel);
    resolver.current?.({ ok: true });
    resolver.current = null;
    // The work is saved: the draft kept under the new-feature key must not be offered again (Restore then save would make a copy).
    if (isNew) clearDraft(appId, 'design');
    setNotice({ name: record.label });
    announce(BUILDER_WORDS.saved(record.label));
    // The effect above moves the address only while the person is still here and only when the list holds the record.
    if (isNew) setGoEdit(record.id);
    void reload();
    if (next?.then === 'use') {
      const entry = entryOf(record);
      if (entry !== undefined) setUsing(entry);
    }
  };

  const cancelSave = (): void => {
    setDialog(null);
    resolver.current?.({ ok: false, cancelled: true });
    resolver.current = null;
  };

  const saveOff = draft === null || needsSlots || dialog !== null;
  const toolbarEnd = (
    <div className="flex flex-wrap items-center gap-3">
      {needsSlots && (
        <span id="builder-save-hint" className={`max-w-xs ${HINT_CLASS}`}>
          {blockedLine}
        </span>
      )}
      <button type="button" className={btnSecondary} onClick={tryClicked} disabled={draft === null}>
        {BUILDER_WORDS.tryIt}
      </button>
      {/* aria-disabled, not disabled: the reason after the button stays reachable and the button keeps focus. */}
      <button
        type="button"
        className={`${btnPrimary} ${OFF}`}
        onClick={() => {
          if (!saveOff) saveClicked();
        }}
        aria-disabled={saveOff ? true : undefined}
        aria-describedby={needsSlots ? 'builder-save-hint' : undefined}
      >
        {BUILDER_WORDS.save}
      </button>
    </div>
  );

  const sampleLabel = (tableId: string, label: string): string => {
    const table = doc?.tables.find((t) => t.id === tableId);
    const sample = table === undefined ? null : sampleOf(table);
    return sample === null ? label : SAMPLE_TABLES[sample].label;
  };

  const aside = (
    <SlotPanel
      slots={slots}
      count={count}
      onRenameTable={(tableId, label) => edit((d) => renameTableSlot(d, tableId, label), BUILDER_WORDS.renamedSlot)}
      onSample={(tableId: string, to: SampleId) => {
        const from = sampleLabel(tableId, doc?.tables.find((t) => t.id === tableId)?.label ?? '');
        edit((d) => switchSample(d, tableId, to), BUILDER_WORDS.switched(from, SAMPLE_TABLES[to].label));
      }}
      onRenameField={(tableId, fieldId, label) => edit((d) => renameBenchField(d, tableId, fieldId, label), BUILDER_WORDS.renamedField)}
      onLabel={(key, label) => setPanel((p) => ({ ...p, labels: { ...p.labels, [key]: label } }))}
      onTick={(key, on) =>
        setPanel((p) => {
          const textOn = new Set(p.textOn);
          if (on) textOn.add(key);
          else textOn.delete(key);
          return { ...p, textOn };
        })
      }
    />
  );

  const host: DesignHost = {
    kind: 'feature',
    toolbarEnd,
    aside,
    NewTableDialog: SlotTableDialog,
    addFieldWords: { title: FIELD_SLOT_WORDS.title, submit: FIELD_SLOT_WORDS.submit },
    hidesEntry,
    blockedWords: blockedLine,
    save: hostSave,
    bindEdit,
    onDoc,
  };

  return (
    <StepChromeContext.Provider value={chrome}>
      <Frame>
        <LiveAnnouncer text={announcer.text} n={announcer.n} />
        <div className="space-y-1">
          <BackLink unsaved={panelDirty} />
          <div className="flex items-center gap-2">
            <Puzzle size={18} className="text-slate-slate400" aria-hidden="true" />
            <h1 className="text-lg font-bold tracking-tight text-slate-slate100">{editing === null ? BUILDER_WORDS.newTitle : BUILDER_WORDS.editTitle(editing.label)}</h1>
          </div>
          <p className="text-sm text-slate-slate400">{BUILDER_WORDS.subtitle}</p>
        </div>
        {notice !== null && (
          <div role="status" aria-live="off" className="flex flex-wrap items-center gap-3 rounded-md bg-slate-slate700/50 px-3 py-2 text-sm text-slate-slate100">
            <span>{BUILDER_WORDS.saved(notice.name)}</span>
            <button type="button" className={btnSecondary} onClick={tryClicked}>
              {BUILDER_WORDS.tryIt}
            </button>
          </div>
        )}
        {problem !== '' && (
          <p role="alert" className={formErrorClass}>
            {problem}
          </p>
        )}
        <div className="glass rounded-2xl">
          <DesignSession
            spec={spec}
            revision={0}
            page={page}
            pageIndex={0}
            appId={appId}
            draftKey={draftKey}
            onShowPage={noop}
            features={features}
            library={library}
            reloadFeatures={reload}
            liveSource={NO_SOURCE}
            onDirty={setDirty}
            onDraft={onDraft}
            onStale={noop}
            save={unusedSave}
            initialTab="features"
            addEntryKey={null}
            toolbarStart={<span className="text-sm font-semibold text-slate-slate100">{BUILDER_WORDS.yourFeature}</span>}
            host={host}
          />
        </div>
      </Frame>
      {dialog !== null && doc !== null && (
        <BuilderSaveDialog editing={editing} lead={dialog.lead} doc={doc} library={library} state={panel} needsSlots={needsSlots} onSaved={finishSave} onCancel={cancelSave} />
      )}
      {using !== null && <UseInAppDialog entry={using} onClose={() => setUsing(null)} />}
    </StepChromeContext.Provider>
  );
}

interface ReadyProps {
  featureId: string | undefined;
  record: FeatureRecord | null;
  features: readonly FeatureRecord[];
  library: FeatureLibrary;
  reload(): Promise<void>;
}

/** Mounted once the features are known: the bench is made from them once (later reloads never rebuild it). */
function Ready({ featureId, record, features, library, reload }: ReadyProps) {
  const location = useLocation();
  const [made] = useState<{ start: BenchStart; initial: FeatureRecord | null }>(() => {
    const fromRecord = record === null ? null : inputOfRecord(record);
    if (featureId !== undefined && fromRecord !== null) return { start: benchFromFeature(fromRecord, library), initial: record };
    const input = startInputOf(location.state);
    return { start: input === null ? { spec: emptyBench(), state: { textOn: new Set(), labels: {} }, problem: null } : benchFromFeature(input, library), initial: null };
  });
  if (made.start.problem !== null) {
    // A start from Save as feature has no stored record: it gets the plain words and the way back only.
    return <CannotOpen words={made.start.problem === 'one_record' ? BUILDER_WORDS.oneRecord : BUILDER_WORDS.cannotOpen} rename={record === null || featureId === undefined ? undefined : { record, library, reload }} />;
  }
  return <BuilderScreen start={made.start} initial={made.initial} features={features} library={library} reload={reload} />;
}

export default function FeatureBuilderPage() {
  const { featureId } = useParams();
  const { features, library, loading, error, reload } = useFeatures();
  const record = featureId === undefined ? null : (features.find((f) => f.id === featureId) ?? null);

  if (loading) {
    return (
      <Frame>
        <div role="status" aria-label="Loading the builder" className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Frame>
    );
  }
  if (featureId !== undefined) {
    if (error !== null && record === null) {
      return (
        <Frame>
          <div className="glass space-y-3 rounded-2xl p-5">
            <p role="alert" className={formErrorClass}>
              {error}
            </p>
            <button type="button" className={btnSecondary} onClick={() => void reload()}>
              Try again
            </button>
          </div>
        </Frame>
      );
    }
    if (record === null) return <CannotOpen words={BUILDER_WORDS.missing} />;
    if (!record.ok || record.fragment === null) return <CannotOpen words={BUILDER_WORDS.damaged} />;
  }
  return <Ready featureId={featureId} record={record} features={features} library={library} reload={reload} />;
}
