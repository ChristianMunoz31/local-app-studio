// Kit tokens each enum value maps to (docs/CATALOG.md "Shared enums", docs/DESIGN.md). Parts never take a class name from
// the model: they only pick from these maps.
import type { Tone } from '../../../../../src/catalog/enums.ts';

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'text-slate-slate100',
  muted: 'text-slate-slate400',
  accent: 'text-accent-indigo',
  success: 'text-accent-green',
  warning: 'text-accent-amber',
  danger: 'text-accent-red',
};

/** Joins class names, skipping empty ones. `className` is the editor's own (drop-zone helper), never the model's. */
export const cx = (...names: Array<string | false | null | undefined>): string => names.filter(Boolean).join(' ');
