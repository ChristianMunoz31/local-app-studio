// Offers a way to add records for tables nothing adds to, from a step that holds the saved app (Preview, Data). One press is one
// save of the whole app; Undo is one more save of the spec from before. `only` limits it to some tables (Data: the new ones).
import { useEffect, useMemo, useRef, useState } from 'react';
import { btnSecondary } from '@/components/shared/formStyles.js';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { useStepChrome } from '../hooks/useStepChrome';
import { useWorkspace } from '../hooks/useWorkspace';
import { ADD_WAY_IN, addWaysIn, noWayHere, noWayInLine, waysIn, waysInOutcome } from '../lib/waysIn';
import { STEP_FOCUS, stepPath } from '../lib/steps';
import { HINT_CLASS } from './ui';

const PUT_FORM = ' Put a Form on a page to add them here.';
const ADD_FORM = 'Add a form in Design';

interface Done {
  text: string;
  before: AppSpec;
  revision: number;
}

export default function WayInOffer({ only }: { only?: readonly string[] }) {
  const { record, spec, revision, save } = useWorkspace();
  const chrome = useStepChrome();
  const [done, setDone] = useState<Done | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const moved = useRef(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const onlyKey = only?.join('\n');
  const stableOnly = useMemo(() => onlyKey?.split('\n'), [onlyKey]);
  const dry = useMemo(() => addWaysIn(spec, stableOnly === undefined ? undefined : { only: stableOnly }), [spec, stableOnly]);
  const gaps = useMemo(() => waysIn(spec).filter((g) => stableOnly === undefined || stableOnly.includes(g.table)), [spec, stableOnly]);

  // The pressed button leaves the page: the keyboard goes to the button that takes its place.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (done !== null ? undoRef : addRef).current?.focus();
  }, [done]);

  const run = async (next: AppSpec, baseRevision: number, ok: (record: { revision: number }) => void): Promise<void> => {
    busy.current = true;
    setPending(true);
    try {
      const res = await save(next, { baseRevision });
      if (res.ok) {
        moved.current = true;
        ok(res.record);
      } else setNote(res.message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const add = async (): Promise<void> => {
    if (busy.current || dry.added.length === 0) return;
    await run(dry.spec, revision, (r) => {
      setDone({ text: waysInOutcome(dry), before: spec, revision: r.revision });
      setNote('');
    });
  };
  const undo = async (): Promise<void> => {
    if (busy.current || done === null) return;
    await run(done.before, done.revision, () => {
      setDone(null);
      setNote('Undone.');
    });
  };

  if (done === null && gaps.length === 0 && note === '') return null;
  const canAdd = dry.added.length > 0;
  const preview = only === undefined;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {done === null && gaps.length > 0 && (
        <p className={HINT_CLASS}>
          {noWayInLine(gaps)}
          {!canAdd && (preview ? PUT_FORM : noWayHere(gaps.length))}
        </p>
      )}
      <div role="status">
        {done !== null && <p className="text-sm text-accent-green">{done.text}</p>}
        {note !== '' && <p className={HINT_CLASS}>{note}</p>}
      </div>
      {done !== null && (
        <button ref={undoRef} type="button" className={btnSecondary} disabled={pending} onClick={() => void undo()}>
          Undo
        </button>
      )}
      {done === null && gaps.length > 0 && canAdd && (
        <button ref={addRef} type="button" className={btnSecondary} disabled={pending} onClick={() => void add()}>
          {ADD_WAY_IN}
        </button>
      )}
      {done === null && gaps.length > 0 && !canAdd && preview && (
        <button type="button" className={btnSecondary} onClick={() => chrome.go(stepPath(record.id, 'design'), { state: { ...STEP_FOCUS, addEntry: 'part:RecordForm' } })}>
          {ADD_FORM}
        </button>
      )}
    </div>
  );
}
