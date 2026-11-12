// Judges an ask against what the helper changed (DESIGN-phase17.md P17-02). Pure, no React. The ask is split into clauses; each
// clause is Done when a change of the right kind names something the clause names, else Not done and gets a way to do it by
// hand. Changes no clause explains are listed apart as "It also changed". The words are matched, never guessed: a clause with no
// matching change is Not done even when the design changed in some other way.
// Also read by the helper's pipeline on the server (the place words of an ask), so the syntax follows ADR-006: `.ts` on value
// imports, type-only imports as `import type`, erasable TypeScript only.
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { slotLayers } from '@local-app-studio/runtime/spec/menuSlots.ts';
import type { ChangeKind, SpecChange } from './specDiff';
import { mentions, stem, stemsOf, tokens } from './promptWords.ts';

export const ASK_DONE_PREFIX = 'Done: ';
export const ASK_NOT_DONE_PREFIX = 'Not done: ';
export const ALSO_CHANGED_HEADING = 'It also changed';
export const NOTHING_CHANGED = 'Nothing changed.';
export const ASK_ALL_MISSED = 'The helper did not do what you asked. Try other words, or do it yourself.';
export const EXIT_DATA = 'Do it on Data';
export const EXIT_DESIGN = 'Do it in Design';
export const EXIT_LOOK = 'Change the look in Design';

export type AskExitKind = 'data' | 'design' | 'look';

export interface AskExit {
  kind: AskExitKind;
  label: string;
}

export interface AskLine {
  done: boolean;
  /** The person's words for this clause, without the closing full stop. */
  clause: string;
  /** "Done: <clause>" or "Not done: <clause>". */
  text: string;
  /** Where to do a not done clause by hand, or null when its words name nothing to point at. */
  exit: AskExit | null;
}

export interface AskOutcome {
  lines: AskLine[];
  /** The changes no clause explains, in the order they came. */
  alsoChanged: SpecChange[];
  /** The design is the one it replaced. */
  nothingChanged: boolean;
  /** There is at least one clause and every one is Not done. */
  missedAll: boolean;
}

export interface AskInput {
  /** The person's words. */
  ask: string;
  /** diffSpecs(before, after), where `before` is the design the ask was made on. */
  changes: readonly SpecChange[];
  before: AppSpec;
  after: AppSpec;
}

type Verb = 'add' | 'remove' | 'change' | 'rename' | 'show' | 'hide';
type NameClass = 'table' | 'field' | 'page';

const VERB_OF: Readonly<Record<string, Verb>> = {
  add: 'add',
  create: 'add',
  insert: 'add',
  include: 'add',
  put: 'add',
  remove: 'remove',
  delete: 'remove',
  drop: 'remove',
  erase: 'remove',
  change: 'change',
  make: 'change',
  turn: 'change',
  set: 'change',
  switch: 'change',
  update: 'change',
  use: 'change',
  rename: 'rename',
  show: 'show',
  display: 'show',
  hide: 'hide',
};

const ANY_KIND: readonly ChangeKind[] = ['added', 'removed', 'changed'];
const KINDS_OF_VERB: Readonly<Record<Verb, readonly ChangeKind[]>> = {
  add: ['added'],
  remove: ['removed'],
  change: ANY_KIND,
  rename: ['changed'],
  show: ['added', 'changed'],
  hide: ['removed', 'changed'],
};

const STOP: ReadonlySet<string> = new Set(
  (
    'a an the to for of in on at by with from and or but then also please can could would you i me my our your their its it this that these those ' +
    'each every all some any one two is are be do does will should just so as into onto about like have has get got want need let lets there here ' +
    'them they he she his her more most very new out up down too everywhere'
  ).split(' '),
);

const CLASS_OF: Readonly<Record<string, NameClass>> = { table: 'table', field: 'field', column: 'field', page: 'page', screen: 'page' };

const PART_OF_WORD: Readonly<Record<string, string>> = {
  chart: 'chart',
  graph: 'chart',
  form: 'form',
  list: 'list',
  menu: 'menu',
  button: 'button',
  number: 'number',
  total: 'number',
  count: 'number',
  tile: 'number',
  stat: 'number',
  search: 'search',
  filter: 'filters',
  app: 'app',
  application: 'app',
};

const PART_OF_TYPE: Readonly<Record<string, string>> = {
  Chart: 'chart',
  RecordForm: 'form',
  QuickAdd: 'form',
  DataTable: 'list',
  RecordList: 'list',
  StatCard: 'number',
  Button: 'button',
  SearchBox: 'search',
  FilterBar: 'filters',
};

/** One place word of a clause: stacking (flow), a grid (free) or moving and resizing (move). */
export interface PlaceClause {
  kind: 'flow' | 'free' | 'move';
  /** PART_OF_WORD values the clause names ("chart", "number", "list", ...). */
  parts: ReadonlySet<string>;
  /** Stems of the clause's words. */
  stems: ReadonlySet<string>;
}

export interface PlaceAsk {
  /** A flow clause. */
  toFlow: boolean;
  /** A free clause. */
  toFree: boolean;
  /** The move clauses. */
  moves: readonly PlaceClause[];
  /** A place clause, or an add clause that names a part: a reason to lay a page out again. */
  layout: boolean;
  /** Stems of the whole ask (page naming). */
  stems: ReadonlySet<string>;
}

/** Words that mean "one after the other". Entries with a space are token phrases (consecutive words). The bare words count only as the clause's verb or in "make it flow" (see flowHits). */
export const FLOW_WORDS: readonly string[] = [
  'stack',
  'stacked',
  'stacking',
  'flow',
  'flowing',
  'one column',
  'single column',
  'no grid',
  'without a grid',
  'without the grid',
  'one after the other',
  'one after another',
  'stop placing',
];
/** Words that mean "place parts on a grid" ("dashboard" counts only as "as a dashboard" or "like a dashboard"). */
export const GRID_WORDS: readonly string[] = ['grid', 'freely'];
/** Verbs that move or resize a part. */
const MOVE_VERBS: readonly string[] = ['move', 'moves', 'moved', 'moving', 'put', 'place', 'placed', 'swap', 'swapped', 'resize', 'resized'];
/** Size words: a part gets wider or taller. */
const SIZE_WORDS: readonly string[] = ['wider', 'narrower', 'taller', 'shorter', 'bigger', 'smaller'];
/** Position words: a move only with a move verb or a size word in the clause ("Show the top customers" is not a move). */
const POSITION_WORDS: readonly string[] = ['top', 'bottom', 'left', 'right', 'beside', 'under', 'above', 'below'];
/** "put" and "place" (as a verb) move a part only with a position word ("next to", "first" and "last" too); "put a chart on the page" is an ordinary add. */
const WEAK_MOVE_VERBS: ReadonlySet<string> = new Set(['put', 'place', 'placed']);
const WEAK_POSITION_SET: ReadonlySet<string> = new Set([...POSITION_WORDS, 'first', 'last']);
const hasPosition = (raw: readonly string[]): boolean => raw.some((t, i) => WEAK_POSITION_SET.has(t) || (t === 'next' && raw[i + 1] === 'to'));
/** Words that change where or how big a part is. */
export const MOVE_WORDS: readonly string[] = [...MOVE_VERBS, ...SIZE_WORDS, ...POSITION_WORDS];

const FLOW_ENTRIES: readonly (readonly string[])[] = FLOW_WORDS.map((w) => w.split(' '));
const GRID_SET: ReadonlySet<string> = new Set(GRID_WORDS);
const MOVE_VERB_SET: ReadonlySet<string> = new Set([...MOVE_VERBS, ...SIZE_WORDS]);
/** The bare flow words: a flow ask only as the clause's verb, never as a noun ("cash flow", "tech stack"). */
const BARE_FLOW: ReadonlySet<string> = new Set(['stack', 'stacked', 'stacking', 'flow', 'flowing']);
/** Leading words that do not make a bare flow word a noun ("Please stack these", "I want it to flow", "don't stack"). */
const FLOW_LEAD: ReadonlySet<string> = new Set(['no', 'stop', 'make', 'keep']);
/** A clause with one of these verbs is a remove, rename, hide or show, never a place clause. */
const NOT_PLACE_VERBS: ReadonlySet<Verb> = new Set<Verb>(['remove', 'rename', 'hide', 'show']);
/** A clause with one of these is an add, never a move (the new part's own block is honoured anyway). */
const ADD_WORDS: ReadonlySet<string> = new Set(['add', 'create', 'insert', 'include', 'new', 'another']);

const NUMBER_LEAD: ReadonlySet<string> = new Set(['a', 'an', 'the', 'one', 'big', 'large', 'new', 'single', 'of']);
/** A clause with one of these words says what NOT to do; it is never Done (see askOutcome). */
const NEGATION: ReadonlySet<string> = new Set(['not', 'dont', 'never']);
const LOOK_WORDS: ReadonlySet<string> = new Set(['look', 'colour', 'color', 'theme', 'style', 'dark', 'light', 'shade', 'background']);
const COLOR_NAMES: ReadonlySet<string> = new Set([
  'green', 'blue', 'red', 'purple', 'orange', 'yellow', 'pink', 'teal', 'grey', 'gray', 'black', 'white', 'brown', 'gold', 'navy',
]);

const VERB_START = Object.keys(VERB_OF).join('|');
/** A new clause may also start with a place-only word (move, place, swap, resize, stack, flow and their forms), but only before a determiner or pronoun: "and stack the rest" splits, "Name, Stack and Status fields" (a list of names) does not. */
const PLACE_ONLY = 'move|moves|moved|moving|place|placed|swap|swapped|resize|resized|stack|stacked|stacking|flow|flowing';
const PLACE_OBJECT = 'the|a|an|it|them|this|that|these|those|all|every|everything|my|our';
const PLACE_OBJECT_SET: ReadonlySet<string> = new Set(PLACE_OBJECT.split('|'));
const CLAUSE_START = `(?:please\\s+)?(?:(?:${VERB_START})\\b|(?:${PLACE_ONLY})\\s+(?:${PLACE_OBJECT})\\b)`;
const BEFORE_VERB = new RegExp(
  `\\s+and\\s+(?=${CLAUSE_START})|,\\s*(?=${CLAUSE_START})|\\s+and\\s+(?=(?:do\\s+not|don['’]?t|never|not)\\b)|,?\\s+but\\s+(?=(?:do\\s+not|don['’]?t|never|not)\\b)`,
  'i',
);

/**
 * A negation says what not to do only at the start of a clause or right before a verb: "do not stack", "don't add", "no chart", "no more adding".
 * A "not" or "no" later in the clause is a detail of a thing ("orders that are not paid", "with no decimals"), never a wish to leave the ask undone.
 */
const isNegated = (raw: readonly string[]): boolean => {
  const firstVerb = raw.findIndex((t) => VERB_OF[t] !== undefined);
  // With no verb in the clause a negation counts only at the start or after stop words alone ("A page for orders that are not paid" is not negated).
  const atStart = (i: number): boolean => raw.slice(0, i).every((w) => STOP.has(w));
  const beforeVerb = (i: number): boolean => (firstVerb === -1 ? atStart(i) : i < firstVerb) || (raw[i + 1] !== undefined && VERB_OF[raw[i + 1]] !== undefined);
  return raw.some((t, i) => (NEGATION.has(t) && beforeVerb(i)) || (t === 'no' && (i === 0 || (raw[i + 1] !== undefined && VERB_OF[raw[i + 1]] !== undefined))));
};

/** True when the bare flow word at `at` is the clause's first content word ("Stack these", "I want it to flow", "don't stack"). */
function leadsClause(raw: readonly string[], at: number): boolean {
  for (let i = 0; i < at; i += 1) {
    if (!STOP.has(raw[i]) && !NEGATION.has(raw[i]) && !FLOW_LEAD.has(raw[i])) return false;
  }
  return true;
}

/** The word positions of `raw` taken by flow words ("one column wide" is a resize, not a flow word; "cash flow" and "the Stack table" are nouns). */
function flowHits(raw: readonly string[]): Set<number> {
  const hit = new Set<number>();
  for (const entry of FLOW_ENTRIES) {
    for (let i = 0; i + entry.length <= raw.length; i += 1) {
      if (!entry.every((w, k) => raw[i + k] === w)) continue;
      if (entry.length === 1 && BARE_FLOW.has(entry[0]) && !leadsClause(raw, i)) continue;
      // "Stack and Flow tables", "Revenue and Flow fields": a bare flow word before a class word, or (when no determiner follows it, so not "Stack the Home page") in a clause that names a class and no part, is a name.
      if (entry.length === 1 && BARE_FLOW.has(entry[0]) && (CLASS_OF[stem(raw[i + 1] ?? '')] !== undefined || (!PLACE_OBJECT_SET.has(raw[i + 1] ?? '') && movesNonPart(raw)))) continue;
      if (entry.length === 2 && entry[1] === 'column' && raw[i + 2] === 'wide') continue;
      for (let k = 0; k < entry.length; k += 1) hit.add(i + k);
    }
  }
  return hit;
}

/** The part a word names, or undefined: "number" counts only on its own ("a number"), and no part word counts right before a class word ("Phone number field", "Total column"). */
function partWordAt(raw: readonly string[], i: number): string | undefined {
  const part = PART_OF_WORD[stem(raw[i])];
  if (part === undefined) return undefined;
  if (raw[i + 1] !== undefined && CLASS_OF[stem(raw[i + 1])] !== undefined) return undefined;
  if (part === 'number' && stem(raw[i]) === 'number' && i !== 0 && !NUMBER_LEAD.has(raw[i - 1])) return undefined;
  return part;
}

/** True when a clause moves the menu, or a table, field, column, page or screen with no part named ("Move Orders to the menu", "Move the Notes field to the top"): that is not a part on a grid. */
function movesNonPart(raw: readonly string[]): boolean {
  if (raw.some((t) => PART_OF_WORD[stem(t)] === 'menu')) return true;
  const names = raw.some((t) => CLASS_OF[stem(t)] !== undefined);
  return names && !raw.some((_, i) => partWordAt(raw, i) !== undefined);
}

/** The place kind of a clause (flow first, then free, then move) and whether it says what NOT to do; null when it holds no place word. */
function placeKindOf(raw: readonly string[], verb: Verb | null): { kind: PlaceClause['kind']; negated: boolean } | null {
  if (verb !== null && NOT_PLACE_VERBS.has(verb)) return null;
  const flow = flowHits(raw);
  if (flow.size > 0) {
    // "Stop stacking the parts" says the opposite of a flow ask: a bare flow word right after "stop" is negated.
    const stopped = [...flow].some((i) => BARE_FLOW.has(raw[i]) && raw[i - 1] === 'stop');
    return { kind: 'flow', negated: stopped || isNegated(raw.filter((_, i) => !flow.has(i))) };
  }
  const dashboard = raw.some((t, i) => t === 'dashboard' && (raw[i - 1] === 'a' || raw[i - 1] === 'the') && (raw[i - 2] === 'as' || raw[i - 2] === 'like'));
  if (dashboard || raw.some((t) => GRID_SET.has(t))) return { kind: 'free', negated: isNegated(raw) };
  // A position word alone ('top', 'left') is no move: it needs a move verb or a size word.
  const moveWord = raw.some((t) => MOVE_VERB_SET.has(t) && (!WEAK_MOVE_VERBS.has(t) || hasPosition(raw)));
  if (moveWord && !raw.some((t) => ADD_WORDS.has(t)) && !movesNonPart(raw)) return { kind: 'move', negated: isNegated(raw) };
  return null;
}

/** The clauses of an ask: sentences, "and then", ";", and "and" or a comma before another verb. Empty clauses are dropped. */
export function splitClauses(ask: string): string[] {
  const out: string[] = [];
  for (const sentence of ask.split(/[.!?;\n]+/)) {
    for (const part of sentence.split(/\s+(?:and\s+)?then\s+/i)) {
      for (const clause of part.split(BEFORE_VERB)) {
        const text = clause.trim().replace(/[,:]+$/, '').trim();
        if (text !== '') out.push(text);
      }
    }
  }
  return out;
}

interface Labels {
  tables: Map<string, string[]>;
  fields: Map<string, string[]>;
  pages: Map<string, string[]>;
}

const push = (map: Map<string, string[]>, id: string, label: string): void => {
  const known = map.get(id);
  if (known === undefined) map.set(id, [label]);
  else if (!known.includes(label)) known.push(label);
};

/** Every label an id had on either side, so a renamed or removed thing is still found by the words for it. */
function labelsOf(before: AppSpec, after: AppSpec): Labels {
  const out: Labels = { tables: new Map(), fields: new Map(), pages: new Map() };
  for (const spec of [before, after]) {
    for (const table of spec.tables) {
      push(out.tables, table.id, table.label);
      for (const field of table.fields) push(out.fields, `${table.id}.${field.id}`, field.label);
    }
    for (const page of spec.pages) push(out.pages, page.id, page.title);
  }
  return out;
}

function hitsOf(words: ReadonlySet<string>, labels: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const [id, names] of labels) if (names.some((name) => mentions(words, name))) out.add(id);
  return out;
}

interface Info {
  kinds: Set<ChangeKind>;
  tables: Set<string>;
  /** Tables only named in passing (the table of a list source). */
  softTables: Set<string>;
  fields: Set<string>;
  pages: Set<string>;
  parts: Set<string>;
  /** The tables of the parts that came or went, by part ("" when a part names none); a part with no entry has no table to compare. */
  partTables: Map<string, Set<string>>;
  areas: Set<NameClass>;
  look: boolean;
  /** The change is the thing itself coming, going or being renamed, so its name is the whole evidence; an edit inside it is not. */
  direct: boolean;
  /** The stems of the label the change gave a table, field, page or menu item (a rename), else null. */
  newLabel: ReadonlySet<string> | null;
  /** What a place change did (from the path suffix), or null for any other change. */
  place: { kind: 'flow' | 'free' | 'move' | 'placed'; layer: LayoutLayer | null } | null;
}

/** A path that ends in a place change of specDiff (turns a grid on or off, moves, resizes, places): "pages.home.layout.grid_1.grid". */
const PLACE_PATH = /\.layout\.(?:[^.]+\.)?(?:grid|place|placement|places)$/;
/** True for the place changes of diffSpecs (they have their own list in the review, not "It also changed"). */
export const isPlaceChange = (c: { area: string; path: string }): boolean => c.area === 'page' && PLACE_PATH.test(c.path);

/** The layer with this id in a layout (iterative), or null. */
function layerById(root: LayoutLayer, id: string): LayoutLayer | null {
  const stack: LayoutLayer[] = [root];
  for (let layer = stack.pop(); layer !== undefined; layer = stack.pop()) {
    if (layer.id === id) return layer;
    if (Array.isArray(layer.children)) stack.push(...layer.children);
  }
  return null;
}

function placeOf(seg: readonly string[], after: AppSpec): Info['place'] {
  const suffix = seg[seg.length - 1];
  const page = after.pages.find((p) => p.id === seg[1]);
  const layer = page === undefined || seg.length < 5 ? null : layerById(page.layout, seg[seg.length - 2]);
  if (suffix === 'placement') {
    const props: unknown = layer?.props;
    const free = typeof props === 'object' && props !== null && (props as Record<string, unknown>).placement === 'free';
    return { kind: free ? 'free' : 'flow', layer };
  }
  if (suffix === 'grid') return { kind: 'move', layer };
  return { kind: 'placed', layer };
}

const PART_TABLE_SEP = '|';
type Source = Page['sources'][number];

/** The table a part reads or writes by its own props ("" when it names none): its table, its list's table, or the table a Button adds to. */
function partTable(layer: { props?: unknown }, sources: readonly Source[]): string {
  const props = typeof layer.props === 'object' && layer.props !== null ? (layer.props as Record<string, unknown>) : {};
  if (typeof props.table === 'string') return props.table;
  if (typeof props.source === 'string') return sources.find((s) => s.id === props.source)?.table ?? '';
  const action = props.action;
  if (typeof action === 'object' && action !== null && !Array.isArray(action)) {
    const table = (action as Record<string, unknown>).table;
    if (typeof table === 'string') return table;
  }
  return '';
}

/** Counts of parts keyed "<part>|<table>", so a chart of Clients and a chart of Jobs are two parts. */
function countParts(roots: readonly unknown[], sources: readonly Source[]): Map<string, number> {
  const out = new Map<string, number>();
  const stack: unknown[] = [...roots];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (typeof item !== 'object' || item === null) continue;
    const layer = item as { type?: unknown; children?: unknown; props?: unknown };
    const part = typeof layer.type === 'string' ? PART_OF_TYPE[layer.type] : undefined;
    if (part !== undefined) {
      const key = `${part}${PART_TABLE_SEP}${partTable(layer, sources)}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    if (Array.isArray(layer.children)) stack.push(...(layer.children as unknown[]));
  }
  return out;
}

const pageParts = (page: Page | undefined): Map<string, number> => (page === undefined ? new Map() : countParts([page.layout], page.sources));
const menuParts = (spec: AppSpec): Map<string, number> => countParts([...slotLayers(spec.menu, 'start'), ...slotLayers(spec.menu, 'end')], []);

/** Adds the parts whose count differs between two walks to `info`, with the kind of the difference. */
function addPartDelta(info: Info, before: Map<string, number>, after: Map<string, number>): void {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    if (delta === 0) continue;
    const [part, table = ''] = key.split(PART_TABLE_SEP);
    info.parts.add(part);
    info.kinds.add(delta > 0 ? 'added' : 'removed');
    const known = info.partTables.get(part);
    if (known === undefined) info.partTables.set(part, new Set([table]));
    else known.add(table);
  }
}

/** The label a rename gave, as stems ("tables.jobs.label" gives the table's label on the new side); null for any other change. */
function newLabelOf(change: SpecChange, seg: readonly string[], after: AppSpec): ReadonlySet<string> | null {
  if (change.kind !== 'changed') return null;
  let label: string | undefined;
  if (change.area === 'table' && seg[2] === 'label') label = after.tables.find((t) => t.id === seg[1])?.label;
  else if (change.area === 'field' && seg[4] === 'label') label = after.tables.find((t) => t.id === seg[1])?.fields.find((f) => f.id === seg[3])?.label;
  else if (change.area === 'page' && seg[2] === 'title') label = after.pages.find((p) => p.id === seg[1])?.title;
  else if (change.area === 'nav' && seg[2] === 'label') label = after.nav.find((n) => n.pageId === seg[1])?.label;
  return label === undefined ? null : new Set(stemsOf(label));
}

function infoOf(change: SpecChange, before: AppSpec, after: AppSpec): Info {
  const info: Info = {
    kinds: new Set([change.kind]),
    tables: new Set(),
    softTables: new Set(),
    fields: new Set(),
    pages: new Set(),
    parts: new Set(),
    partTables: new Map(),
    areas: new Set(),
    look: false,
    direct: false,
    newLabel: null,
    place: null,
  };
  const seg = change.path.split('.');
  if (isPlaceChange(change)) info.place = placeOf(seg, after);
  info.newLabel = newLabelOf(change, seg, after);
  info.direct = (change.area === 'table' || change.area === 'page' || change.area === 'nav') && (seg.length === 2 || seg[2] === 'label' || seg[2] === 'title');
  switch (change.area) {
    case 'app':
      info.parts.add('app');
      break;
    case 'table':
      info.areas.add('table');
      if (seg[1] !== undefined) info.tables.add(seg[1]);
      break;
    case 'field':
      info.areas.add('field');
      if (seg[1] !== undefined && seg[2] === 'fields' && seg[3] !== undefined) info.fields.add(`${seg[1]}.${seg[3]}`);
      break;
    case 'page': {
      info.areas.add('page');
      const id = seg[1];
      if (id === undefined) break;
      info.pages.add(id);
      const sizing = seg[2] === 'layout' && seg.length > 3;
      if (!sizing) addPartDelta(info, pageParts(before.pages.find((p) => p.id === id)), pageParts(after.pages.find((p) => p.id === id)));
      break;
    }
    case 'source': {
      info.parts.add('list');
      const id = seg[1];
      if (id !== undefined) info.pages.add(id);
      const sourceId = seg[3];
      for (const spec of [before, after]) {
        const source = spec.pages.find((p) => p.id === id)?.sources.find((s) => s.id === sourceId);
        if (source !== undefined) info.softTables.add(source.table);
      }
      info.partTables.set('list', new Set(info.softTables));
      break;
    }
    case 'nav':
      info.parts.add('menu');
      if (seg[1] !== undefined) info.pages.add(seg[1]);
      break;
    case 'menu':
      info.parts.add('menu');
      addPartDelta(info, menuParts(before), menuParts(after));
      break;
    case 'theme':
      info.look = true;
      break;
  }
  return info;
}

interface Facts {
  verb: Verb | null;
  classes: Set<NameClass>;
  tableHits: Set<string>;
  fieldHits: Set<string>;
  pageHits: Set<string>;
  parts: Set<string>;
  look: boolean;
  /** Fields the clause names by words no table or page it names already covers ("Project" in "the Projects page" is not a field asked for). */
  fieldsNamed: number;
  /** What a rename names as the new label: the content words after the last "to", "as" or "into" (empty when there are none). */
  renameTo: Set<string>;
  /** The clause says what not to do. */
  negated: boolean;
  /** The clause names a table (a word before "table", or a capitalised noun after to, in, into, on or from) that is in neither spec. */
  unknownTable: boolean;
  /** Content words that name nothing the specs or the part words know: the clause cannot be matched by kind alone. */
  unknown: number;
  /** The clause holds a place word (flow, free or move), or null. */
  place: PlaceClause | null;
}

const NOT_A_TABLE_NAME: ReadonlySet<string> = new Set(['another', 'other', 'same', 'whole', 'entire', 'main', 'first', 'last', 'existing', 'separate', 'single']);
const TARGET_NOUN = /\b(?:to|in|into|on|from)\s+(?:(?:the|a|an|my|our)\s+)?([A-Z][A-Za-z0-9]*)/g;

/**
 * True when the clause names a table the app does not have, before or after: "the Moons table" (a word before "table") or
 * "to Moons" (a capitalised noun in the target position, never the first word). Words any table, field or page label has are known.
 */
function namesUnknownTable(clause: string, raw: readonly string[], labels: Labels, verb: Verb | null): boolean {
  const known = new Set<string>();
  for (const map of [labels.tables, labels.fields, labels.pages]) for (const names of map.values()) for (const n of names) for (const s of stemsOf(n)) known.add(s);
  const isKnown = (word: string): boolean => known.has(stem(word));
  const generic = (word: string): boolean =>
    STOP.has(word) || NOT_A_TABLE_NAME.has(word) || VERB_OF[word] !== undefined || CLASS_OF[stem(word)] !== undefined || PART_OF_WORD[stem(word)] !== undefined;
  // "Add a Clients table and a Jobs table" names tables to make, not tables to find; only a field put somewhere needs its table to exist.
  if (verb === 'add' && !raw.some((t) => CLASS_OF[stem(t)] === 'field')) return false;
  for (let i = 1; i < raw.length; i += 1) {
    if (CLASS_OF[stem(raw[i])] !== 'table') continue;
    const before = raw[i - 1];
    if (!generic(before) && !isKnown(before)) return true;
  }
  if (verb === 'rename') return false;
  for (const m of clause.matchAll(TARGET_NOUN)) {
    const noun = m[1].toLowerCase();
    if (!generic(noun) && !LOOK_WORDS.has(noun) && !COLOR_NAMES.has(noun) && !isKnown(noun)) return true;
  }
  return false;
}

function factsOf(clause: string, labels: Labels): Facts {
  const raw = tokens(clause);
  const stems = new Set(raw.map(stem));
  const verb = raw.map((t) => VERB_OF[t]).find((v): v is Verb => v !== undefined) ?? null;
  const classes = new Set<NameClass>();
  const parts = new Set<string>();
  let lookWord = false;
  let colorWord = false;
  raw.forEach((t, i) => {
    const cls = CLASS_OF[stem(t)];
    if (cls !== undefined) classes.add(cls);
    const part = partWordAt(raw, i);
    if (part !== undefined) parts.add(part);
    if (LOOK_WORDS.has(t)) lookWord = true;
    if (COLOR_NAMES.has(t)) colorWord = true;
  });
  const tableHits = hitsOf(stems, labels.tables);
  // The word after "per" is a unit ("rate per hour"), never a field asked for (the Hours field).
  const fieldHits = hitsOf(new Set(raw.filter((_, i) => raw[i - 1] !== 'per').map(stem)), labels.fields);
  const pageHits = hitsOf(stems, labels.pages);
  const look = lookWord || (colorWord && parts.size === 0 && classes.size === 0);
  const named = new Set<string>();
  for (const [map, hits] of [[labels.tables, tableHits], [labels.fields, fieldHits], [labels.pages, pageHits]] as const) {
    for (const id of hits) for (const label of map.get(id) ?? []) for (const t of tokens(label)) named.add(stem(t));
  }
  const placeStems = new Set<string>();
  for (const [map, hits] of [[labels.tables, tableHits], [labels.pages, pageHits]] as const) {
    for (const id of hits) for (const label of map.get(id) ?? []) for (const t of tokens(label)) placeStems.add(stem(t));
  }
  let fieldsNamed = 0;
  for (const id of fieldHits) {
    const covered = (labels.fields.get(id) ?? []).every((label) => tokens(label).every((t) => placeStems.has(stem(t))));
    if (!covered) fieldsNamed += 1;
  }
  let unknown = 0;
  for (const t of raw) {
    const s = stem(t);
    if (STOP.has(t) || VERB_OF[t] !== undefined || CLASS_OF[s] !== undefined || PART_OF_WORD[s] !== undefined) continue;
    if (LOOK_WORDS.has(t) || COLOR_NAMES.has(t) || named.has(s)) continue;
    unknown += 1;
  }
  const renameTo = new Set<string>();
  if (verb === 'rename') {
    const at = Math.max(raw.lastIndexOf('to'), raw.lastIndexOf('as'), raw.lastIndexOf('into'));
    // The new name ends at the first stop word after it ("to Lessons everywhere in the app").
    for (const t of at < 0 ? [] : raw.slice(at + 1)) {
      if (STOP.has(t) && renameTo.size > 0) break;
      if (!STOP.has(t) && CLASS_OF[stem(t)] === undefined) renameTo.add(stem(t));
    }
  }
  const placed = placeKindOf(raw, verb);
  const place: PlaceClause | null = placed === null ? null : { kind: placed.kind, parts, stems };
  return {
    verb,
    classes,
    tableHits,
    fieldHits,
    pageHits,
    parts,
    look,
    unknown,
    fieldsNamed,
    renameTo,
    negated: placed === null ? isNegated(raw) : placed.negated,
    unknownTable: namesUnknownTable(clause, raw, labels, verb),
    place,
  };
}

const NO_LABELS: Labels = { tables: new Map(), fields: new Map(), pages: new Map() };

type Named = { type?: unknown; name?: unknown; props?: unknown; children?: unknown };

/** The label a layer shows or is named by: its text, label, title or name (first one set), trimmed; "" when none. */
function labelOfLayer(layer: Named): string {
  const props = typeof layer.props === 'object' && layer.props !== null ? (layer.props as Record<string, unknown>) : {};
  for (const v of [layer.children, props.label, props.title, layer.name]) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return '';
}

/** The place words of an ask (docs/DESIGN.md, review words): which clauses stack, free or move parts. A negated clause ("do not stack") is not a place ask. */
export function placeAsk(ask: string): PlaceAsk {
  let toFlow = false;
  let toFree = false;
  let layout = false;
  const moves: PlaceClause[] = [];
  for (const clause of splitClauses(ask)) {
    const facts = factsOf(clause, NO_LABELS);
    if (facts.negated) continue;
    if (facts.place === null) {
      if (facts.verb === 'add' && facts.parts.size > 0 && !facts.parts.has('menu')) layout = true;
      continue;
    }
    layout = true;
    if (facts.place.kind === 'flow') toFlow = true;
    else if (facts.place.kind === 'free') toFree = true;
    else moves.push(facts.place);
  }
  return { toFlow, toFree, moves, layout, stems: new Set(stemsOf(ask)) };
}

/** True when a move clause names the layer: its part word, or its label. A move clause that names no part names no layer. */
const clauseNames = (clause: PlaceClause, layer: Named): boolean => {
  const part = typeof layer.type === 'string' ? PART_OF_TYPE[layer.type] : undefined;
  return (part !== undefined && clause.parts.has(part)) || mentions(clause.stems, labelOfLayer(layer));
};

export function namedByMove(ask: PlaceAsk, layer: Named): boolean {
  return ask.moves.some((clause) => clauseNames(clause, layer));
}

/** True when the ask's words mention the page's title. */
export const namesPage = (ask: PlaceAsk, title: string): boolean => mentions(ask.stems, title);

/** A place clause is judged by place changes only: flow by a grid turned off, free by a grid turned on or a part placed, move by a part moved or resized. */
function placeExplains(info: Info, p: PlaceClause): boolean {
  const at = info.place;
  if (at === null) return false;
  if (p.kind === 'flow') return at.kind === 'flow';
  if (p.kind === 'free') return at.kind === 'free' || at.kind === 'placed';
  if (at.kind !== 'move') return false;
  return p.parts.size === 0 || (at.layer !== null && clauseNames(p, at.layer));
}

const hasAny = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => [...a].some((x) => b.has(x));
const tableOfField = (id: string): string => id.slice(0, id.indexOf('.'));

/** A part of the kind the clause names came or went, on the table the clause names when it names one (a chart of Clients is not a chart of Jobs). */
function partMatches(info: Info, f: Facts): boolean {
  for (const part of f.parts) {
    if (!info.parts.has(part)) continue;
    const tables = info.partTables.get(part);
    if (tables === undefined || f.tableHits.size === 0 || hasAny(f.tableHits, tables)) return true;
  }
  return false;
}

function explains(info: Info, f: Facts): boolean {
  if (f.place !== null) {
    if (placeExplains(info, f.place)) return true;
    // A clause with an ordinary verb that a place word misled is still judged by the ordinary rules below.
    // So is a move with no ordinary verb ("Move Orders to the menu" is a nav change); flow and free are judged by place changes only.
    if (f.verb === null && f.place.kind !== 'move') return false;
  }
  if (f.verb !== null && !KINDS_OF_VERB[f.verb].some((k) => info.kinds.has(k))) return false;
  // "Rename Jobs to Projects" is not done by Jobs becoming Tasks: the new label has to carry the words the clause gives it.
  if (f.verb === 'rename' && info.newLabel !== null && f.renameTo.size > 0 && ![...f.renameTo].every((w) => info.newLabel?.has(w))) return false;
  const allow = (c: NameClass): boolean => f.classes.size === 0 || f.classes.has(c);
  // An edit inside a page or table names the page or table only in passing: it counts when the clause says nothing more than that
  // (no word left over, no field to find, no part to find). The thing itself coming, going or renamed needs only its name.
  const containerOk = info.direct || (f.unknown === 0 && f.fieldsNamed === 0 && f.parts.size === 0);
  if (allow('table') && containerOk && hasAny(f.tableHits, info.tables)) return true;
  if (allow('page') && containerOk && hasAny(f.pageHits, info.pages)) return true;
  // "A table for my tutors with their name and email" is also met by fields added to a table that already had that label.
  // Through that alternative alone the field's own table has to be one the clause names.
  const viaTable = !allow('field');
  if (allow('field') || ((f.verb === null || f.verb === 'add') && f.classes.has('table') && info.kinds.has('added'))) {
    for (const id of info.fields) {
      if (f.fieldHits.has(id) && (viaTable ? f.tableHits.has(tableOfField(id)) : f.tableHits.size === 0 || f.tableHits.has(tableOfField(id)))) return true;
    }
  }
  if (partMatches(info, f)) return true;
  if (f.look && info.look) return true;
  if (f.classes.size === 0 && containerOk && hasAny(f.tableHits, info.softTables)) return true;
  // No name to compare: "Add a page", "Remove a table". Only when every content word of the clause is accounted for.
  if (f.unknown === 0) {
    for (const cls of f.classes) {
      const named = cls === 'table' ? f.tableHits : cls === 'field' ? f.fieldHits : f.pageHits;
      if (named.size === 0 && info.areas.has(cls)) return true;
    }
  }
  return false;
}

/** A thing to keep ("a list of the repair people: name, phone", "keep track of deposits"): made on Data, not a part. */
const KEEPS_THING = /\b(?:list of|keep track|track of)\b/i;
/** Part words no PART_OF_WORD entry has: "three number boxes", "a dashboard". */
const PART_LIKE = /\b(?:boxes|box|tiles?|dashboard|chart|graph|button)\b/i;

function exitOf(f: Facts, clause: string): AskExit | null {
  if (f.look) return { kind: 'look', label: EXIT_LOOK };
  if (KEEPS_THING.test(clause)) return { kind: 'data', label: EXIT_DATA };
  if (f.classes.has('page') || f.parts.size > 0 || PART_LIKE.test(clause)) return { kind: 'design', label: EXIT_DESIGN };
  if (f.classes.has('table') || f.classes.has('field') || f.tableHits.size > 0 || f.fieldHits.size > 0) return { kind: 'data', label: EXIT_DATA };
  if (f.pageHits.size > 0) return { kind: 'design', label: EXIT_DESIGN };
  return null;
}

const SHOWN_AS: Readonly<Record<string, string>> = { Heading: 'a heading', Button: 'a button', Link: 'a button' };

/** Every text the person reads that can carry a name: table labels, page titles, menu labels, headings and button texts. */
function shownTexts(spec: AppSpec): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  for (const t of spec.tables) out.push({ kind: 'the table name', text: t.label });
  for (const n of spec.nav) out.push({ kind: 'the menu', text: n.label });
  for (const page of spec.pages) {
    out.push({ kind: 'a page title', text: page.title });
    const stack: unknown[] = [page.layout];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      if (typeof item !== 'object' || item === null) continue;
      const layer = item as Named;
      const props = typeof layer.props === 'object' && layer.props !== null ? (layer.props as Record<string, unknown>) : {};
      const kind = typeof layer.type === 'string' ? SHOWN_AS[layer.type] : undefined;
      if (kind !== undefined && typeof layer.children === 'string') out.push({ kind, text: layer.children });
      for (const [key, as] of [['title', 'a heading'], ['label', 'a button'], ['submitLabel', 'a button']] as const) if (typeof props[key] === 'string') out.push({ kind: as, text: props[key] });
      if (Array.isArray(layer.children)) stack.push(...(layer.children as unknown[]));
    }
  }
  return out;
}

/** For a rename: the old name and where it still shows (it was there in the base and is there after), when the new name does not carry it. */
function stillOldName(f: Facts, clause: string, before: AppSpec, after: AppSpec): { old: string; kinds: string[] } | null {
  const pairs: [string, string][] = [];
  for (const id of f.tableHits) {
    const b = before.tables.find((t) => t.id === id)?.label;
    const a = after.tables.find((t) => t.id === id)?.label;
    if (b !== undefined && a !== undefined && b !== a) pairs.push([b, a]);
  }
  for (const id of f.pageHits) {
    const b = before.pages.find((p) => p.id === id)?.title;
    const a = after.pages.find((p) => p.id === id)?.title;
    if (b !== undefined && a !== undefined && b !== a) pairs.push([b, a]);
  }
  const said = new Set(stemsOf(clause));
  // "Rename the Jobs table to Projects": only that thing's own label counts; "everywhere", "in the app" and "all" keep the every-place rule.
  const one = f.classes.size === 1 && !/\b(?:everywhere|in the app|all)\b/i.test(clause);
  const own = one ? (f.classes.has('table') ? ['the table name'] : f.classes.has('page') ? ['a page title', 'the menu'] : null) : null;
  const base = new Set(shownTexts(before).map((x) => x.text));
  for (const [old, now] of pairs) {
    if (!mentions(said, old) || mentions(new Set(stemsOf(now)), old)) continue;
    const kinds = [...new Set(shownTexts(after).filter((x) => base.has(x.text) && (own === null || own.includes(x.kind)) && mentions(new Set(stemsOf(x.text)), old)).map((x) => x.kind))];
    if (kinds.length > 0) return { old, kinds };
  }
  return null;
}

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const PART_ASK: readonly { part: string; re: RegExp }[] = [
  { part: 'number', re: /\b(?:(\w+)\s+(?:(?:stat|number|big)\s+)?)?(?:tiles?|boxes|stat\s+cards?)\b/i },
  { part: 'chart', re: /\b(?:(\w+)\s+)?(?:charts?|graphs?)\b/i },
];

const numOf = (w: string): number => Math.max(NUMBER_WORDS.indexOf(w) + 1, /^\d+$/.test(w) ? Number(w) : 0);
const partTotal = (page: Page | undefined, part: string): number => [...pageParts(page)].reduce((n, [k, v]) => n + (k.startsWith(`${part}${PART_TABLE_SEP}`) ? v : 0), 0);

/** An adding tile or chart clause is Done only when that part type was added on the pages it names (home for "dashboard" or "home" or none named), in the count it names; a heading or Section echoing the words is no part. Data asks ("a table for the tiles we sell") and clauses about existing tiles are not gated. */
function partAsked(f: Facts, clause: string, labels: Labels, before: AppSpec, after: AppSpec, strip?: string): boolean {
  if (f.classes.has('table') || f.classes.has('field') || KEEPS_THING.test(clause)) return true;
  const raw = tokens(clause);
  const named = after.pages.filter((p) => f.pageHits.has(p.id));
  const home = after.pages.find((p) => p.route === '/') ?? after.pages[0];
  const pages = strip !== undefined ? after.pages.filter((p) => p.id === strip) : named.length > 0 ? named : raw.includes('home') || raw.includes('dashboard') ? [home] : after.pages;
  const inLabel = (w: string): boolean => [labels.tables, labels.fields].some((map) => [...map.values()].some((ls) => ls.some((l) => tokens(l).some((t) => stem(t) === stem(w)))));
  return PART_ASK.every(({ part, re }) => {
    const m = re.exec(clause);
    if (m === null || inLabel(m[0].split(/\s+/).pop() ?? '')) return true;
    const word = (m[1] ?? '').toLowerCase();
    if (f.verb === null && !raw.includes('new') && numOf(word) === 0 && word !== 'a' && word !== 'an') return true;
    return pages.some((p) => partTotal(p, part) - partTotal(before.pages.find((b) => b.id === p?.id), part) >= Math.max(1, numOf(word)));
  });
}

/** "The tiles show hours": a verbless clause about existing tiles is met by an edit inside a page that has them. */
const tileEdited = (info: Info, f: Facts, after: AppSpec): boolean =>
  f.verb === null && f.parts.has('number') && info.kinds.has('changed') && after.pages.some((p) => info.pages.has(p.id) && (f.pageHits.size === 0 || f.pageHits.has(p.id)) && partTotal(p, 'number') > 0);

/** The ids of the free Grids of a page (none for no page). */
function freeGridIds(page: Page | undefined): Set<string> {
  const out = new Set<string>();
  const stack: unknown[] = page === undefined ? [] : [page.layout];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const layer = item as { id?: string; type?: unknown; props?: { placement?: unknown }; children?: unknown };
    if (layer.type === 'Grid' && layer.props?.placement === 'free' && layer.id !== undefined) out.add(layer.id);
    if (Array.isArray(layer.children)) stack.push(...(layer.children as unknown[]));
  }
  return out;
}

const REMOVED_PARTS: ReadonlySet<string> = new Set(['form', 'list', 'chart', 'button']);

/** "Removes the Repairs form from Repairs.": one line for each form, list, chart or button a page lost, for a layout change no clause explained. */
function removedParts(c: SpecChange, before: AppSpec, after: AppSpec): SpecChange[] {
  const id = c.path.split('.')[1];
  const was = before.pages.find((p) => p.id === id);
  const now = after.pages.find((p) => p.id === id);
  if (c.area !== 'page' || c.path !== `pages.${id}.layout` || was === undefined || now === undefined) return [];
  const left = pageParts(now);
  const out: SpecChange[] = [];
  for (const [key, n] of pageParts(was)) {
    const [part, table = ''] = key.split(PART_TABLE_SEP);
    if (!REMOVED_PARTS.has(part) || (left.get(key) ?? 0) >= n) continue;
    const label = before.tables.find((t) => t.id === table)?.label;
    out.push({ kind: 'removed', area: 'page', path: `${c.path}.${key}`, sentence: `Removes ${label === undefined ? 'a' : `the ${label}`} ${part} from ${now.title}.`, destructive: false });
  }
  return out;
}

const STRIP = /^On the page (.+?): /;

export function askOutcome({ ask, changes, before, after }: AskInput): AskOutcome {
  const labels = labelsOf(before, after);
  const infos = changes.map((c) => infoOf(c, before, after));
  // A strip ask ("On the page Home: ...") is judged by the named page's changes only, never by another page's.
  const named = STRIP.exec(ask)?.[1];
  const strip = named === undefined ? undefined : (after.pages.find((p) => p.title === named) ?? before.pages.find((p) => p.title === named))?.id;
  const other = (i: number): boolean => strip !== undefined && infos[i].pages.size > 0 && !infos[i].pages.has(strip);
  const newFree = strip !== undefined && [...freeGridIds(after.pages.find((p) => p.id === strip))].some((g) => !freeGridIds(before.pages.find((p) => p.id === strip)).has(g));
  const explained = new Set<number>();
  const lines: AskLine[] = [];
  for (const clause of splitClauses(ask)) {
    const bare = strip === undefined ? clause : clause.replace(STRIP, '');
    const facts = factsOf(bare, labels);
    if (facts.place === null && facts.verb === null && facts.unknown === 0 && facts.classes.size === 0 && facts.parts.size === 0 && !facts.look && facts.tableHits.size === 0) continue;
    // A table that is in neither spec cannot have been the target, whatever else the change did (the Notes field added to Items is not Notes on Moons).
    const gated = facts.place === null && !facts.negated && (facts.verb === null || facts.verb === 'add') && !partAsked(facts, bare, labels, before, after, strip);
    // A thing to keep or a field on a table is Done only by the tables changing, never by a page with matching words.
    const data = facts.classes.has('table') || facts.classes.has('field') || (strip === undefined && KEEPS_THING.test(clause) && !facts.classes.has('page') && !/\b(?:home|dashboard)\b/i.test(clause));
    const noFree = strip !== undefined && facts.place?.kind === 'free' && !newFree;
    const matched =
      gated || noFree || (facts.unknownTable && facts.place === null)
        ? []
        : infos.flatMap((info, i) => (!other(i) && (!data || info.areas.has('table') || info.areas.has('field')) && (explains(info, facts) || tileEdited(info, facts, after)) ? [i] : []));
    if (facts.negated) {
      // "Don't add a chart": never Done. When the thing was made anyway the clause is Not done (its changes stay under It also
      // changed); when it was not made the person's wish held, and there is nothing to report.
      if (matched.length > 0) lines.push({ done: false, clause, text: `${ASK_NOT_DONE_PREFIX}${clause}`, exit: exitOf(facts, clause) });
      continue;
    }
    for (const i of matched) explained.add(i);
    if (facts.place !== null && matched.length > 0) {
      // A Done place clause also explains the "Changes the layout of Home" line of the pages it touched.
      const pages = new Set(matched.map((i) => changes[i].path.split('.')[1]));
      changes.forEach((c, i) => {
        const seg = c.path.split('.');
        if (c.area === 'page' && seg.length === 3 && seg[2] === 'layout' && pages.has(seg[1])) explained.add(i);
      });
    }
    const left = matched.length > 0 && (facts.verb === 'rename' || tokens(clause).includes('call')) ? stillOldName(facts, clause, before, after) : null;
    if (left !== null) {
      lines.push({ done: false, clause, text: `${ASK_NOT_DONE_PREFIX}${clause} (still says ${left.old} in ${left.kinds.join(', ')})`, exit: { kind: 'design', label: EXIT_DESIGN } });
      continue;
    }
    const done = matched.length > 0;
    lines.push({ done, clause, text: `${done ? ASK_DONE_PREFIX : ASK_NOT_DONE_PREFIX}${clause}`, exit: done ? null : exitOf(facts, clause) });
  }
  return {
    lines,
    alsoChanged: changes.flatMap((c, i) => (explained.has(i) || isPlaceChange(c) ? [] : [c, ...removedParts(c, before, after)])),
    nothingChanged: changes.length === 0,
    missedAll: lines.length > 0 && lines.every((l) => !l.done),
  };
}
