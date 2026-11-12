// Colors are the studio-only --studio-pill-* pairs (index.css), not the accent tokens, because ThemeScope overrides those on the canvas.
// The one indicator pill: "Connected to Crews", "Needs a table", "Needs a yes or no field" or, in the Feature builder, "Uses slot Crews".
// On the canvas a connected or slot pill is the Change table button (`onChange`): its name is the visible words plus
// ". Change table" (WCAG 2.5.3), set with aria-label so every browser computes the same name. Everywhere else it is a plain pill: the words are what a screen reader reads.
import { PILL } from '@/components/settings/pillStyles.js';
import { FOCUS_RING } from '../components/ui';
import { NEWER_VERSION } from './indicator';
import type { PartIndicator } from './indicator';

interface Props {
  indicator: PartIndicator;
  /** Connected or slot on the canvas: the pill is the Change table button. Absent: a plain pill. */
  onChange?(): void;
  /** The pill does not name a table (a feature block that needs one): the button opens the settings, not Change table. */
  opensSettings?: boolean;
  /** Tile size: no button, truncates. */
  size?: 'md' | 'sm';
}

/** What a button pill adds to its words for a screen reader (WCAG 2.5.3: the name starts with the visible words). */
export const OPEN_SETTINGS_SUFFIX = '. Open settings';
export const CHANGE_TABLE_SUFFIX = '. Change table';

const WARN_TONE = 'bg-[rgb(var(--studio-pill-warn-bg))] text-[rgb(var(--studio-pill-warn-fg))]';

const TONE: Readonly<Record<PartIndicator['state'], string>> = {
  connected: 'bg-[rgb(var(--studio-pill-ok-bg))] text-[rgb(var(--studio-pill-ok-fg))]',
  slot: 'bg-[rgb(var(--studio-pill-muted-bg))] text-[rgb(var(--studio-pill-muted-fg))]',
  needs_table: WARN_TONE,
  needs_field: WARN_TONE,
};

export default function ConnectionBadge({ indicator, onChange, opensSettings = false, size = 'md' }: Props) {
  const tone = `${PILL} ${TONE[indicator.state]} max-w-full whitespace-normal break-words`;
  const table = indicator.state === 'connected' || indicator.state === 'slot' ? indicator.table : undefined;
  const data = { 'data-indicator': indicator.state, ...(table === undefined ? {} : { 'data-connection-badge': table }) };
  if (onChange === undefined || (table === undefined && !opensSettings) || size === 'sm') {
    return (
      <span {...data} title={indicator.text} className={tone}>
        {indicator.text}
      </span>
    );
  }
  return (
    <button
      type="button"
      {...data}
      aria-label={`${indicator.text}${table === undefined ? OPEN_SETTINGS_SUFFIX : CHANGE_TABLE_SUFFIX}`}
      className={`${tone} ${FOCUS_RING} cursor-pointer forced-colors:border hover:underline`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      {indicator.text}
    </button>
  );
}

/** "Newer version" beside the connection pill of a feature block that is behind its library. With `onOpen` it is a button that opens the block's settings. */
export function NewerVersionPill({ onOpen }: { onOpen?(): void }) {
  const tone = `${PILL} ${WARN_TONE} max-w-full whitespace-normal break-words`;
  if (onOpen === undefined) {
    return (
      <span data-indicator="newer_version" title={NEWER_VERSION} className={tone}>
        {NEWER_VERSION}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-indicator="newer_version"
      aria-label={`${NEWER_VERSION}${OPEN_SETTINGS_SUFFIX}`}
      className={`${tone} ${FOCUS_RING} cursor-pointer forced-colors:border hover:underline`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {NEWER_VERSION}
    </button>
  );
}
