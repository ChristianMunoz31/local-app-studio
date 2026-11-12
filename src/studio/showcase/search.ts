// Search, order and grouping of the showcase entries, shared by the Features page and the Design shelf. Pure (no React).
import { CATEGORY_LABELS, CATEGORY_ORDER, SUBGROUP_LABELS } from './entries';
import type { ShowcaseCategory, ShowcaseEntry, ShowcaseSubgroup } from './entries';

export type SortChoice = 'default' | 'az' | 'new';
export type CategoryChoice = ShowcaseCategory | 'all';

export const SORT_CHOICES: readonly SortChoice[] = ['default', 'az', 'new'];
export const SORT_LABELS: Readonly<Record<SortChoice, string>> = { default: 'Default order', az: 'A to Z', new: 'Recently added' };

const MAX_WORDS = 8;
const SUBGROUP_ORDER: readonly ShowcaseSubgroup[] = ['structure', 'text', 'show', 'summarize', 'charts'];

const SCORE_NAME_PREFIX = 120;
const SCORE_NAME = 100;
const SCORE_KEYWORD = 60;
const SCORE_LABEL = 40;
const SCORE_PARAM = 30;
const SCORE_DESCRIPTION = 20;

export interface SearchHit {
  entry: ShowcaseEntry;
  score: number;
  /** Where the query matched the name, as [start, end) pairs in order without overlap. */
  nameRanges: ReadonlyArray<readonly [number, number]>;
}

export interface HitGroup {
  category: ShowcaseCategory;
  label: string;
  count: number;
  subgroups: { id: ShowcaseSubgroup | null; label: string | null; count: number; hits: SearchHit[] }[];
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** The query as lowercase words (letters and digits only), at most 8. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '')
    .slice(0, MAX_WORDS);
}

/** The first index where `word` starts the text or a word in it, or -1. `text` is lowercase. */
function matchAt(text: string, word: string): number {
  let from = 0;
  for (;;) {
    const i = text.indexOf(word, from);
    if (i === -1) return -1;
    if (i === 0 || !WORD_CHAR.test(text[i - 1])) return i;
    from = i + 1;
  }
}

const found = (texts: readonly string[], word: string): boolean => texts.some((t) => matchAt(t.toLowerCase(), word) !== -1);

function wordScore(e: ShowcaseEntry, word: string): number {
  const name = e.name.toLowerCase();
  if (name.startsWith(word)) return SCORE_NAME_PREFIX;
  if (matchAt(name, word) !== -1) return SCORE_NAME;
  if (found(e.keywords, word)) return SCORE_KEYWORD;
  const labels = [CATEGORY_LABELS[e.category], ...(e.subgroup === null ? [] : [SUBGROUP_LABELS[e.subgroup]])];
  if (found(labels, word)) return SCORE_LABEL;
  if (found(e.params.flatMap((p) => [p.label, p.words]), word)) return SCORE_PARAM;
  if (matchAt(e.description.toLowerCase(), word) !== -1) return SCORE_DESCRIPTION;
  return 0;
}

/** The entry's score for the words (the sum of each word's best field), or 0 when any word finds nothing. */
function entryScore(e: ShowcaseEntry, words: readonly string[]): number {
  let total = 0;
  for (const w of words) {
    const s = wordScore(e, w);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

function rangesOf(name: string, words: readonly string[]): Array<readonly [number, number]> {
  const lower = name.toLowerCase();
  const raw: Array<[number, number]> = [];
  for (const w of words) {
    const i = matchAt(lower, w);
    if (i !== -1) raw.push([i, i + w.length]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last !== undefined && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Entries of the category (or all) that match every word of the query, in the order asked for. */
export function searchEntries(entries: readonly ShowcaseEntry[], f: { query: string; category: CategoryChoice; sort: SortChoice }): SearchHit[] {
  const words = queryWords(f.query);
  const list: SearchHit[] = [];
  for (const entry of entries) {
    if (f.category !== 'all' && entry.category !== f.category) continue;
    const score = words.length === 0 ? 0 : entryScore(entry, words);
    if (words.length > 0 && score === 0) continue;
    list.push({ entry, score, nameRanges: words.length === 0 ? [] : rangesOf(entry.name, words) });
  }
  const order = new Map(entries.map((e, i) => [e.key, i]));
  const byCatalog = (a: SearchHit, b: SearchHit): number => (order.get(a.entry.key) ?? 0) - (order.get(b.entry.key) ?? 0);
  if (f.sort === 'az') return list.sort((a, b) => a.entry.name.localeCompare(b.entry.name) || byCatalog(a, b));
  if (f.sort === 'new') {
    // Only your own features move: they take the slots they already hold, newest first. Built-in parts keep their place.
    const slots = list.flatMap((h, i) => (h.entry.kind === 'feature' ? [i] : []));
    const moved = slots.map((i) => list[i]).sort((a, b) => (b.entry.createdAt ?? '').localeCompare(a.entry.createdAt ?? '') || byCatalog(a, b));
    slots.forEach((slot, n) => {
      list[slot] = moved[n];
    });
    return list;
  }
  return words.length === 0 ? list : list.sort((a, b) => b.score - a.score || byCatalog(a, b));
}

/** Non-empty categories in the fixed order, each split into its sub-groups; the order of the hits is kept. */
export function groupHits(list: readonly SearchHit[]): HitGroup[] {
  const groups: HitGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = list.filter((h) => h.entry.category === category);
    if (inCategory.length === 0) continue;
    const ids: Array<ShowcaseSubgroup | null> = [null, ...SUBGROUP_ORDER];
    const subgroups = ids
      .map((id) => {
        const subHits = inCategory.filter((h) => h.entry.subgroup === id);
        return { id, label: id === null ? null : SUBGROUP_LABELS[id], count: subHits.length, hits: subHits };
      })
      .filter((s) => s.count > 0);
    groups.push({ category, label: CATEGORY_LABELS[category], count: inCategory.length, subgroups });
  }
  return groups;
}

/** How many entries match the query in each category and in all of them (the category choice is ignored). */
export function categoryCounts(entries: readonly ShowcaseEntry[], query: string): Record<CategoryChoice, number> {
  const counts: Record<CategoryChoice, number> = { all: 0, layout: 0, navigation: 0, data: 0, input: 0, action: 0, custom: 0 };
  for (const h of searchEntries(entries, { query, category: 'all', sort: 'default' })) {
    counts[h.entry.category] += 1;
    counts.all += 1;
  }
  return counts;
}

/** The chips of the category choice, in order, with their counts in the label ("Data (9)"). */
export function categoryChoices(counts: Record<CategoryChoice, number>): Array<{ value: CategoryChoice; label: string }> {
  return [
    { value: 'all', label: `All (${counts.all})` },
    ...CATEGORY_ORDER.map((c): { value: CategoryChoice; label: string } => ({ value: c, label: `${CATEGORY_LABELS[c]} (${counts[c]})` })),
  ];
}

/** The entries for stored recent keys, newest first. Keys with no entry (a deleted feature) are skipped. */
export function resolveRecent(keys: readonly string[], entries: readonly ShowcaseEntry[]): ShowcaseEntry[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return keys.flatMap((k) => {
    const e = byKey.get(k);
    return e === undefined ? [] : [e];
  });
}

/** A value from the address bar as a sort choice, or 'default'. */
export function parseSort(raw: string | null): SortChoice {
  return SORT_CHOICES.find((s) => s === raw) ?? 'default';
}

/** A value from the address bar as a category choice, or 'all'. */
export function parseCategory(raw: string | null): CategoryChoice {
  return CATEGORY_ORDER.find((c) => c === raw) ?? 'all';
}
