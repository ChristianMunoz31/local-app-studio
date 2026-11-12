// The Place section of the settings of a part placed freely on a grid (docs/DESIGN.md "Parts placed freely on a grid"): Column,
// Width in columns, Row and Height in rows as number boxes, and "Fill the row". A box commits on blur and on Enter; the arrow keys
// and the spinner buttons commit at once. A refusal is one role="alert" line, tied to the box that failed. These boxes are the
// documented Alt-free way to move and resize a part.
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { GRID_LIMITS } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import { fillRow, placeOf, setPlace } from '../lib/gridLayout';
import { PLACE_WORDS, heightWords, limitWords, movedWords, numberProblem, placeLine, widthWords, withNarrow } from '../lib/gridWords';
import type { PlaceField } from '../lib/gridWords';
import { blockName } from './designLabels';
import { useDesign } from './DesignContext';
import { narrowGrid } from './gridMetrics';
import { placeRefusal } from './gridSteps';

const FIELDS: readonly PlaceField[] = ['col', 'span', 'row', 'rowSpan'];

const nameOf = (layer: LayoutLayer, parent: LayoutLayer | null): string => blockName(layer, parent);

const limits = (field: PlaceField, p: GridPlace): { min: number; max: number } => {
  if (field === 'col') return { min: 1, max: GRID_LIMITS.columns + 1 - p.span };
  if (field === 'span') return { min: 1, max: GRID_LIMITS.columns + 1 - p.col };
  if (field === 'row') return { min: 1, max: GRID_LIMITS.maxRow + 1 - p.rowSpan };
  return { min: 1, max: Math.min(GRID_LIMITS.maxRowSpan, GRID_LIMITS.maxRow + 1 - p.row) };
};

const draftsOf = (p: GridPlace | null): Record<PlaceField, string> => ({
  col: String(p?.col ?? ''),
  span: String(p?.span ?? ''),
  row: String(p?.row ?? ''),
  rowSpan: String(p?.rowSpan ?? ''),
});

interface Problem {
  /** The box that failed, or null for the Fill the row button. */
  field: PlaceField | null;
  text: string;
  /** Bumped on every problem, so the alert line remounts and the same words are spoken again. */
  n: number;
}

export default function PlaceSettings({ layer }: { layer: LayoutLayer; name: string }) {
  const uid = useId();
  const { root, apply, announceGrid } = useDesign();
  const place = placeOf(root, layer.id);
  const signature = place === null ? 'none' : `${place.col}:${place.span}:${place.row}:${place.rowSpan}`;
  const [synced, setSynced] = useState(signature);
  const [drafts, setDrafts] = useState(() => draftsOf(place));
  const [problem, setProblem] = useState<Problem | null>(null);
  const stepping = useRef(false);
  // The last box text that failed on Enter: the blur that follows must not commit (and speak) the same bad text again.
  const lastFailed = useRef<{ field: PlaceField; text: string } | null>(null);
  if (synced !== signature) {
    setSynced(signature);
    setDrafts(draftsOf(place));
  }
  if (place === null) return null;

  const hintId = `${uid}-hint`;
  const problemId = `${uid}-problem`;
  const fillHintId = `${uid}-fill`;

  const fail = (field: PlaceField | null, text: string): void => setProblem((prev) => ({ field, text, n: (prev?.n ?? 0) + 1 }));
  const resetDraft = (field: PlaceField): void => setDrafts((d) => ({ ...d, [field]: String(place[field]) }));

  const commit = (field: PlaceField, text: string, from: 'blur' | 'enter' | 'step'): void => {
    const { min, max } = limits(field, place);
    const n = Number(text);
    if (from === 'blur' && lastFailed.current?.field === field && lastFailed.current.text === text) return;
    lastFailed.current = null;
    const failed = (words: string): void => {
      fail(field, words);
      if (from === 'enter') lastFailed.current = { field, text };
      else resetDraft(field);
    };
    if (text.trim() === '' || !Number.isInteger(n)) return failed(numberProblem(min, max));
    if (n < min || n > max) return failed(limitWords(field, place));
    if (n === place[field]) {
      resetDraft(field);
      return;
    }
    const next: GridPlace = { ...place, [field]: n };
    const result = setPlace(root, layer.id, next);
    if (!result.ok) return failed(placeRefusal(root, layer.id, next, nameOf) ?? result.message);
    const refusal = apply(result);
    if (refusal !== null) return failed(refusal);
    setProblem(null);
    const now = placeOf(result.root, layer.id) ?? next;
    let words: string;
    if (field === 'col' || field === 'row') words = movedWords(now);
    else words = field === 'span' ? widthWords(now) : heightWords(now);
    announceGrid(withNarrow(words, narrowGrid()), 'step');
  };

  const fill = (): void => {
    const result = fillRow(root, layer.id);
    if (!result.ok) return fail(null, placeRefusal(root, layer.id, { ...place, col: 1, span: GRID_LIMITS.columns }, nameOf) ?? result.message);
    if (result.root === root) return;
    const refusal = apply(result);
    if (refusal !== null) return fail(null, refusal);
    setProblem(null);
    const now = placeOf(result.root, layer.id);
    if (now !== null) announceGrid(withNarrow(widthWords(now), narrowGrid()), 'step');
  };

  const onKeyDown = (field: PlaceField, e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(field, drafts[field], 'enter');
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      commit(field, String(place[field] + (e.key === 'ArrowUp' ? 1 : -1)), 'step');
    }
  };

  return (
    <fieldset data-testid="place-settings" className="space-y-2 border-t border-slate-slate700 pt-3">
      <legend className={labelClass}>{PLACE_WORDS.heading}</legend>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((field) => {
          const { min, max } = limits(field, place);
          const failed = problem?.field === field;
          return (
            <div key={field} data-setting-target={`place.${field}`}>
              <label htmlFor={`${uid}-${field}`} className={labelClass}>
                {PLACE_WORDS[field]}
              </label>
              <input
                id={`${uid}-${field}`}
                data-place-field={field}
                type="number"
                inputMode="numeric"
                step={1}
                min={min}
                max={max}
                className={inputClass}
                value={drafts[field]}
                aria-invalid={failed ? 'true' : undefined}
                aria-describedby={failed ? `${hintId} ${problemId}` : hintId}
                onPointerDown={() => {
                  stepping.current = true;
                }}
                onPointerUp={() => {
                  stepping.current = false;
                }}
                onPointerCancel={() => {
                  stepping.current = false;
                }}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrafts((d) => ({ ...d, [field]: value }));
                  if (failed) setProblem(null);
                  if (stepping.current) commit(field, value, 'step');
                }}
                onKeyDown={(e) => onKeyDown(field, e)}
                onBlur={(e) => {
                  stepping.current = false;
                  commit(field, e.target.value, 'blur');
                }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-slate300">{placeLine(place)}</p>
      <p id={hintId} className={HINT_CLASS}>
        {PLACE_WORDS.hint}
      </p>
      <div className="flex justify-end">
        <button type="button" className={btnSecondary} aria-describedby={fillHintId} onClick={fill}>
          {PLACE_WORDS.fillRow}
        </button>
      </div>
      <p id={fillHintId} className={HINT_CLASS}>
        {PLACE_WORDS.fillRowHint}
      </p>
      {problem !== null && (
        <p key={problem.n} id={problemId} role="alert" className={formErrorClass}>
          {problem.text}
        </p>
      )}
    </fieldset>
  );
}
