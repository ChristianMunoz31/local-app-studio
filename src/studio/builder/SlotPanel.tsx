// The slot panel of the Feature builder: what people fill in when they add the feature. One row for each table, field, page and text
// the parts use, with the name people see, the parts that use it, and (for a table) the sample rows the canvas shows. The panel is
// plain words and form fields; the canvas history is the host's (DESIGN-phase16.md 4.4).
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FEATURE_LIMITS } from '@/catalog/features';
import { inputClass, labelClass } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import { SAMPLE_IDS, SAMPLE_TABLES } from './bench';
import type { SampleId } from './bench';
import { refusalWords } from './featureRefusal';
import type { BuilderSlot } from './slotModel';
import { PANEL_WORDS } from './words';


interface Props {
  slots: readonly BuilderSlot[];
  /** How many settings a save would have. */
  count: number;
  onRenameTable(tableId: string, label: string): void;
  onSample(tableId: string, to: SampleId): void;
  onRenameField(tableId: string, fieldId: string, label: string): void;
  /** A page or text setting's name (form state, not in the Undo history). */
  onLabel(key: string, label: string): void;
  onTick(key: string, on: boolean): void;
}

/** A box whose words are kept when the person leaves it or presses Enter, so a rename is one history step. */
function CommitBox({ id, value, onCommit }: { id: string; value: string; onCommit(next: string): void }) {
  // null while nothing is typed: the box then shows the current words, also after they changed elsewhere (Undo).
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? value;
  const commit = (): void => {
    if (typed !== null && typed.trim() !== '' && typed !== value) onCommit(typed);
    setTyped(null);
  };
  return (
    <input
      id={id}
      className={inputClass}
      value={text}
      maxLength={FEATURE_LIMITS.labelChars}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function Row({ slot, p }: { slot: BuilderSlot; p: Props }) {
  const uid = useId();
  const used = slot.uses.length > 0;
  const editableField = slot.kind === 'field' && slot.tableId !== null && slot.fieldId !== null && slot.fieldId !== 'created_at' && slot.fieldId !== 'updated_at';
  return (
    <li data-testid="slot-row" data-slot-key={slot.key} data-slot-kind={slot.kind} className="list-none">
      <div
        role="group"
        aria-labelledby={`${uid}-heading`}
        aria-describedby={used || slot.kind === 'table' ? `${uid}-used` : undefined}
        className="space-y-2 rounded-lg border border-slate-slate700/60 p-3"
      >
        <p id={`${uid}-heading`} className="text-[10px] font-semibold uppercase tracking-widest text-slate-slate400">{slot.heading}</p>
        <div>
          <label htmlFor={`${uid}-name`} className={labelClass}>
            {PANEL_WORDS.shownAs}
          </label>
          {slot.kind === 'table' && slot.tableId !== null ? (
            <CommitBox id={`${uid}-name`} value={slot.label} onCommit={(next) => p.onRenameTable(slot.tableId as string, next)} />
          ) : editableField ? (
            <CommitBox id={`${uid}-name`} value={slot.label} onCommit={(next) => p.onRenameField(slot.tableId as string, slot.fieldId as string, next)} />
          ) : (
            <input
              id={`${uid}-name`}
              className={inputClass}
              value={slot.label}
              maxLength={FEATURE_LIMITS.labelChars}
              readOnly={slot.kind === 'field'}
              onChange={(e) => p.onLabel(slot.key, e.target.value)}
            />
          )}
        </div>
        {slot.kind === 'table' && slot.tableId !== null && (
          <div>
            <label htmlFor={`${uid}-sample`} className={labelClass}>
              {PANEL_WORDS.sample}
            </label>
            <select
              id={`${uid}-sample`}
              className={inputClass}
              value={slot.sample ?? 'own'}
              onChange={(e) => {
                if (e.target.value !== 'own') p.onSample(slot.tableId as string, e.target.value as SampleId);
              }}
            >
              {SAMPLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {SAMPLE_TABLES[id].label}
                </option>
              ))}
              {slot.sample === null && <option value="own">{PANEL_WORDS.yourFields}</option>}
            </select>
          </div>
        )}
        {slot.kind === 'text' && (
          <label className="flex items-center gap-2 text-sm text-slate-slate100">
            <input type="checkbox" checked={slot.on} onChange={(e) => p.onTick(slot.key, e.target.checked)} />
            {PANEL_WORDS.tick}
          </label>
        )}
        {(used || slot.kind === 'table') && (
          <p id={`${uid}-used`} className={HINT_CLASS}>
            {used ? PANEL_WORDS.usedBy(slot.uses) : PANEL_WORDS.notUsed}
          </p>
        )}
      </div>
    </li>
  );
}

export default function SlotPanel(p: Props) {
  const over = p.count > FEATURE_LIMITS.params;
  const headingId = useId();
  const words = refusalWords('feature_too_many_settings');
  return (
    <section aria-labelledby={headingId} data-testid="slot-panel" className="space-y-3 rounded-lg border border-slate-slate700/60 p-3">
      <h2 id={headingId} className="text-sm font-bold text-slate-slate100">
        {PANEL_WORDS.title}
      </h2>
      <p className={HINT_CLASS}>{PANEL_WORDS.subtitle}</p>
      <p data-testid="slot-count" className={over ? 'text-sm text-accent-amber' : 'text-sm text-slate-slate200'}>
        {PANEL_WORDS.count(p.count)}
        {over ? ` ${words.sentence} ${words.action}` : ''}
      </p>
      {p.slots.length === 0 ? (
        <p className="text-sm text-slate-slate400">{PANEL_WORDS.empty}</p>
      ) : (
        <ul className="space-y-3">
          {p.slots.map((slot) => (
            <Row key={slot.key} slot={slot} p={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
