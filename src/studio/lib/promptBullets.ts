// The bullets of the Prompt step's review pane (DESIGN-phase16.md 1.5). Pure, no React. One walk with summarizeSpec
// (pagePhrases), two wordings: the bullets use the grammar of the Design page strip and never a code word.
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber';
import { isFreeGridLayer } from '@local-app-studio/runtime/spec/gridPlacement';
import { ruleSentence } from '@local-app-studio/runtime/spec/rules';
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import type { PartNeed } from '../design/indicator';
import { FIELD_TYPE_NAMES, isPlaceChange } from './specDiff';
import type { SpecChange } from './specDiff';
import { pagePhrases, pageUsesSource, summarizeSpec } from './specSummary';
import type { PartPhrase } from './specSummary';

export interface Bullet {
  /** The visible sentence: no full stop for a list item, a full stop for a page bullet (two sentences at most). */
  text: string;
  /** Extra words for the title attribute and the Show everything fold (field types), or null. */
  detail: string | null;
}

export interface BulletInput {
  /** The proposal, or the saved app for the idle "Your app" view. */
  spec: AppSpec;
  /** The saved app when this is an edit proposal, else null (create, or the idle view). */
  before: AppSpec | null;
  /** diffSpecs(before, spec) for an edit proposal, else []. */
  changes: readonly SpecChange[];
  /** specNeeds(spec) from src/studio/design/indicator.ts. */
  needs: readonly PartNeed[];
}

export interface PromptBullets {
  lead: string;
  tables: Bullet[];
  pages: Bullet[];
  look: string | null;
  menu: string | null;
  changes: string[];
  /** How many change bullets are not shown (more than CHANGES_SHOWN). */
  moreChanges: number;
}

export const CHANGES_SHOWN = 8;
/** Place lines shown before the rest are counted ("and 2 more parts moved or placed"). */
export const PLACES_SHOWN = 4;
/** Shown when a page's layout changed around free Grids and no part moved or was resized on them. */
export const NOTHING_MOVED = 'Nothing moved on the grid';
const FIELDS_SHOWN = 6;
const PHRASES_SHOWN = 4;
const TABLES_IN_LEAD = 3;

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/** "A, B and C"; one item is itself. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "a" or "an" in front of a word by its sound ("an Items list", "a Units list": u said "you" takes "a"). */
const article = (word: string): string => (/^[aeiou]/i.test(word) && !/^(?:uni|use|usu|uti|eu|one)/i.test(word) ? 'an' : 'a');

/** The words of one phrase; `named` holds the tables this bullet already printed, which are not named again. */
function phraseWords(phrase: PartPhrase, named: Set<string>): string {
  const t = phrase.table !== null && !named.has(phrase.table) ? phrase.table : null;
  // A table counts as named only when the words print it (a Chart, a labelled number or a feature do not).
  const printed = (): void => {
    if (t !== null) named.add(t);
  };
  switch (phrase.kind) {
    case 'list':
      printed();
      return t === null ? 'a list' : `${article(t)} ${t} list`;
    case 'form':
      printed();
      return t === null ? 'a form' : `${article(t)} ${t} form`;
    case 'record':
      printed();
      return t === null ? 'one record' : `one ${t} record`;
    case 'number':
      if (phrase.label !== null) return `the number ${phrase.label}`;
      printed();
      return t === null ? 'a count' : `a count of ${t}`;
    case 'filters':
      printed();
      return t === null ? 'filters' : `${t} filters`;
    case 'search':
      printed();
      return t === null ? 'a search box' : `${article(t)} ${t} search box`;
    case 'feature':
      return `your feature ${phrase.label ?? phrase.part}`;
    case 'data':
      return `${article(phrase.part)} ${phrase.part}`;
  }
}

/** "a, b and c"; past four phrases: "a, b, c, d and 2 more". */
function phrasesText(phrases: readonly PartPhrase[]): string {
  const named = new Set<string>();
  const shown = phrases.slice(0, PHRASES_SHOWN).map((p) => phraseWords(p, named));
  const more = phrases.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : andList(shown);
}

function pageBulletOf(spec: AppSpec, page: Page): string {
  const phrases = pagePhrases(spec, page);
  const body = phrases.length === 0 ? `${page.title} has words only.` : `${page.title} shows ${phrasesText(phrases)}.`;
  if (page.route.includes('/:')) return `${body} It opens from a list.`;
  return spec.nav.some((n) => n.pageId === page.id) ? body : `${body} It is not in the menu.`;
}

/** The one page bullet for the Design page strip (section 2.3): "Home shows a Crews list." */
export function pageBullet(spec: AppSpec, pageId: string): string | null {
  const page = spec.pages.find((p) => p.id === pageId);
  return page === undefined ? null : pageBulletOf(spec, page);
}

function tableBullet(spec: AppSpec, table: AppSpec['tables'][number]): Bullet {
  const labels = table.fields.slice(0, FIELDS_SHOWN).map((f) => f.label);
  const more = table.fields.length - labels.length;
  const fields = table.fields.length === 0 ? 'no fields yet' : more > 0 ? `${labels.join(', ')} and ${more} more` : labels.join(', ');
  const typed = table.fields.map((f) => {
    const kind = f.type === 'reference' ? `link to ${spec.tables.find((t) => t.id === f.table)?.label ?? 'your data'}` : FIELD_TYPE_NAMES[f.type];
    return `${f.label} (${kind})`;
  });
  return { text: `${table.label}: ${fields}`, detail: typed.length === 0 ? null : `${table.label}: ${typed.join(', ')}` };
}

const PAST: Readonly<Record<string, string>> = {
  Adds: 'Added',
  Removes: 'Removed',
  Changes: 'Changed',
  Renames: 'Renamed',
  Makes: 'Made',
  Sets: 'Set',
  Reorders: 'Reordered',
  Shows: 'Showed',
  Stops: 'Stopped',
  Places: 'Placed',
  Moves: 'Moved',
  Turns: 'Turned',
};

const FIELD_PATH = /^tables\.([^.]+)\.fields\.([^.]+)$/;

/** One change as a past tense bullet. */
function changeBullet(spec: AppSpec, change: SpecChange): string {
  if (change.kind === 'added' && change.area === 'field') {
    const m = FIELD_PATH.exec(change.path);
    const table = m === null ? undefined : spec.tables.find((t) => t.id === m[1]);
    const field = table?.fields.find((f) => f.id === m?.[2]);
    if (table !== undefined && field !== undefined) return `Added ${article(field.label)} ${field.label} field to ${table.label}`;
  }
  if (change.kind === 'added' && change.area === 'table') {
    const table = spec.tables.find((t) => `tables.${t.id}` === change.path);
    if (table !== undefined) return `Added the table ${table.label}`;
  }
  const plain = change.sentence.replace(/"/g, '').replace(/\.$/, '');
  const space = plain.indexOf(' ');
  const first = space < 0 ? plain : plain.slice(0, space);
  const past = PAST[first];
  return past === undefined ? plain : `${past}${plain.slice(first.length)}`;
}

const SOURCE_PATH = /^pages\.([^.]+)\.sources\.([^.]+)$/;

/** An added or changed source no layer of its page reads is not a list on the page, so no bullet says so. */
function isSeen(spec: AppSpec, c: SpecChange): boolean {
  const m = c.area === 'source' && c.kind !== 'removed' ? SOURCE_PATH.exec(c.path) : null;
  const page = m === null ? undefined : spec.pages.find((p) => p.id === m[1]);
  return page === undefined || pageUsesSource(page, m?.[2] ?? '');
}

/** The first CHANGES_SHOWN changes as past tense bullets, and how many more there are (the "It also changed" list of an ask). Place changes have their own list (placeBullets). */
export function changeBullets(spec: AppSpec, changes: readonly SpecChange[]): { shown: string[]; more: number } {
  const own = changes.filter((c) => !isPlaceChange(c) && isSeen(spec, c));
  return { shown: own.slice(0, CHANGES_SHOWN).map((c) => changeBullet(spec, c)), more: Math.max(0, own.length - CHANGES_SHOWN) };
}

/**
 * The automations a proposal removed or added, and the field it numbers or no longer numbers, per table both designs have (P1: from the
 * two designs only). The helper never writes them, so in practice only a rule an edit broke and code dropped shows here.
 */
export function automationBullets(before: AppSpec, after: AppSpec): string[] {
  const out: string[] = [];
  for (const table of after.tables) {
    const was = before.tables.find((t) => t.id === table.id);
    if (was === undefined) continue;
    const sentences = (t: AppSpec['tables'][number]): Map<string, string> => new Map((t.rules ?? []).map((r) => [JSON.stringify(r), ruleSentence(t, r)]));
    const old = sentences(was);
    const now = sentences(table);
    for (const [key, text] of old) if (!now.has(key)) out.push(`Automation removed: ${text}`);
    for (const [key, text] of now) if (!old.has(key)) out.push(`Automation added: ${text}`);
    const labelOf = (t: AppSpec['tables'][number], id: string): string => t.fields.find((f) => f.id === id)?.label ?? id;
    const a = readAutoNumber(was)?.field;
    const b = readAutoNumber(table)?.field;
    if (b !== undefined && b !== a) out.push(`Numbered automatically: ${labelOf(table, b)}.`);
    if (a !== undefined && a !== b) out.push(`No longer numbered automatically: ${labelOf(was, a)}.`);
  }
  return out;
}

/** The free Grids of a layout by id, each with the ids of its children (a feature block's inside is not walked). */
function freeGrids(root: LayoutLayer): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const stack: LayoutLayer[] = [root];
  for (let layer = stack.pop(); layer !== undefined; layer = stack.pop()) {
    if (layer.feature !== undefined || !Array.isArray(layer.children)) continue;
    if (isFreeGridLayer(layer)) out.set(layer.id, new Set(layer.children.map((c) => c.id)));
    stack.push(...layer.children);
  }
  return out;
}

/** A page whose layout changed, with a Grid free on both sides that kept a child, and no part of it moved or was resized. */
function nothingMoved(before: AppSpec, after: AppSpec, changes: readonly SpecChange[]): boolean {
  return after.pages.some((page) => {
    const prev = before.pages.find((p) => p.id === page.id);
    if (prev === undefined || !changes.some((c) => c.area === 'page' && c.path === `pages.${page.id}.layout`)) return false;
    if (changes.some((c) => c.area === 'page' && c.path.startsWith(`pages.${page.id}.layout.`) && c.path.endsWith('.grid'))) return false;
    const was = freeGrids(prev.layout);
    for (const [id, kids] of freeGrids(page.layout)) {
      const old = was.get(id);
      if (old !== undefined && [...kids].some((k) => old.has(k))) return true;
    }
    return false;
  });
}

/** The place changes as past tense lines (no full stop): the first PLACES_SHOWN, a "more" line, and NOTHING_MOVED when a grid page changed and nothing moved. At most 6 lines. */
export function placeBullets(before: AppSpec, after: AppSpec, changes: readonly SpecChange[]): string[] {
  const own = changes.filter(isPlaceChange);
  const out = own.slice(0, PLACES_SHOWN).map((c) => changeBullet(after, c));
  // Count parts, not lines: the "more places" line and a grouped line each stand for several parts.
  const more = own.slice(PLACES_SHOWN).reduce((n, c) => n + (c.parts ?? 1), 0);
  if (more > 0) out.push(`and ${more} more ${more === 1 ? 'part' : 'parts'} moved or placed`);
  if (nothingMoved(before, after, changes)) out.push(NOTHING_MOVED);
  return out;
}

/** The person's words for the review: whole when they fit `max`, else cut at a word with "..." and never in the middle of a word. */
export function shortQuote(text: string, max: number): string {
  const words = text.trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max);
  const atWord = /\s/.test(words.charAt(max)) ? cut : cut.replace(/\s+\S*$/, '');
  const kept = (atWord === '' ? cut : atWord).replace(/[\s,;:]+$/, '');
  return `${kept}...`;
}

export function promptBullets({ spec, before, changes, needs }: BulletInput): PromptBullets {
  const summary = summarizeSpec(spec);
  const beforeSummary = before === null ? null : summarizeSpec(before);
  const pageCount = spec.pages.length;
  const tableCount = spec.tables.length;
  // Only a table some page shows is "kept on" the pages; the rest get a plain line (a page that shows none of them is not a home for them).
  const shownLabels = new Set(spec.pages.flatMap((p) => pagePhrases(spec, p).flatMap((ph) => (ph.table === null ? [] : [ph.table]))));
  const onPages = spec.tables.filter((t) => shownLabels.has(t.label));
  const offPages = spec.tables.filter((t) => !shownLabels.has(t.label));
  const [a, b] = onPages;
  const tableList =
    onPages.length <= TABLES_IN_LEAD
      ? andList(onPages.map((t) => t.label))
      : offPages.length === 0
        ? `${tableCount} tables`
        : `${a.label}, ${b.label} and ${onPages.length - 2} more`;
  const offList = offPages.length <= TABLES_IN_LEAD ? andList(offPages.map((t) => t.label)) : `${offPages.length} of the tables`;
  const noPage = offPages.length === 0 ? '' : ` No page shows ${offList} yet.`;
  const lead =
    tableCount === 0
      ? `${spec.app.name} has ${plural(pageCount, 'page')} and no tables yet.`
      : onPages.length === 0
        ? `${spec.app.name} has ${plural(pageCount, 'page')} and ${plural(tableCount, 'table')}.${noPage}`
        : `${spec.app.name} keeps ${tableList} on ${plural(pageCount, 'page')}.${noPage}`;

  const tables = spec.tables.map((t) => tableBullet(spec, t));

  // Menu pages first, the order SummaryLines uses; a part that cannot connect follows its page.
  const menuFirst = [...spec.pages].sort((a, b) => Number(spec.nav.some((n) => n.pageId === b.id)) - Number(spec.nav.some((n) => n.pageId === a.id)));
  const pages: Bullet[] = [];
  for (const page of menuFirst) {
    pages.push({ text: pageBulletOf(spec, page), detail: null });
    for (const need of needs) {
      if (need.pageId === page.id) pages.push({ text: `${page.title}: ${article(need.part)} ${need.part} that ${need.text}`, detail: null });
    }
  }

  const theme = summary.theme !== null && summary.theme !== beforeSummary?.theme ? summary.theme : null;
  const menu = summary.menu !== null && summary.menu !== beforeSummary?.menu ? summary.menu : null;
  const own = changes.filter((c) => !isPlaceChange(c) && isSeen(spec, c));
  const automations = before === null ? [] : automationBullets(before, spec);
  const shown = before === null ? [] : [...automations, ...own.map((c) => changeBullet(spec, c))].slice(0, CHANGES_SHOWN);
  return {
    lead,
    tables,
    pages,
    look: theme === null ? null : `Look: ${theme}`,
    menu: menu === null ? null : `Menu bar: ${menu}`,
    changes: shown,
    moreChanges: before === null ? 0 : Math.max(0, automations.length + own.length - CHANGES_SHOWN),
  };
}
