// Data step: the table and field designer (DESIGN-phase3.md 7.8, phase 12 2.5). Edits a draft with Undo and Redo. Save writes
// through the workspace; the shell saves the draft when the person moves to another step (useStepChrome).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Redo2, Undo2 } from 'lucide-react';
import type { AppSpec, Page, SpecIssue, Table } from '@local-app-studio/runtime/spec/schema';
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import IssueList from '../components/IssueList';
import StudioConfirm from '../components/StudioConfirm';
import WayInOffer from '../components/WayInOffer';
import TableEditor from '../components/TableEditor';
import { HINT_CLASS, NOTICE_CLASS, SELECTED_CLASS } from '../components/ui';
import { useDraftStore } from '../hooks/useDraftStore';
import { useStepChrome } from '../hooks/useStepChrome';
import type { SaveOutcome, StepDraft } from '../hooks/useStepChrome';
import { useWorkspace } from '../hooks/useWorkspace';
import { canRedo, canUndo, createHistory, present, push, redo, undo } from '../lib/draftHistory';
import type { History } from '../lib/draftHistory';
import { DATA_COPY, NEEDS_FIX_SELECTED_BADGE, blockedReason } from '../lib/dataCopy';
import { REMOVE_DATA, dataRemovals } from '../lib/dataRemovals';
import { DRAFT_RESTORED, asTables } from '../lib/draftPayload';
import { DRAFT_DISCARD, DRAFT_RESTORE } from '../lib/draftStore';
import { entryLabel, redidNotice, undidNotice } from '../lib/historyWords';
import { removeReferences } from '../lib/removeReferences';
import { stableJson } from '../lib/stableJson';
import { STEP_FOCUS, stepPath } from '../lib/steps';
import type { ChangeMeta } from '../lib/tableChange';
import { blankTable } from '../lib/tableDraft';
import { issuesAt, issuesOutside, validateSpec } from '../lib/validate';
import type { SaveResult } from '../types';

const CHECK_DELAY_MS = 200;
const fieldCount = (n: number): string => `${n} ${n === 1 ? 'field' : 'fields'}`;

const isTyping = (target: EventTarget): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(target.type);
};

/** The "Save and remove data?" question, asked from inside a save: answer(true) lets it go on, `finished` settles when it is over. */
interface PendingSave {
  sentences: string[];
  answer(yes: boolean): void;
  finished: Promise<void>;
}

/**
 * The spec this draft was loaded from, its revision, and the tables it compares with (the ones it sent, or the record's).
 * `spec.tables` is always `tables`, so a save diffs what it sends against what the last one sent, never against the server's
 * own normal form. `echo` is the tables the record held at that revision, to tell a newer record from elsewhere from our own save.
 */
interface DraftBase {
  revision: number;
  spec: AppSpec;
  tables: Table[];
  echo: Table[];
  /** The pages this draft sent with its last save (or the record's): "Remove it from those parts too" changes pages as well as tables. */
  pages: Page[];
}

const SAVE_THROWN = 'Could not save. Your changes are still here. Try again.';

export default function DataTab() {
  const { record, spec, revision, save, setDirty } = useWorkspace();
  const chrome = useStepChrome();
  const [history, setHistory] = useState<History<Table[]>>(() => createHistory(spec.tables));
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<{ draft: Table[]; issues: SpecIssue[] }>({ draft: spec.tables, issues: [] });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // After Undo the line offers Redo; after anything else it offers Undo.
  const [noticeRedo, setNoticeRedo] = useState(false);
  // The table that was just added: its name box takes the focus once, with the text selected.
  const [focusTable, setFocusTable] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<{ text: string; issues: SpecIssue[] } | null>(null);
  const [pending, setPending] = useState<PendingSave | null>(null);
  // The tables the last save added, while the draft stays clean: the way-in offer is about them.
  const [newIds, setNewIds] = useState<string[]>([]);

  // The tables this draft compares with: what its own last save sent (the server may store the spec in its own normal form, so the
  // echo is not compared) or, after a newer record from elsewhere, that record's tables.
  const [baseJson, setBaseJson] = useState(() => stableJson(spec.tables));
  const [basePagesJson, setBasePagesJson] = useState(() => stableJson(spec.pages));
  const draft = present(history);
  // The pages "Remove it from those parts too" changed for this very list of tables. They ride with the entry of the history that
  // holds those tables, so Undo takes them back with it. None: the pages are the record's.
  const [pageFixes, setPageFixes] = useState(() => new WeakMap<Table[], Page[]>());
  const fixesRef = useRef(pageFixes);
  useLayoutEffect(() => {
    fixesRef.current = pageFixes;
  });
  const resetFixes = useCallback((): void => {
    fixesRef.current = new WeakMap();
    setPageFixes(fixesRef.current);
  }, []);
  const draftPages = pageFixes.get(draft) ?? null;
  // The saved design as the screen shows it (a ref is not read while drawing): the tables a name is frozen by, and labels of removed things.
  const [view, setView] = useState({ spec, tables: spec.tables });
  const dirty = stableJson(draft) !== baseJson || (draftPages !== null && stableJson(draftPages) !== basePagesJson);

  // False once the step has gone: a save the shell runs for it then (a move it could not hold back) must not set state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The spec this draft was loaded from, with its revision. Only this draft's own saves move it on. A newer record from elsewhere
  // (App settings, a reload after a conflict) is taken only while the draft is clean; a dirty draft keeps its base, so its next
  // save gets a conflict and says so, and never overwrites the other change. Every save reads it when it runs, never at render.
  const base = useRef<DraftBase>({ revision, spec, tables: spec.tables, echo: spec.tables, pages: spec.pages });
  const moveBase = useCallback((next: DraftBase): void => {
    base.current = next;
    setBaseJson(stableJson(next.tables));
    setBasePagesJson(stableJson(next.pages));
    setView({ spec: next.spec, tables: next.tables });
  }, [setBaseJson, setBasePagesJson, setView]);
  // The tables on screen, for isDirty() and for a save that runs after the step has gone.
  const latest = useRef<Table[]>(draft);
  useLayoutEffect(() => {
    latest.current = draft;
  });
  // Whether a page change has been made in this history, so a newer record's pages can start it again.
  const pagesTouched = useRef(false);

  // Read when a newer record arrives, to say that Redo went with the history.
  const historyRef = useRef(history);
  useLayoutEffect(() => {
    historyRef.current = history;
  });
  const chromeRef = useRef(chrome);
  useEffect(() => {
    chromeRef.current = chrome;
  });

  const isDirty = useCallback((): boolean => {
    if (stableJson(latest.current) !== stableJson(base.current.tables)) return true;
    const pages = fixesRef.current.get(latest.current);
    return pages !== undefined && stableJson(pages) !== stableJson(base.current.pages);
  }, []);

  // Unsaved edits are kept in browser storage; a stored draft from an earlier visit is offered back (Restore / Discard), never applied silently.
  const offer = useDraftStore({
    appId: record.id,
    step: 'data',
    revision,
    baseRevision: () => base.current.revision,
    dirty,
    isDirty,
    payload: () => latest.current,
    isSaved: (payload) => asTables(payload) === null || stableJson(payload) === stableJson(spec.tables),
  });
  useEffect(() => {
    if (revision <= base.current.revision || isDirty()) return;
    // Against the tables the previous record held, not the ones sent: the server's copy of our own save is in its normal form.
    const pagesChanged = pagesTouched.current && stableJson(spec.pages) !== stableJson(base.current.spec.pages);
    const changed = stableJson(spec.tables) !== stableJson(base.current.echo) || pagesChanged;
    const lostRedo = changed && canRedo(historyRef.current);
    moveBase({ revision, spec, tables: spec.tables, echo: spec.tables, pages: spec.pages });
    // Tables changed elsewhere and nothing here is unsaved: the tables and their history start from the record again.
    if (changed) {
      if (lostRedo) chromeRef.current.announce('Started again from the latest saved version. Redo is cleared.');
      latest.current = spec.tables;
      resetFixes();
      pagesTouched.current = false;
      setHistory(createHistory(spec.tables));
      setNotice(null);
      setSaveError(null);
      setNewIds([]);
    }
  }, [revision, spec, dirty, isDirty, moveBase, resetFixes]);

  useEffect(() => {
    setDirty('data', dirty);
  }, [dirty, setDirty]);
  useEffect(() => () => setDirty('data', false), [setDirty]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setChecked({ draft, issues: validateSpec({ ...spec, tables: draft, pages: draftPages ?? spec.pages }).issues });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, draftPages, spec]);

  const issues = checked.issues;
  const settled = checked.draft === draft;
  const index = Math.min(selected, Math.max(draft.length - 1, 0));
  const table = draft[index];

  const badNames = draft.filter((_, i) => issuesAt(issues, `tables.${i}`).length > 0).map((t) => t.label);
  const nextBlocked =
    badNames.length > 0
      ? `Fix the tables marked Needs a fix to go on: ${badNames.join(', ')}.`
      : issuesOutside(issues, 'tables').length > 0
        ? 'Fix the pages listed below in Design to go on.'
        : null;

  // The design as the draft would save it, for the words of the problems and for "Remove it from those parts too".
  const draftSpec = useMemo<AppSpec>(() => ({ ...spec, tables: draft, pages: draftPages ?? spec.pages }), [spec, draft, draftPages]);
  const pageIssues = issuesOutside(issues, 'tables');
  const hasPageIssues = pageIssues.length > 0;
  const removal = useMemo(() => {
    if (!hasPageIssues || !settled) return null;
    const result = removeReferences(draftSpec);
    return result.ok && result.changed ? result : null;
  }, [draftSpec, settled, hasPageIssues]);
  const blocked = dirty && settled && issues.length > 0 && !saving ? blockedReason(issues, draftSpec.pages, badNames.length > 0, removal !== null) : null;

  const pagesUsing = useMemo(
    () => (table ? spec.pages.filter((p) => p.sources.some((s) => s.table === table.id)).map((p) => p.title) : []),
    [spec.pages, table],
  );

  const edit = (next: Table[], meta: ChangeMeta): void => {
    // Pages changed by "Remove it from those parts too" stay with every later edit of the tables.
    if (draftPages !== null && !fixesRef.current.has(next)) fixesRef.current.set(next, draftPages);
    setHistory((h) => push(h, next, { label: entryLabel(meta), ...(meta.coalesceKey === undefined ? {} : { coalesceKey: meta.coalesceKey }) }));
    setNotice(meta.notice ?? null);
    setNoticeRedo(false);
    setSaveError(null);
    setNewIds([]);
  };

  // The offer sits in the status region below, which says it once; it is not announced a second time.
  const navRef = useRef<HTMLElement>(null);
  /** Restore and Discard remove the button that was pressed: the focus goes to the name box of the table on screen, or the Tables list. */
  const focusAfterOffer = (count: number): void => {
    if (count > 0) setFocusTable(Math.min(selected, count - 1));
    else navRef.current?.querySelector('button')?.focus();
  };
  const restoreOffer = (): void => {
    if (offer === null) return;
    const stored = asTables(offer.take());
    if (stored === null) return;
    // A draft made from another revision keeps that base: its save then meets the revision conflict instead of overwriting newer work.
    if (offer.baseRevision !== base.current.revision) moveBase({ ...base.current, revision: offer.baseRevision });
    edit(stored, { label: 'Restore changes', notice: DRAFT_RESTORED });
    focusAfterOffer(stored.length);
  };
  const discardOffer = (): void => {
    offer?.discard();
    focusAfterOffer(draft.length);
  };

  const addTable = (): void => {
    // The ids of saved tables stay taken, also when the draft has taken that table out: a new table must not be matched to it.
    const added = blankTable(draft, view.tables.map((t) => t.id));
    edit([...draft, added], { label: 'Add table', notice: `Added the table ${added.label}.` });
    setSelected(draft.length);
    setFocusTable(draft.length);
  };

  /** One press: takes what was removed out of the pages (and any link to a removed table) and keeps it as one Undo step. */
  const removeFromParts = (): void => {
    if (removal === null) return;
    const tables = [...removal.spec.tables];
    fixesRef.current.set(tables, removal.spec.pages);
    pagesTouched.current = true;
    edit(tables, { label: DATA_COPY.removeLabel, notice: removal.links.length === 0 ? DATA_COPY.removeNotice : DATA_COPY.removeNoticeLinks(removal.links) });
  };

  const changeTable = (k: number, next: Table, meta: ChangeMeta = { label: 'Edit table' }): void => {
    const old = draft[k];
    edit(
      draft.map((t, i) => {
        if (i === k) return next;
        if (!old || old.id === next.id) return t;
        // A renamed table id keeps the links from other tables pointing at it.
        return { ...t, fields: t.fields.map((f) => (f.type === 'reference' && f.table === old.id ? { ...f, table: next.id } : f)) };
      }),
      meta,
    );
  };

  const deleteTable = (k: number): void => {
    const removed = draft[k];
    edit(
      draft.filter((_, i) => i !== k),
      { label: 'Remove table', notice: removed ? `Removed the table ${removed.label}.` : 'Removed the table.' },
    );
    setSelected(Math.max(0, k - 1));
  };

  // Undo and Redo say what they did ("Undid: removed the field Amount.") and offer the way back.
  const undoLast = useCallback((): void => {
    const h = historyRef.current;
    if (!canUndo(h)) return;
    setHistory(undo);
    setNotice(undidNotice(h.entries[h.index].label));
    setNoticeRedo(true);
    setSaveError(null);
    setNewIds([]);
  }, []);
  const redoLast = useCallback((): void => {
    const h = historyRef.current;
    if (!canRedo(h)) return;
    setHistory(redo);
    setNotice(redidNotice(h.entries[h.index + 1].label));
    setNoticeRedo(false);
    setSaveError(null);
    setNewIds([]);
  }, []);

  // The saves of this draft, one after the other: each starts from the base the one before it left. Everything about a save
  // (the check, the question about removed data, the base) is decided when it runs, never when it was asked for.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const writeDraft = (tables: Table[]): Promise<SaveOutcome> => {
    const run = async (): Promise<SaveOutcome> => {
      const from = base.current;
      const pages = fixesRef.current.get(tables) ?? from.pages;
      // An earlier save of this draft already sent these tables and pages.
      if (stableJson(tables) === stableJson(from.tables) && stableJson(pages) === stableJson(from.pages)) return { ok: true };
      const next: AppSpec = { ...from.spec, tables, pages };
      const problems = validateSpec(next).issues;
      if (problems.length > 0) {
        const fixable = removeReferences(next);
        const tableProblem = issuesAt(problems, 'tables').length > 0;
        return { ok: false, reason: blockedReason(problems, pages, tableProblem, fixable.ok && fixable.changed) };
      }
      const removals = dataRemovals(from.spec, next);
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      try {
        if (removals.length > 0) {
          // The step is gone, so there is no dialog to ask in: data is never removed without that question.
          if (!mounted.current) return { ok: false, reason: REMOVE_DATA.needsAnswer };
          const yes = await new Promise<boolean>((answer) => {
            setPending({ sentences: removals, answer, finished });
          });
          if (!yes) return { ok: false, cancelled: true };
        }
        if (mounted.current) {
          setSaving(true);
          setSaveError(null);
        }
        let result: SaveResult;
        try {
          result = await save(next, { baseRevision: from.revision });
        } catch {
          result = { ok: false, code: 'error', message: SAVE_THROWN, issues: [] };
        }
        if (result.ok) {
          // The base keeps the tables as sent: the server's copy may be in its own normal form, and the draft is compared with what it sent.
          if (result.record.revision >= base.current.revision) {
            const echo = result.record.spec ?? next;
            moveBase({ revision: result.record.revision, spec: { ...echo, tables, pages }, tables, echo: echo.tables, pages });
          }
          // The pages are saved now and the record carries them: later edits start from the record's pages again.
          resetFixes();
          pagesTouched.current = false;
          if (mounted.current) {
            setNotice(null);
            setNewIds(tables.filter((t) => !from.tables.some((o) => o.id === t.id)).map((t) => t.id));
          }
          return { ok: true };
        }
        if (mounted.current) setSaveError({ text: result.message, issues: result.issues });
        return { ok: false, reason: result.message };
      } catch {
        if (mounted.current) setSaveError({ text: SAVE_THROWN, issues: [] });
        return { ok: false, reason: SAVE_THROWN };
      } finally {
        if (mounted.current) setSaving(false);
        finish();
      }
    };
    const queued = chain.current.then(run, run);
    chain.current = queued;
    return queued;
  };

  /** Saves the draft; the check and the question about removed data happen when the save runs. */
  const saveDraft = async (): Promise<SaveOutcome> => (isDirty() ? writeDraft(latest.current) : { ok: true });

  // The shell calls the draft's save when the person moves on; it goes through a ref so it is always this render's.
  const latestSave = useRef(saveDraft);
  useEffect(() => {
    latestSave.current = saveDraft;
  });
  const resetDraft = (): void => {
    // Clean at once, also when the step is gone or the render that follows never comes (Discard, then the step closes).
    latest.current = base.current.tables;
    if (!mounted.current) return;
    setHistory(createHistory(base.current.tables));
    setNotice(null);
    setSaveError(null);
    setNewIds([]);
  };
  const latestReset = useRef(resetDraft);
  useEffect(() => {
    latestReset.current = resetDraft;
  });
  useEffect(() => {
    const registered: StepDraft = {
      isDirty,
      save: () => latestSave.current(),
      saveBlocked: null,
      nextBlocked,
      reset: () => latestReset.current(),
      exportSpec: () => ({ ...base.current.spec, tables: latest.current }),
    };
    chromeRef.current.setDraft('data', registered);
  }, [isDirty, nextBlocked]);

  // The step goes while the "Save and remove data?" question is open: settle it, or the shell's move would wait for ever.
  const pendingRef = useRef<PendingSave | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  });
  useEffect(
    () => () => {
      pendingRef.current?.answer(false);
      pendingRef.current = null;
    },
    [],
  );
  useEffect(() => {
    const current = chromeRef;
    return () => current.current.setDraft('data', null);
  }, []);

  const canSave = dirty && settled && issues.length === 0 && !saving && pending === null;

  // Ctrl+S, Ctrl+Z and Ctrl+Y work wherever focus is (the rail, the page), not only inside this step's own box. They wait while a
  // dialog is open, and Undo and Redo leave the text fields to the browser's own undo.
  const keys = useRef({ canSave, dirty, saving, saveDraft, undoLast, redoLast });
  useEffect(() => {
    keys.current = { canSave, dirty, saving, saveDraft, undoLast, redoLast };
  });
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 's' && key !== 'z' && key !== 'y') return;
      const dialogOpen = document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
      if (key === 's') {
        e.preventDefault();
        if (dialogOpen) return;
        const now = keys.current;
        if (now.canSave) void now.saveDraft();
        else if (!now.dirty) chromeRef.current.announce('Nothing to save.');
        else if (now.saving) chromeRef.current.announce('Saving...');
        else {
          // Just edited, or a table needs a fix: the save checks the draft itself and the reason is said, never dropped.
          void now.saveDraft().then((outcome) => {
            if (!outcome.ok && outcome.reason !== undefined) chromeRef.current.announce(outcome.reason);
          });
        }
        return;
      }
      if (dialogOpen || isTyping(e.target ?? document.body)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        keys.current.undoLast();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        keys.current.redoLast();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <StudioSectionCard
        title="Tables"
        subtitle="Pick a table to change its fields."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {blocked !== null && (
              <p id="data-save-blocked" className="max-w-sm text-right text-xs text-slate-slate300">
                {blocked}
              </p>
            )}
            <button type="button" className={btnSecondary} onClick={undoLast} disabled={!canUndo(history)}>
              <span className="inline-flex items-center gap-1.5">
                <Undo2 size={14} aria-hidden="true" />
                Undo
              </span>
            </button>
            <button type="button" className={btnSecondary} onClick={redoLast} disabled={!canRedo(history)}>
              <span className="inline-flex items-center gap-1.5">
                <Redo2 size={14} aria-hidden="true" />
                Redo
              </span>
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => void saveDraft()}
              disabled={!canSave}
              aria-describedby={blocked !== null ? 'data-save-blocked' : undefined}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        }
      >
        <div role="status">
          {offer !== null && (
            <div className={`${NOTICE_CLASS} mb-4`}>
              <span>{offer.text}</span>
              <button
                type="button"
                className={btnSecondary}
                onClick={restoreOffer}
              >
                {DRAFT_RESTORE}
              </button>
              <button type="button" className={btnSecondary} onClick={discardOffer}>
                {DRAFT_DISCARD}
              </button>
            </div>
          )}
          {notice !== null && (
            <div className={`${NOTICE_CLASS} mb-4`}>
              <span>{notice}</span>
              <button type="button" className={btnSecondary} onClick={noticeRedo ? redoLast : undoLast} disabled={noticeRedo ? !canRedo(history) : !canUndo(history)}>
                {noticeRedo ? 'Redo' : 'Undo'}
              </button>
            </div>
          )}
        </div>
        <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
          <nav ref={navRef} aria-label="Tables" className="space-y-1">
            {draft.map((t, i) => {
              const bad = issuesAt(issues, `tables.${i}`).length > 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => setSelected(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${i === index ? SELECTED_CLASS : 'text-slate-slate300 hover:bg-slate-slate700/60'}`}
                >
                  <span className="truncate">{t.label}</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    {bad && <span className={`${PILL} ${i === index ? NEEDS_FIX_SELECTED_BADGE : TONE_CLASS.warn}`}>{DATA_COPY.needsFix}</span>}
                    {fieldCount(t.fields.length)}
                  </span>
                </button>
              );
            })}
            <button type="button" className={`${btnSecondary} w-full`} onClick={addTable}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} aria-hidden="true" />
                Add table
              </span>
            </button>
          </nav>
          <div>
            {table ? (
              <TableEditor
                key={index}
                table={table}
                index={index}
                tables={draft}
                issues={issues}
                onChange={(next, meta) => changeTable(index, next, meta)}
                onDelete={() => deleteTable(index)}
                onAddTable={addTable}
                usedByPages={pagesUsing}
                savedTables={view.tables}
                focusName={focusTable === index}
                onFocused={() => setFocusTable(null)}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-slate300">No tables yet. Add one to keep information in your app.</p>
                <button type="button" className={btnSecondary} onClick={addTable}>
                  Add table
                </button>
              </div>
            )}
          </div>
        </div>
        {saveError && (
          <div className="mt-4 space-y-2">
            <p role="alert" className={formErrorClass}>
              {saveError.text}
            </p>
            <IssueList issues={saveError.issues} alert={false} spec={draftSpec} before={view.spec} />
          </div>
        )}
      </StudioSectionCard>
      <div className="flex flex-wrap items-center gap-3">
        <p className={HINT_CLASS}>Records are added in your app, not here. Put a Form on a page, then add records in Preview.</p>
        <button
          type="button"
          className={btnSecondary}
          onClick={() => chrome.go(stepPath(record.id, 'design'), { state: { ...STEP_FOCUS, addEntry: 'part:RecordForm' } })}
        >
          Add a form in Design
        </button>
      </div>
      {newIds.length > 0 && !dirty && <WayInOffer only={newIds} />}
      <IssueList issues={pageIssues} title={DATA_COPY.pagesListTitle} alert={false} spec={draftSpec} before={view.spec} />
      {removal !== null && (
        <div>
          <button type="button" className={btnSecondary} onClick={removeFromParts}>
            {DATA_COPY.removeButton}
          </button>
        </div>
      )}
      {pending && (
        <StudioConfirm
          title={REMOVE_DATA.title}
          message={REMOVE_DATA.message(pending.sentences)}
          confirmLabel={REMOVE_DATA.confirm}
          busyLabel={REMOVE_DATA.busy}
          cancelLabel={REMOVE_DATA.cancel}
          onConfirm={async () => {
            pending.answer(true);
            await pending.finished;
            setPending(null);
          }}
          onCancel={() => {
            pending.answer(false);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
