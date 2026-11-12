// Shared enums for part props (docs/CATALOG.md, "Shared enums"). Pure. Styling is only ever chosen through these
// values; each maps to a kit token in the part components (docs/DESIGN.md).
import * as z from 'zod';
import { ICONS } from '@local-app-studio/runtime/spec/schema.ts';
import type { FieldType } from '@local-app-studio/runtime/spec/schema.ts';

export const TONES = ['neutral', 'muted', 'accent', 'success', 'warning', 'danger'] as const;
export type Tone = (typeof TONES)[number];

export const SIZES = ['sm', 'md', 'lg'] as const;
export type Size = (typeof SIZES)[number];

export const PAGE_WIDTHS = ['narrow', 'normal', 'wide'] as const;
export const SECTION_VARIANTS = ['card', 'plain'] as const;
export const CARD_VARIANTS = ['subtle', 'outline'] as const;
export const BUTTON_VARIANTS = ['primary', 'secondary', 'danger'] as const;
export const BUTTON_SIZES = ['sm', 'md'] as const;
export const TEXT_SIZES = ['sm', 'md'] as const;
/** Gap of a Grid and spacing of a Divider. */
export const GAPS = ['sm', 'md', 'lg'] as const;
export const GRID_COLUMNS = [1, 2, 3, 4] as const;
export const PAGE_SIZES = [10, 25, 50] as const;
export const STATS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type Stat = (typeof STATS)[number];
export const FORM_MODES = ['create', 'edit'] as const;

/** Widths of the Columns part; `equal` with three columns is thirds. */
export const COLUMN_LAYOUTS = ['equal', 'wide-left', 'wide-right', 'sidebar-left', 'sidebar-right'] as const;
export const COLUMN_ALIGNS = ['top', 'center', 'stretch'] as const;
export const ROW_JUSTIFY = ['start', 'between', 'end'] as const;
export const ROW_WRAP = ['wrap', 'one-line'] as const;
export const NAV_SHOW = ['menu', 'pages'] as const;
export const DIRECTIONS = ['horizontal', 'vertical'] as const;
export const ICON_DISPLAY = ['show', 'hide'] as const;
export const CALLOUT_TONES = ['note', 'success', 'warning', 'danger'] as const;
export const OPEN_STATES = ['closed', 'open'] as const;
export const CHART_KINDS = ['bar', 'line'] as const;
export const CHART_MEASURES = ['count', 'sum', 'avg'] as const;
export const DATE_BUCKETS = ['day', 'month'] as const;
export const PROGRESS_STATS = ['count', 'sum'] as const;
export const TIME_ORDERS = ['newest', 'oldest'] as const;
/** Field types a Chart groups by. */
export const GROUP_FIELD_TYPES: FieldType[] = ['select', 'boolean', 'date', 'datetime', 'reference'];
/** Field types a SortControl offers. */
export const SORT_FIELD_TYPES: FieldType[] = ['text', 'integer', 'real', 'date', 'datetime', 'select'];
/** How many Column parts a Columns part holds. */
export const COLUMN_COUNT = { min: 2, max: 4 } as const;
export const PROGRESS_TARGET_MAX = 1_000_000_000;
/** Groups a Chart shows; the server returns the rest as one "other" row. */
export const MAX_CHART_GROUPS = 12;

export { ICONS };
export type IconName = (typeof ICONS)[number];

export const toneSchema = z.enum(TONES);
export const iconSchema = z.enum(ICONS);
