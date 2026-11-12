// Design step: the page's layout as a canvas you add parts to. The tree changes only through src/studio/lib/layoutTree.ts, the
// page and its look are saved into the spec through the workspace, and nothing reaches the server before Save or before the
// person moves on: the session registers its draft with the workspace (setDraft), which saves it before any move. The page
// picker and the page actions follow the same rule: they save first, and a draft that cannot be saved asks first. The canvas, the
// shelf and the drag and drop live in src/studio/design/ and are loaded with this step, never with the first paint.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { CatalogDataSource } from '@/catalog/context';
import { createHttpDataSource } from '@local-app-studio/runtime/runtime/dataClient.js';
import type { AppSpec, Table } from '@local-app-studio/runtime/spec/schema';
import DesignSession from '../design/DesignSession';
import type { ShelfTab } from '../design/FeatureShelf';
import PageStrip from '../design/PageStrip';
import ActionMenu from '../components/ActionMenu';
import PageSettingsDialog from '../components/PageSettingsDialog';
import StudioConfirm from '../components/StudioConfirm';
import { useFeatures } from '../hooks/useFeatures';
import { usePreviewStatus } from '../hooks/usePreviewStatus';
import { useStepChrome } from '../hooks/useStepChrome';
import type { StepDraft } from '../hooks/useStepChrome';
import { useWorkspace } from '../hooks/useWorkspace';
import { GO_TO_DATA, START_ON_DATA } from '../lib/buildYourself';
import { toId, uniquePageRoute } from '../lib/ids';
import { stepPath } from '../lib/steps';
import { starterLayout } from '../lib/layout';
import { plainMessage } from '../lib/issueWords';
import { PAGE_COPY, addRecordPage, makeRecordPage, pageReferrers, titleClash } from '../lib/pageRules';
import { TEXT_BUTTON } from '../components/ui';
import { getSample } from '../services/studioApi';
import type { SampleRecords } from '../lib/sampleData';
import type { SaveResult } from '../types';

const PREVIEW_API = '/api/preview';

/** The most answers kept per app: the last 200 reads. */
const KEPT_MAX = 200;
/** Errors that mean "the child is not there right now" (not "the answer is no"): only these fall back to a kept answer. */
const TRANSIENT_CODES: ReadonlySet<string> = new Set(['network_unreachable', 'server_error', 'preview_not_running', 'preview_unavailable']);

function isTransient(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code } = err as { code?: unknown };
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

/**
 * Reads go to the preview child; the canvas never writes to the scratch data. The last answer to each read is kept in `kept`
 * (shared by the sources of one app), so a Save that restarts Preview does not blank the rows until the new ones come. A kept
 * answer stands in only when the child cannot be reached or the preview proxy says it is down (the codes in TRANSIENT_CODES; a 404
 * or 400 after a schema change shows as it is).
 * With `keptOnly` no request is made at all (Preview is starting, or still runs an older revision): only kept answers are served,
 * and a read with no kept answer stays pending (it reads as loading) until the next source replaces this one.
 * Each call builds a new object, so the catalog loads again when the child changes (it keys every load on the source object).
 */
function readOnlySource(kept: Map<string, unknown>, keptOnly: boolean): CatalogDataSource {
  const http = createHttpDataSource(PREVIEW_API) as CatalogDataSource;
  const refuse = (): Promise<never> => Promise.reject(Object.assign(new Error('The canvas shows data but does not change it.'), { code: 'read_only' }));
  const keep = (key: string, value: unknown): void => {
    kept.delete(key);
    kept.set(key, value);
    if (kept.size > KEPT_MAX) {
      const oldest = kept.keys().next();
      if (!oldest.done) kept.delete(oldest.value);
    }
  };
  const hold = <T,>(key: string, read: () => Promise<T>): Promise<T> => {
    if (keptOnly) return kept.has(key) ? Promise.resolve(kept.get(key) as T) : new Promise<T>(() => undefined);
    return read().then(
      (value) => {
        keep(key, value);
        return value;
      },
      (err: unknown) => {
        if (isTransient(err) && kept.has(key)) return kept.get(key) as T;
        throw err;
      },
    );
  };
  const grouped = http.groups?.bind(http);
  return {
    ...http,
    list: (table, q) => hold(`list:${table}:${JSON.stringify(q)}`, () => http.list(table, q)),
    stats: (table, q) => hold(`stats:${table}:${JSON.stringify(q)}`, () => http.stats(table, q)),
    get: (table, id) => hold(`get:${table}:${id}`, () => http.get(table, id)),
    ...(grouped === undefined ? {} : { groups: (table: string, q: Parameters<typeof grouped>[1]) => hold(`groups:${table}:${JSON.stringify(q)}`, () => grouped(table, q)) }),
    create: refuse,
    update: refuse,
    remove: refuse,
  };
}

/** The showcase tile Use in app sent along, if any. */
function addEntryOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('addEntry' in state)) return null;
  const key = (state as { addEntry: unknown }).addEntry;
  return typeof key === 'string' ? key : null;
}

/** The shelf tab Change look sent along: 'look' opens the Look tab, anything else the parts. */
function shelfTabOf(state: unknown): ShelfTab {
  if (typeof state !== 'object' || state === null || !('shelfTab' in state)) return 'features';
  return (state as { shelfTab: unknown }).shelfTab === 'look' ? 'look' : 'features';
}

/** A page whose address holds a record number opens from a list. */
const opensFromList = (route: string): boolean => route.includes('/:');

/** The words of Add a page and of the page that shows one record. */
const KIND_COPY = {
  legend: 'What kind of page?',
  parts: 'A page of parts',
  record: 'A page that shows one record from a table',
  table: 'Table',
  recordTitle: (table: string): string => table,
  recordTitleTaken: (table: string): string => `${table} record`,
  makeTitle: 'Show one record on this page',
  makeLead: (table: string): string => `This page will open from a list, one ${table} record at a time. It leaves the menu and shows the record's details.`,
  makeButton: (table: string): string => `Make this page show one ${table} record`,
  makeBusy: 'Making...',
  close: 'Close',
} as const;

/** What a new page is: parts you place, or one record of a table. */
type NewPage = { kind: 'parts' } | { kind: 'record'; table: string };

function AddPageDialog({ tables, titles, onAdd, onCancel }: { tables: readonly Table[]; titles: readonly string[]; onAdd(title: string, what: NewPage): Promise<string | null>; onCancel(): void }) {
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const [kind, setKind] = useState<'parts' | 'record'>('parts');
  const [table, setTable] = useState(tables[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = tables.find((t) => t.id === table)?.label ?? '';
  // A record page starts with the label of its table as the title, until the person types one.
  const defaultTitle = (id: string): string => {
    const found = tables.find((t) => t.id === id)?.label ?? '';
    return titles.some((t) => t.trim().toLowerCase() === found.trim().toLowerCase()) ? KIND_COPY.recordTitleTaken(found) : KIND_COPY.recordTitle(found);
  };
  const pickKind = (next: 'parts' | 'record'): void => {
    setKind(next);
    setError(null);
    if (!touched) setTitle(next === 'record' ? defaultTitle(table) : '');
  };
  const pickTable = (id: string): void => {
    setTable(id);
    if (!touched && kind === 'record') setTitle(defaultTitle(id));
  };
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Give the page a title.');
      return;
    }
    if (kind === 'record' && table === '') {
      setError(PAGE_COPY.noTable);
      return;
    }
    setBusy(true);
    const problem = await onAdd(trimmed, kind === 'record' ? { kind, table } : { kind });
    setBusy(false);
    setError(problem);
  };
  return (
    <Modal title="Add a page" onClose={onCancel}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)}>
        <fieldset className="space-y-1">
          <legend className={labelClass}>{KIND_COPY.legend}</legend>
          <label className="flex items-center gap-2 text-sm text-slate-slate100">
            <input type="radio" name="page-kind" checked={kind === 'parts'} onChange={() => pickKind('parts')} />
            {KIND_COPY.parts}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-slate100">
            <input type="radio" name="page-kind" checked={kind === 'record'} disabled={tables.length === 0} onChange={() => pickKind('record')} />
            {KIND_COPY.record}
          </label>
          {tables.length === 0 && <p className="text-xs text-slate-slate400">{PAGE_COPY.noTable}</p>}
        </fieldset>
        {kind === 'record' && (
          <label className="block">
            <span className={labelClass}>{KIND_COPY.table}</span>
            <select className={inputClass} value={table} onChange={(e) => pickTable(e.target.value)}>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className={labelClass}>Page title</span>
          <input
            className={inputClass}
            value={title}
            maxLength={60}
            onChange={(e) => {
              setTitle(e.target.value);
              setTouched(true);
              setError(null);
            }}
            autoFocus
          />
        </label>
        {error && (
          <p role="alert" className={formErrorClass}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || (kind === 'record' && label === '')}>
            {busy ? 'Adding...' : 'Add page'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Page actions, Show one record on this page: a table to pick and one button that makes the open page show one record of it. */
function MakeRecordDialog({ tables, onMake, onCancel }: { tables: readonly Table[]; onMake(table: string): Promise<string | null>; onCancel(): void }) {
  const [table, setTable] = useState(tables[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = tables.find((t) => t.id === table)?.label ?? '';
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    const problem = await onMake(table);
    setBusy(false);
    setError(problem);
  };
  return (
    <Modal title={KIND_COPY.makeTitle} onClose={onCancel}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)}>
        <p className="text-sm text-slate-slate300">{KIND_COPY.makeLead(label)}</p>
        <label className="block">
          <span className={labelClass}>{KIND_COPY.table}</span>
          <select className={inputClass} value={table} onChange={(e) => setTable(e.target.value)}>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className={formErrorClass}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || table === ''}>
            {busy ? KIND_COPY.makeBusy : KIND_COPY.makeButton(label)}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Delete this page, when parts still go to it: they are named, and there is no red button until they go somewhere else. */
function DeleteBlocked({ title, lines, closing, onClose }: { title: string; lines: readonly string[]; closing: string; onClose(): void }) {
  return (
    <Modal title={`Delete the page ${title}?`} onClose={onClose}>
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-slate200">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm text-slate-slate300">{closing}</p>
        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            {KIND_COPY.close}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A move that waited for the draft to be saved, and why it could not be. */
interface Stuck {
  reason: string;
  run(): void;
}

export default function DesignTab() {
  const { record, spec, revision, save, setDirty } = useWorkspace();
  const chrome = useStepChrome();
  const location = useLocation();
  const [pageId, setPageId] = useState(spec.pages[0]?.id ?? '');
  const [loadNonce, setLoadNonce] = useState(0);
  const [dialog, setDialog] = useState<'add' | 'settings' | 'delete' | 'record' | null>(null);
  const [stuck, setStuck] = useState<Stuck | null>(null);
  // Where the shelf starts (Change look, Use in app). Only the first page opened uses it.
  const [start, setStart] = useState(() => ({ tab: shelfTabOf(location.state), entry: addEntryOf(location.state) }));
  const { features, library, reload: reloadFeatures } = useFeatures();

  // The chrome is read through a ref so the session's registration effect does not depend on the shell's render.
  const chromeRef = useRef(chrome);
  useEffect(() => {
    chromeRef.current = chrome;
  });
  const draftRef = useRef<StepDraft | null>(null);

  const pageIndex = Math.max(0, spec.pages.findIndex((p) => p.id === pageId));
  const page = spec.pages[pageIndex];

  // Data parts show the preview's rows while the preview runs this revision of this app. Otherwise the canvas draws
  // sample rows of the app's own tables (no request, no console error).
  const { status } = usePreviewStatus(record.id, revision);
  const live = status !== null && status.state === 'running' && status.appId === record.id && status.revision === revision;
  // The answers of this app's reads, kept across Preview restarts. A new source object is built for each Preview child (a restart
  // after a Save starts a new one), which makes the catalog load again; until the new child runs this revision, a source that
  // answers only from the kept rows is handed out, so nothing asks the old child and the canvas does not flash to made-up rows.
  // State, not a memo, so React dropping a memo cache cannot lose the kept answers; replaced when the app id changes.
  const [keptOf, setKeptOf] = useState(() => ({ appId: record.id, map: new Map<string, unknown>() }));
  let kept = keptOf.map;
  if (keptOf.appId !== record.id) {
    const next = { appId: record.id, map: new Map<string, unknown>() };
    setKeptOf(next);
    kept = next.map;
  }
  const child = live ? `${revision}:${status.startedAt ?? ''}` : null;
  const childSource = useMemo(() => ({ child, source: readOnlySource(kept, false) }), [kept, child]).source;
  const keptSource = useMemo(() => readOnlySource(kept, true), [kept]);
  const active = status !== null && status.appId === record.id && (status.state === 'running' || status.state === 'starting');
  const [wasLive, setWasLive] = useState<string | null>(null);
  if (live && wasLive !== record.id) setWasLive(record.id);
  const liveSource = live ? childSource : active && wasLive === record.id ? keptSource : undefined;
  // The stored example records of this app, for the canvas when Preview is not showing its rows. Missing or unreadable: none.
  const [sampleOf, setSampleOf] = useState<{ appId: string; sample: SampleRecords } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    getSample(record.id, ctl.signal).then(
      (sample) => setSampleOf({ appId: record.id, sample }),
      () => undefined,
    );
    return () => ctl.abort();
  }, [record.id]);

  const onDirty = useCallback(
    (dirty: boolean): void => {
      setDirty('design', dirty);
    },
    [setDirty],
  );
  const onDraft = useCallback((draft: StepDraft | null) => {
    draftRef.current = draft;
    chromeRef.current.setDraft('design', draft);
  }, []);
  // A newer record arrived from elsewhere while the session holds no unsaved edit: it starts again from that record (theme, menu, page).
  // Focus inside the session when it is started again is put back after the remount (the browser would drop it to the page body).
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastInside = useRef(false);
  const refocus = useRef(false);
  const onStale = useCallback(() => {
    const active = document.activeElement;
    const wrap = wrapRef.current;
    // A disabled Undo button keeps no focus in some browsers: the last focus seen inside stands in when focus is on the body.
    refocus.current = wrap !== null && ((active !== null && wrap.contains(active)) || ((active === null || active === document.body) && lastInside.current));
    setLoadNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const canvasTarget = document.querySelector<HTMLElement>('#design-page [data-canvas-block][tabindex="0"]') ?? document.querySelector<HTMLElement>('#design-page [data-canvas-block]');
    (canvasTarget ?? document.querySelector<HTMLElement>('h3[tabindex="-1"]'))?.focus();
  }, [loadNonce]);

  // Every save here starts from the revision of the spec it was built from: a later one gets a conflict instead of overwriting.
  const saveHere = useCallback((next: AppSpec): Promise<SaveResult> => save(next, { baseRevision: revision }), [save, revision]);

  const showPage = (id: string): void => {
    setStart({ tab: 'features', entry: null });
    setPageId(id);
  };

  /** The save on move rule for the page picker and the page actions: save the draft first, then go on. A draft that cannot be saved asks first. */
  const afterSaving = async (run: () => void): Promise<void> => {
    const draft = draftRef.current;
    if (draft === null || !draft.isDirty()) {
      run();
      return;
    }
    if (draft.saveBlocked !== null) {
      setStuck({ reason: draft.saveBlocked, run });
      return;
    }
    const outcome = await draft.save();
    if (outcome.ok) run();
    else if (outcome.cancelled !== true) setStuck({ reason: outcome.reason ?? 'Your changes could not be saved.', run });
  };

  const addPage = async (title: string, what: NewPage): Promise<string | null> => {
    const clash = titleClash(spec, title);
    if (clash !== null) return clash;
    if (what.kind === 'record') {
      const made = addRecordPage(spec, title, what.table);
      if (!made.ok) return plainMessage(made.message);
      const saved = await saveHere(made.spec);
      if (!saved.ok) return plainMessage(saved.message);
      showPage(made.pageId);
      setDialog(null);
      return null;
    }
    const id = toId(title, new Set(spec.pages.map((p) => p.id)), () => false);
    const route = uniquePageRoute(title, new Set(spec.pages.map((p) => p.route)));
    const nextSpec: AppSpec = {
      ...spec,
      pages: [...spec.pages, { id, title, route, sources: [], layout: starterLayout(id, title) }],
      nav: [...spec.nav, { pageId: id, label: title, icon: 'file' }],
    };
    const result = await saveHere(nextSpec);
    if (!result.ok) return plainMessage(result.message);
    showPage(id);
    setDialog(null);
    return null;
  };

  const makeRecord = async (table: string): Promise<string | null> => {
    const made = makeRecordPage(spec, page.id, table);
    if (!made.ok) return plainMessage(made.message);
    const saved = await saveHere(made.spec);
    if (!saved.ok) return plainMessage(saved.message);
    setLoadNonce((n) => n + 1);
    setDialog(null);
    return null;
  };

  const deletePage = async (): Promise<void> => {
    const nextSpec: AppSpec = { ...spec, pages: spec.pages.filter((p) => p.id !== page.id), nav: spec.nav.filter((n) => n.pageId !== page.id) };
    const result = await saveHere(nextSpec);
    if (!result.ok) throw new Error(plainMessage(result.message));
    showPage(nextSpec.pages[0]?.id ?? '');
    setDialog(null);
  };

  const saveSettings = async (nextSpec: AppSpec): Promise<SaveResult> => {
    const result = await saveHere(nextSpec);
    if (result.ok) setDialog(null);
    return result;
  };

  useEffect(() => () => setDirty('design', false), [setDirty]);

  if (!page) return null;
  const homePage = page.route === '/';
  const blockers = pageReferrers(spec, page.id);

  const pageControls = (
    <>
      <label className="flex items-center gap-2 text-sm text-slate-slate300">
        Page
        <select aria-label="Page" className={`${inputClass} w-auto`} value={page.id} onChange={(e) => {
            // Read now: a controlled select goes back to the open page while the draft is being saved.
            const next = e.target.value;
            void afterSaving(() => showPage(next));
          }}>
          {spec.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {opensFromList(p.route) ? `${p.title} (opens from a list)` : p.title}
            </option>
          ))}
        </select>
      </label>
      <ActionMenu
        label="Page actions"
        menuLabel={`Page actions for ${page.title}`}
        items={[
          { id: 'add', label: 'Add a page', onSelect: () => void afterSaving(() => setDialog('add')) },
          { id: 'settings', label: 'Page settings', onSelect: () => void afterSaving(() => setDialog('settings')) },
          { id: 'record', label: KIND_COPY.makeTitle, disabled: homePage || opensFromList(page.route) || spec.tables.length === 0, onSelect: () => void afterSaving(() => setDialog('record')) },
          { id: 'delete', label: 'Delete this page', danger: true, disabled: homePage || spec.pages.length < 2, onSelect: () => void afterSaving(() => setDialog('delete')) },
        ]}
      />
    </>
  );

  return (
    <div
      ref={wrapRef}
      onFocus={() => {
        lastInside.current = true;
      }}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node) lastInside.current = e.currentTarget.contains(next);
      }}
    >
      <DesignSession
        key={`${page.id}:${loadNonce}`}
        spec={spec}
        revision={revision}
        page={page}
        pageIndex={pageIndex}
        appId={record.id}
        onShowPage={(id) => void afterSaving(() => showPage(id))}
        features={features}
        library={library}
        reloadFeatures={reloadFeatures}
        liveSource={liveSource}
        sample={sampleOf !== null && sampleOf.appId === record.id ? sampleOf.sample : null}
        onDirty={onDirty}
        onDraft={onDraft}
        onStale={onStale}
        save={save}
        initialTab={start.tab}
        addEntryKey={start.entry}
        toolbarStart={
          <>
            {/* Inside the toolbar so the skip link stays the first Tab stop; it takes a row of its own. */}
            <PageStrip key={page.id} spec={spec} pageId={page.id} appId={record.id} />
            {spec.tables.length === 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-slate-slate400">{START_ON_DATA}</p>
                <button type="button" className={TEXT_BUTTON} onClick={() => chrome.go(stepPath(record.id, 'data'))}>
                  {GO_TO_DATA}
                </button>
              </div>
            )}
            {pageControls}
          </>
        }
      />
      {dialog === 'add' && <AddPageDialog tables={spec.tables} titles={spec.pages.map((p) => p.title)} onAdd={addPage} onCancel={() => setDialog(null)} />}
      {dialog === 'record' && <MakeRecordDialog tables={spec.tables} onMake={makeRecord} onCancel={() => setDialog(null)} />}
      {dialog === 'settings' && <PageSettingsDialog spec={spec} pageId={page.id} onSave={saveSettings} onCancel={() => setDialog(null)} />}
      {dialog === 'delete' && blockers.lines.length > 0 && <DeleteBlocked title={page.title} lines={blockers.lines} closing={blockers.closing} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && blockers.lines.length === 0 && (
        <StudioConfirm
          title={`Delete the page ${page.title}?`}
          message="The page and its menu entry are removed. Buttons that go to it must be changed first."
          confirmLabel="Delete page"
          busyLabel="Deleting..."
          cancelLabel="Keep page"
          onConfirm={deletePage}
          onCancel={() => setDialog(null)}
        />
      )}
      {stuck !== null && (
        <StudioConfirm
          title={`Your changes on ${page.title} cannot be saved yet`}
          message={stuck.reason}
          confirmLabel="Discard changes"
          busyLabel="Discarding..."
          cancelLabel="Stay"
          onConfirm={() => {
            const { run } = stuck;
            setStuck(null);
            setLoadNonce((n) => n + 1);
            run();
          }}
          onCancel={() => setStuck(null)}
        />
      )}
    </div>
  );
}
