// A readable diff between two AppSpecs (DESIGN-phase3.md 7.5). Pure and deterministic; the sentences are plain words.
// Order: app, tables (after order, then removed), fields per table, pages, sources per page, nav, menu bar, theme.
import type { AppSpec, Field, FieldType, LayoutLayer, Page, Source, Table } from '@local-app-studio/runtime/spec/schema';
import { isFreeGridLayer, readGrid, readingOrder } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import { readSizing, samePlacement } from '@local-app-studio/runtime/spec/sizing';
import { sanitizeTheme, themeLabel } from '@local-app-studio/runtime/theme';
import { partLabel } from '@/studio/showcase/entries';
import { isPlaceChange } from './askOutcome';
import { FREE_WORDS, cellWords, columnsWide, rowsHigh } from './gridWords';
import { sizingChange } from './sizingWords';
import { stableJson } from './stableJson';

export { isPlaceChange };

export type ChangeKind = 'added' | 'removed' | 'changed';
export type ChangeArea = 'app' | 'table' | 'field' | 'page' | 'source' | 'nav' | 'menu' | 'theme';
export interface SpecChange {
  kind: ChangeKind;
  area: ChangeArea;
  path: string;
  sentence: string;
  destructive: boolean;
  /** Place changes only: how many parts the line stands for (absent means one). */
  parts?: number;
}

/** The type words shown to people. */
export const FIELD_TYPE_NAMES: Record<FieldType, string> = {
  text: 'text',
  longtext: 'long text',
  integer: 'whole number',
  real: 'number',
  boolean: 'yes or no',
  date: 'date',
  datetime: 'date and time',
  select: 'choice',
  reference: 'link',
};

const q = (text: string): string => `"${text}"`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function tableLabelIn(spec: AppSpec, id: string): string {
  return spec.tables.find((t) => t.id === id)?.label ?? id;
}

function typeWords(field: Field, spec: AppSpec): string {
  if (field.type === 'select') return `choice of: ${field.options.join(', ')}`;
  if (field.type === 'reference') return `link to ${q(tableLabelIn(spec, field.table))}`;
  return FIELD_TYPE_NAMES[field.type];
}

/** The type as a short phrase inside a "from X to Y" sentence. */
function shortType(field: Field, spec: AppSpec): string {
  if (field.type === 'reference') return `link to ${q(tableLabelIn(spec, field.table))}`;
  return FIELD_TYPE_NAMES[field.type];
}

function defaultOf(field: Field): string | number | boolean | undefined {
  return field.type === 'reference' ? undefined : field.default;
}

const show = (v: string | number | boolean): string => (typeof v === 'string' ? q(v) : String(v));

function countLayers(layer: LayoutLayer): number {
  return 1 + (Array.isArray(layer.children) ? layer.children.reduce((n, c) => n + countLayers(c), 0) : 0);
}

/** Width sentences shown per page before the rest are counted in one sentence. */
const SIZING_SHOWN = 6;

/** Layers by id in document order, a feature block's subtree left out (the block root itself is kept). Iterative. */
function placedLayers(root: LayoutLayer): Map<string, LayoutLayer> {
  const out = new Map<string, LayoutLayer>();
  const stack: LayoutLayer[] = [root];
  for (let layer = stack.pop(); layer !== undefined; layer = stack.pop()) {
    if (!out.has(layer.id)) out.set(layer.id, layer);
    if (layer.feature !== undefined || !Array.isArray(layer.children)) continue;
    for (let i = layer.children.length - 1; i >= 0; i -= 1) stack.push(layer.children[i]);
  }
  return out;
}

/** The layers present on both sides with the same type whose placement draws differently (every whole row is the same), in document order of `after`. */
function resizedLayers(before: LayoutLayer, after: LayoutLayer): LayoutLayer[] {
  const old = placedLayers(before);
  const out: LayoutLayer[] = [];
  for (const layer of placedLayers(after).values()) {
    const prev = old.get(layer.id);
    if (prev === undefined || prev.type !== layer.type) continue;
    if (!samePlacement(readSizing(prev.sizing), readSizing(layer.sizing))) out.push(layer);
  }
  return out;
}

/** Place sentences shown per page before the rest are counted in one sentence. */
export const PLACE_DIFF_SHOWN = 6;

interface PlaceLine {
  kind: ChangeKind;
  path: string;
  sentence: string;
  /** How many parts the line stands for (a grouped line stands for several). */
  parts: number;
  /** Plain moves with the same group key (name and place) are joined into one line. */
  group?: string;
}

const rowName = (row: number): string => (row === 1 ? 'the top row' : `row ${row}`);
const pluralName = (name: string): string => (/(?:s|x|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`);
const sameSize = (a: GridPlace, b: GridPlace): boolean => a.span === b.span && a.rowSpan === b.rowSpan;
const sameCorner = (a: GridPlace, b: GridPlace): boolean => a.col === b.col && a.row === b.row;
const layerName = (layer: LayoutLayer): string => layer.name ?? partLabel(layer.type);
const isFree = (layer: LayoutLayer | undefined): boolean => layer !== undefined && isFreeGridLayer(layer);
const childList = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);

/** A moved part's place in words: the row, the column, or both. */
function whereWords(prev: GridPlace, next: GridPlace): string {
  if (prev.col === next.col) return rowName(next.row);
  if (prev.row === next.row) return `column ${next.col}`;
  return `column ${next.col} of ${rowName(next.row)}`;
}

/** The new size in words, only what changed ("3 columns wide and 2 rows high"). */
function sizeWords(prev: GridPlace, next: GridPlace): string {
  const out: string[] = [];
  if (prev.span !== next.span) out.push(columnsWide(next.span));
  if (prev.rowSpan !== next.rowSpan) out.push(rowsHigh(next.rowSpan));
  return out.join(' and ');
}

/** Place sentences of a page that is new: one line when it holds a free Grid. */
function placedPageLine(page: Page): PlaceLine | null {
  let n = 0;
  for (const layer of placedLayers(page.layout).values()) if (isFree(layer)) n += childList(layer).length;
  return n === 0 ? null : { kind: 'added', path: `pages.${page.id}.layout.place`, sentence: `Places ${plural(n, 'part')} in a grid on ${page.title}.`, parts: n };
}

/** The place sentences of a page present on both sides (docs/DESIGN.md "Review place words"), in the order they are shown. */
function placeLines(before: Page, after: Page): PlaceLine[] {
  const old = placedLayers(before.layout);
  const head: PlaceLine[] = [];
  const moved: PlaceLine[] = [];
  const placed: PlaceLine[] = [];
  let fresh = 0;
  for (const grid of placedLayers(after.layout).values()) {
    const prevGrid = old.get(grid.id);
    if (grid.type !== 'Grid') continue;
    // A free Grid with no counterpart in the base (a first design over the starter page) is new: one P1 line, not P2.
    if (prevGrid === undefined || prevGrid.type !== 'Grid') {
      if (isFree(grid)) fresh += childList(grid).length;
      continue;
    }
    const was = isFree(prevGrid);
    const now = isFree(grid);
    if (was !== now) {
      const verb = now ? 'Turns on' : 'Turns off';
      head.push({ kind: 'changed', path: `pages.${after.id}.layout.${grid.id}.placement`, sentence: `${verb} ${FREE_WORDS.label} for ${layerName(grid)} on ${after.title}.`, parts: 1 });
    }
    if (!now || !was) continue;
    const prevKids = new Map(childList(prevGrid).map((c) => [c.id, c]));
    for (const child of readingOrder(childList(grid))) {
      const next = readGrid(child.grid);
      if (next === null) continue;
      const name = layerName(child);
      const prevKid = prevKids.get(child.id);
      const prev = prevKid === undefined ? null : readGrid(prevKid.grid);
      const path = `pages.${after.id}.layout.${child.id}`;
      if (prev === null) {
        const high = next.rowSpan > 1 ? `, ${rowsHigh(next.rowSpan)}` : '';
        placed.push({ kind: 'added', path: `${path}.place`, sentence: `Places ${name} at ${cellWords(next)}, ${columnsWide(next.span)}${high}.`, parts: 1 });
        continue;
      }
      const corner = !sameCorner(prev, next);
      const size = !sameSize(prev, next);
      if (!corner && !size) continue;
      let sentence: string;
      if (corner && !size) sentence = `Moves ${name} to ${whereWords(prev, next)}.`;
      else if (!corner) sentence = `Makes ${name} ${sizeWords(prev, next)}.`;
      else sentence = `Moves ${name} to ${whereWords(prev, next)}, ${sizeWords(prev, next)}.`;
      const last = moved[moved.length - 1];
      // Consecutive plain moves of parts with one name to one place are one line ("Moves Number tiles to the top row.").
      // Only parts named by their type are joined: a custom name has no plural to speak of.
      const key = corner && !size && child.name === undefined ? `${name}|${whereWords(prev, next)}` : '';
      if (key !== '' && last !== undefined && last.group === key) {
        last.parts += 1;
        last.sentence = `Moves ${pluralName(name)} to ${whereWords(prev, next)}.`;
        continue;
      }
      moved.push({ kind: 'changed', path: `${path}.grid`, sentence, parts: 1, group: key });
    }
  }
  const shown = [...moved, ...placed];
  const rest = shown.slice(PLACE_DIFF_SHOWN).reduce((n, l) => n + l.parts, 0);
  const out = [...head, ...shown.slice(0, PLACE_DIFF_SHOWN)];
  if (fresh > 0) {
    out.unshift({ kind: 'added', path: `pages.${after.id}.layout.place`, sentence: `Places ${plural(fresh, 'part')} in a grid on ${after.title}.`, parts: fresh });
  }
  if (rest > 0) {
    out.push({ kind: 'changed', path: `pages.${after.id}.layout.places`, sentence: `Changes the place of ${plural(rest, 'more part')} on ${after.title}.`, parts: rest });
  }
  return out;
}

/** The corner choices in plain words. */
const RADIUS_WORDS: Readonly<Record<string, string>> = { none: 'Square', sm: 'Small', md: 'Medium', lg: 'Large', xl: 'Larger', '2xl': 'Round' };

const capitalize = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A source in words: "a list of Crews" or "one record of Crews". */
const sourceWords = (source: Source, spec: AppSpec): string =>
  `${source.mode === 'record' ? 'one record of' : 'a list of'} ${tableLabelIn(spec, source.table)}`;

const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export function diffSpecs(before: AppSpec, after: AppSpec): SpecChange[] {
  const out: SpecChange[] = [];
  const add = (kind: ChangeKind, area: ChangeArea, path: string, sentence: string, destructive = false, parts?: number): void => {
    out.push(parts === undefined ? { kind, area, path, sentence, destructive } : { kind, area, path, sentence, destructive, parts });
  };

  // App block.
  if (before.app.name !== after.app.name) add('changed', 'app', 'app.name', `Renames the app from ${q(before.app.name)} to ${q(after.app.name)}.`);
  if (before.app.description !== after.app.description) add('changed', 'app', 'app.description', 'Changes the app description.');
  if (before.app.icon !== after.app.icon) {
    add('changed', 'app', 'app.icon', after.app.icon === null ? 'Removes the app icon.' : `Changes the app icon to ${capitalize(after.app.icon)}.`);
  }
  if (before.app.version !== after.app.version) {
    add('changed', 'app', 'app.version', `Changes the version from ${before.app.version} to ${after.app.version}.`);
  }

  // Tables.
  const beforeTables = new Map<string, Table>(before.tables.map((t) => [t.id, t]));
  const afterTables = new Map<string, Table>(after.tables.map((t) => [t.id, t]));
  for (const table of after.tables) {
    const old = beforeTables.get(table.id);
    const path = `tables.${table.id}`;
    if (!old) {
      add('added', 'table', path, `Adds the table ${q(table.label)} with ${plural(table.fields.length, 'field')}.`);
      continue;
    }
    if (old.label !== table.label) add('changed', 'table', `${path}.label`, `Renames the table ${q(old.label)} to ${q(table.label)}.`);
    if (old.titleField !== table.titleField) {
      const title = table.fields.find((f) => f.id === table.titleField)?.label ?? table.titleField;
      add(
        'changed',
        'table',
        `${path}.titleField`,
        title === undefined ? `Stops showing a title for ${q(table.label)} records.` : `Shows ${q(title)} as the title of ${q(table.label)} records.`,
      );
    }
  }
  for (const table of before.tables) {
    if (!afterTables.has(table.id)) add('removed', 'table', `tables.${table.id}`, `Removes the table ${q(table.label)} and its data.`, true);
  }

  // Fields of tables present on both sides.
  for (const table of after.tables) {
    const old = beforeTables.get(table.id);
    if (!old) continue;
    const oldFields = new Map<string, Field>(old.fields.map((f) => [f.id, f]));
    const newFields = new Map<string, Field>(table.fields.map((f) => [f.id, f]));
    const t = q(table.label);
    for (const field of table.fields) {
      const prev = oldFields.get(field.id);
      const path = `tables.${table.id}.fields.${field.id}`;
      const f = q(field.label);
      if (!prev) {
        add('added', 'field', path, `Adds the field ${f} (${typeWords(field, after)}) to ${t}.`);
        continue;
      }
      if (prev.label !== field.label) add('changed', 'field', `${path}.label`, `Renames the field ${q(prev.label)} in ${t} to ${f}.`);
      if (prev.type !== field.type) {
        add('changed', 'field', `${path}.type`, `Changes ${f} in ${t} from ${shortType(prev, before)} to ${shortType(field, after)}.`, true);
      } else {
        if (prev.type === 'select' && field.type === 'select') {
          const added = field.options.filter((o) => !prev.options.includes(o));
          const removed = prev.options.filter((o) => !field.options.includes(o));
          if (added.length > 0) add('changed', 'field', `${path}.options`, `Adds the choices ${added.join(', ')} to ${f} in ${t}.`);
          if (removed.length > 0) add('changed', 'field', `${path}.options`, `Removes the choices ${removed.join(', ')} from ${f} in ${t}.`, true);
        }
        if (prev.type === 'reference' && field.type === 'reference' && prev.table !== field.table) {
          add('changed', 'field', `${path}.table`, `Changes ${f} in ${t} to link to ${q(tableLabelIn(after, field.table))}.`, true);
        }
        const before_ = defaultOf(prev);
        const after_ = defaultOf(field);
        if (before_ !== after_) {
          add(
            'changed',
            'field',
            `${path}.default`,
            after_ === undefined ? `Removes the default of ${f} in ${t}.` : `Sets the default of ${f} in ${t} to ${show(after_)}.`,
          );
        }
      }
      if (prev.required !== field.required) {
        add(
          'changed',
          'field',
          `${path}.required`,
          field.required ? `Makes ${f} in ${t} required.` : `Makes ${f} in ${t} optional.`,
          field.required,
        );
      }
    }
    for (const field of old.fields) {
      if (!newFields.has(field.id)) {
        add('removed', 'field', `tables.${table.id}.fields.${field.id}`, `Removes the field ${q(field.label)} from ${t}.`, true);
      }
    }
    const common = (list: readonly Field[], other: Map<string, Field>): string[] => list.filter((f) => other.has(f.id)).map((f) => f.id);
    if (!sameOrder(common(old.fields, newFields), common(table.fields, oldFields))) {
      add('changed', 'field', `tables.${table.id}.fields`, `Reorders the fields of ${t}.`);
    }
  }

  // Pages.
  const beforePages = new Map<string, Page>(before.pages.map((p) => [p.id, p]));
  const afterPages = new Map<string, Page>(after.pages.map((p) => [p.id, p]));
  for (const page of after.pages) {
    const old = beforePages.get(page.id);
    const path = `pages.${page.id}`;
    if (!old) {
      add('added', 'page', path, `Adds the page ${page.title}${page.route.includes('/:') ? ' (opens from a list)' : ''}.`);
      const line = placedPageLine(page);
      if (line !== null) add(line.kind, 'page', line.path, line.sentence, false, line.parts > 1 ? line.parts : undefined);
      continue;
    }
    if (old.title !== page.title) add('changed', 'page', `${path}.title`, `Renames the page ${q(old.title)} to ${q(page.title)}.`);
    if (old.route !== page.route) add('changed', 'page', `${path}.route`, `Changes the web address of the page ${q(page.title)}.`);
    if (stableJson(old.layout) !== stableJson(page.layout)) {
      add('changed', 'page', `${path}.layout`, `Changes the layout of ${q(page.title)} (${plural(countLayers(page.layout), 'part')}).`);
      const resized = resizedLayers(old.layout, page.layout);
      for (const layer of resized.slice(0, SIZING_SHOWN)) {
        add('changed', 'page', `${path}.layout.${layer.id}.sizing`, sizingChange(layer.name ?? partLabel(layer.type), readSizing(layer.sizing)));
      }
      if (resized.length > SIZING_SHOWN) {
        add('changed', 'page', `${path}.layout.sizing`, `Changes the width of ${resized.length - SIZING_SHOWN} more parts on ${q(page.title)}.`);
      }
      for (const line of placeLines(old, page)) add(line.kind, 'page', line.path, line.sentence, false, line.parts > 1 ? line.parts : undefined);
    }
  }
  for (const page of before.pages) {
    if (!afterPages.has(page.id)) add('removed', 'page', `pages.${page.id}`, `Removes the page ${q(page.title)}.`);
  }

  // Sources of pages in the new spec.
  for (const page of after.pages) {
    const old = beforePages.get(page.id)?.sources ?? [];
    const oldById = new Map<string, Source>(old.map((s) => [s.id, s]));
    const newById = new Map<string, Source>(page.sources.map((s) => [s.id, s]));
    for (const source of page.sources) {
      const prev = oldById.get(source.id);
      const path = `pages.${page.id}.sources.${source.id}`;
      if (!prev) {
        add('added', 'source', path, `Adds ${sourceWords(source, after)} to ${page.title}.`);
      } else if (stableJson(prev) !== stableJson(source)) {
        add('changed', 'source', path, `Changes ${sourceWords(source, after)} on ${page.title}.`);
      }
    }
    for (const source of old) {
      if (!newById.has(source.id)) {
        add('removed', 'source', `pages.${page.id}.sources.${source.id}`, `Removes ${sourceWords(source, before)} from ${page.title}.`);
      }
    }
  }

  // Menu.
  const beforeNav = new Map(before.nav.map((n) => [n.pageId, n]));
  const afterNav = new Map(after.nav.map((n) => [n.pageId, n]));
  for (const item of after.nav) {
    const prev = beforeNav.get(item.pageId);
    const path = `nav.${item.pageId}`;
    if (!prev) {
      add('added', 'nav', path, `Adds ${q(item.label)} to the menu.`);
      continue;
    }
    if (prev.label !== item.label) add('changed', 'nav', `${path}.label`, `Renames the menu item ${q(prev.label)} to ${q(item.label)}.`);
    if (prev.icon !== item.icon) add('changed', 'nav', `${path}.icon`, `Changes the icon of ${q(item.label)} in the menu.`);
  }
  for (const item of before.nav) {
    if (!afterNav.has(item.pageId)) add('removed', 'nav', `nav.${item.pageId}`, `Removes ${q(item.label)} from the menu.`);
  }
  const commonNav = (list: AppSpec['nav'], other: Map<string, unknown>): string[] => list.filter((n) => other.has(n.pageId)).map((n) => n.pageId);
  if (!sameOrder(commonNav(before.nav, afterNav), commonNav(after.nav, beforeNav))) add('changed', 'nav', 'nav', 'Reorders the menu.');

  // Menu bar (absent is the classic look).
  if (before.menu === undefined && after.menu !== undefined) add('added', 'menu', 'menu', 'Adds a menu bar.');
  else if (before.menu !== undefined && after.menu === undefined) add('removed', 'menu', 'menu', 'Removes the menu bar.');
  else if (before.menu !== undefined && after.menu !== undefined && stableJson(before.menu) !== stableJson(after.menu)) {
    add('changed', 'menu', 'menu', 'Changes the menu bar.');
  }

  // Theme.
  const lookBefore = themeLabel(sanitizeTheme(before.theme));
  const lookAfter = themeLabel(sanitizeTheme(after.theme));
  if (lookBefore !== lookAfter) {
    add('changed', 'theme', 'theme.id', `Changes the look to ${lookAfter}.`);
  } else {
    if (before.theme.preset !== after.theme.preset) add('changed', 'theme', 'theme.preset', `Changes the background to ${capitalize(after.theme.preset)}.`);
    if (before.theme.radius !== after.theme.radius) {
      add('changed', 'theme', 'theme.radius', `Changes the corners to ${RADIUS_WORDS[after.theme.radius] ?? after.theme.radius}.`);
    }
  }

  return out;
}

const AREA_NOUN: Record<ChangeArea, [string, string]> = {
  app: ['app setting', 'app settings'],
  table: ['table', 'tables'],
  field: ['field', 'fields'],
  page: ['page', 'pages'],
  source: ['list', 'lists'],
  nav: ['menu item', 'menu items'],
  menu: ['menu bar', 'menu bars'],
  theme: ['theme setting', 'theme settings'],
};

/** "3 tables added, 1 page changed", or "No changes.". */
export function summarizeChanges(changes: readonly SpecChange[]): string {
  if (changes.length === 0) return 'No changes.';
  const counts = new Map<string, { area: ChangeArea; kind: ChangeKind; ids: Set<string> }>();
  for (const [i, c] of changes.entries()) {
    if (isPlaceChange(c) && c.kind !== 'changed') continue;
    const key = `${c.area}:${c.kind}`;
    // A page counts once however many of its parts changed (its layout, title, address and sizes are one page; a part placed is no page added).
    const id = c.area === 'page' ? c.path.split('.')[1] : String(i);
    const entry = counts.get(key);
    if (entry) entry.ids.add(id);
    else counts.set(key, { area: c.area, kind: c.kind, ids: new Set([id]) });
  }
  return [...counts.values()].map(({ area, kind, ids }) => `${ids.size} ${AREA_NOUN[area][ids.size === 1 ? 0 : 1]} ${kind}`).join(', ');
}
