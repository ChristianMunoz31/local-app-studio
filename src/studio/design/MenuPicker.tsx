// Picks the app menu bar in the Look panel, above the themes (DESIGN-phase8.md 5.2): none (Classic), across the top, or down the
// side, and whether it shows words only or icons and words. With a bar on it offers "Add a button to the menu bar" (the common job)
// and says where the other parts come from. Plain words only. The menu lists the pages of the app's menu.
import { useId } from 'react';
import SegmentedRadio from '@/components/settings/SegmentedRadio';
import { btnSecondary } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import type { Menu } from '@local-app-studio/runtime/spec/schema';

export interface MenuPickerProps {
  /** The draft look of the menu block; null is Classic (no menu bar, only the drawer). The parts on the bar are not part of it. */
  value: Menu | null;
  onChange(next: Menu | null): void;
  /** How many parts sit on the menu bar (its two sides, Rows and their parts included). */
  slotCount: number;
  /** Puts a new Button at the end of the right (or bottom) side of the bar. */
  onAddButton(): void;
  /** Switches the shelf to the Features tab, where the other parts are. */
  onShowParts(): void;
}

const NONE = 'none';
const BARS = [
  { value: NONE, label: 'No menu bar' },
  { value: 'top', label: 'Across the top' },
  { value: 'side', label: 'Down the side' },
];
const STYLES = [
  { value: 'labels', label: 'Words only' },
  { value: 'icons-and-labels', label: 'Icons and words' },
];

/** The line under the bar choice while it is off: what Save does to the parts on it. Null when there is nothing to say. */
function slotHint(on: boolean, slotCount: number): string | null {
  if (on || slotCount === 0) return null;
  return `Saving with no menu bar removes the ${slotCount} ${slotCount === 1 ? 'part' : 'parts'} on it.`;
}

export default function MenuPicker({ value, onChange, slotCount, onAddButton, onShowParts }: MenuPickerProps) {
  const prefix = useId();
  const hint = slotHint(value !== null, slotCount);
  return (
    <div className="mb-5 space-y-5" data-testid="menu-picker">
      <SegmentedRadio
        legend="Menu bar"
        name={`${prefix}-bar`}
        value={value === null ? NONE : value.position}
        onChange={(next: string) => {
          if (next === NONE) onChange(null);
          else if (next === 'top' || next === 'side') onChange({ position: next, style: value?.style ?? 'icons-and-labels' });
        }}
        options={BARS}
        hint="Shows on every page of the app. Save to keep it."
      />
      {hint !== null && <p className={HINT_CLASS}>{hint}</p>}
      {value !== null && (
        <div className="space-y-2">
          <button type="button" className={btnSecondary} onClick={onAddButton}>
            Add a button to the menu bar
          </button>
          <p className={HINT_CLASS}>Other parts go on the menu bar from Features: press Add here on the bar.</p>
          <button type="button" className={btnSecondary} onClick={onShowParts}>
            Show the parts
          </button>
        </div>
      )}
      <SegmentedRadio
        legend="Menu shows"
        name={`${prefix}-style`}
        value={value === null ? 'icons-and-labels' : value.style}
        disabled={value === null}
        onChange={(next: string) => {
          if (value !== null && (next === 'labels' || next === 'icons-and-labels')) onChange({ position: value.position, style: next });
        }}
        options={STYLES}
        hint={undefined}
      />
    </div>
  );
}
