// The words of the Data step that are about a save that cannot go through (DESIGN-phase14.md P-04, P-18). Pure.
import type { Page, SpecIssue } from '@local-app-studio/runtime/spec/schema';

export const DATA_COPY = {
  tablesNeedFix: 'Some tables need a fix before they can be saved.',
  outsideNeedFix: 'Something outside the tables needs a fix before this can be saved.',
  removeButton: 'Remove it from those parts too',
  removeNotice: 'Took it out of the parts that used it.',
  /** After a field is moved: "Moved Amount up." */
  movedField: (label: string, direction: 'up' | 'down'): string => `Moved ${label.trim() === '' ? 'the field' : label} ${direction}.`,
  /** After the parts, the link fields of other tables that pointed at a removed table (one entry per field: "Client from Jobs"). */
  removeNoticeLinks: (links: ReadonlyArray<{ field: string; table: string }>): string =>
    `Took it out of the parts that used it, and removed the link ${links.length === 1 ? 'field' : 'fields'} ${joinTitles(links.map((l) => `${l.field} from ${l.table}`))}.`,
  removeLabel: 'Removed it from the parts that used it',
  pagesListTitle: 'These pages use what you changed. Fix them in Design:',
  /** The badge on a table row that is not the selected one stays in the warning tone. */
  needsFix: 'Needs a fix',
} as const;

/** The "Needs a fix" badge on the selected (brand colour) row: the page surface with the body text colour, the same pair in both looks. */
export const NEEDS_FIX_SELECTED_BADGE = 'bg-slate-slate900 text-slate-slate100';

/** The titles of the pages the problems are on, once each, in page order. */
export function pageTitlesOf(issues: readonly SpecIssue[], pages: readonly Page[]): string[] {
  const seen = new Set<number>();
  for (const issue of issues) {
    const m = /^pages\.(\d+)(?:\.|$)/.exec(issue.path);
    if (m && pages[Number(m[1])] !== undefined) seen.add(Number(m[1]));
  }
  return [...seen].sort((a, b) => a - b).map((i) => (pages[i].title.trim() === '' ? String(i + 1) : pages[i].title));
}

const joinTitles = (titles: readonly string[]): string =>
  titles.length <= 1 ? (titles[0] ?? '') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;

/**
 * Why a save cannot go through, in words. A table with a problem is named as such; otherwise the pages that still use what was
 * removed are named. `canRemove` says the one-press "Remove it from those parts too" would fix them.
 */
export function blockedReason(issues: readonly SpecIssue[], pages: readonly Page[], tableProblem: boolean, canRemove: boolean): string {
  if (tableProblem) return DATA_COPY.tablesNeedFix;
  const titles = pageTitlesOf(issues, pages);
  if (titles.length === 0) return DATA_COPY.outsideNeedFix;
  const one = titles.length === 1;
  const subject = one ? `Page ${titles[0]} still uses` : `Pages ${joinTitles(titles)} still use`;
  const fix = one ? 'fix it in Design' : 'fix them in Design';
  return canRemove
    ? `${subject} what you removed. Press ${DATA_COPY.removeButton}, or ${fix}.`
    : `${subject} what you removed. Fix ${one ? 'it' : 'them'} in Design.`;
}
