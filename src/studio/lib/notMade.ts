// What the prompt asked for that the design does not have (DESIGN-phase17.md P17-03). Pure, no React. Conservative by design: a word
// the rules are not sure of is left out, never reported, because a false "Not made" costs the person's trust as much as a miss.
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import { stem, stemsOf, tokens } from './promptWords';

export const NOT_MADE_PREFIX = 'Not made: ';
export const NOT_MADE_MORE = (count: number): string => `and ${count} more`;

const SHOWN = 8;

export interface NotMade {
  /** The things the prompt names that the design lacks, in the prompt's words (parts in plain words). */
  items: string[];
  /** "Not made: Clients, Jobs, a chart", or null when nothing is missing. */
  line: string | null;
}

/** Words that end in "s" without being a plural thing: verbs, small words, and words that are one thing. */
const NOT_THINGS: ReadonlySet<string> = new Set(
  (
    'this has was its is as does goes yes status address progress plus bonus focus news series species analytics settings always sometimes across ' +
    'perhaps besides less various times days hours weeks months years adds shows needs keeps works lets gives wants helps makes takes uses tracks ' +
    'lists holds stores covers includes contains opens sends gets looks runs sees says tells seems means thanks lots kinds sorts ones things records'
  ).split(' '),
);

/** A plural right after one of these is not a thing the app keeps ("a chart of jobs", "for my clients", "with amounts"). */
const NOT_AFTER: ReadonlySet<string> = new Set(
  (
    'a an the my our your their his her its this that these those of by for to in on at per each every all some any many few with from into ' +
    'one which who than like such'
  ).split(' '),
);

const ARTICLES: ReadonlySet<string> = new Set(['a', 'an', 'the', 'each', 'one', 'their', 'its', 'his', 'her', 'my', 'our', 'your']);
const PART_WORDS: ReadonlySet<string> = new Set(['chart', 'graph', 'form', 'menu', 'search', 'number', 'total', 'tile', 'button', 'page']);

/** A word right after a plural that shows the plural is a verb with an object ("manages clients"), not a thing in a list. */
const LIST_FOLLOW: ReadonlySet<string> = new Set(
  (
    'and or with by for in on of per to as from that which who are is can will has have so but then when where at into if also too ' +
    'plus not'
  ).split(' '),
);

const NEGATED_SPAN = /\b(?:do\s+not|don['’]?t|never|not|no|without)\b[^,;]*?(?=,|;|\bbut\b|$)/gi;
/** The sentence without what it says it does not want ("I don't need a chart", "no menu", "without a search box"). */
const withoutNegated = (sentence: string): string => sentence.replace(NEGATED_SPAN, ' ');

/** "I own six rental apartments": the plural after a count, in a sentence that opens with what the person owns or runs, is their business, not a table. */
const BUSINESS = /^i\s+(?:own|run|have|manage|rent)\s+(?:about\s+|around\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|a few|several)\s+(?:[a-z]+\s+){0,2}?[a-z]+s\b/i;
const withoutBusiness = (sentence: string): string => sentence.replace(BUSINESS, ' ');

/** The ways a prompt asks for a filtered view: "who hasn't paid", "which repairs are still open". */
const WHO_NOT = /\bwho\s+(?:hasn['’]?t|haven['’]?t|has not|have not|didn['’]?t|did not)\s+\w+/g;
const WHICH_OPEN = /\bwhich\s+(\w+)\s+(?:are|is)\s+((?:still\s+)?(?:open|unpaid|overdue|late|pending))\b/g;
const PLAIN_FILTER = /\b(?<!\ban?\s)(?:not paid|still open|overdue|unpaid)\b/g;

const capitalise = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
const withoutBrackets = (text: string): string => text.replace(/\([^)]*\)/g, ' ');

interface Candidate {
  /** The word as the prompt has it, capitalised. */
  name: string;
  stem: string;
  /** Field words the prompt names for it (a bracket after it, or "with a ..."). */
  fields: string[];
}

function sentencesOf(prompt: string): string[] {
  return prompt.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s !== '');
}

/** The field words of "with a date, a status and the crew": pieces that start with a or an, at most two words each. */
function withFields(sentence: string, at: number): string[] {
  const rest = withoutBrackets(sentence.slice(at)).replace(/^\s+with\s+/i, '').replace(/[.!?]+$/, '');
  const out: string[] = [];
  for (const piece of rest.split(/,|\band\b/)) {
    const words = tokens(piece);
    if (words.length < 2 || words.length > 3 || (words[0] !== 'a' && words[0] !== 'an')) continue;
    const field = words.slice(1);
    if (field.some((w) => PART_WORDS.has(w) || w === 'of' || w === 'per')) continue;
    out.push(field.join(' '));
  }
  return out;
}

/** Candidate tables and their fields from one sentence. */
function candidatesOf(sentence: string): Candidate[] {
  const found: Candidate[] = [];
  const add = (word: string, fields: string[]): void => {
    const s = stem(word);
    const known = found.find((c) => c.stem === s);
    if (known !== undefined) known.fields.push(...fields);
    else found.push({ name: capitalise(word.toLowerCase()), stem: s, fields });
  };

  // "Clients (name, phone, address)": a word with a bracket that no article leads in is a table, its bracket the fields.
  const bracket = /([A-Za-z]+)(\s+[A-Za-z]+)?\s*\(([^)]*)\)/g;
  for (let m = bracket.exec(sentence); m !== null; m = bracket.exec(sentence)) {
    const [, first, second, inside] = m;
    const word = second === undefined ? first : second.trim();
    const lead = second === undefined ? '' : first.toLowerCase();
    if (lead !== '' && ARTICLES.has(lead)) continue;
    if (!/^[A-Za-z]{3,}$/.test(word) || PART_WORDS.has(word.toLowerCase())) continue;
    add(word, inside.split(',').flatMap((f) => (tokens(f).length > 0 && tokens(f).length <= 2 ? [tokens(f).join(' ')] : [])));
  }

  // Plural things: "Jobs with a date", "members, plans and payments".
  const plain = withoutBrackets(sentence);
  const wordRe = /[A-Za-z]+/g;
  let before = '';
  for (let m = wordRe.exec(plain); m !== null; m = wordRe.exec(plain)) {
    const word = m[0];
    const lower = word.toLowerCase();
    const previous = before;
    before = lower;
    if (word.length < 4 || !lower.endsWith('s') || /(ss|us|is|ous)$/.test(lower) || NOT_THINGS.has(lower) || NOT_AFTER.has(previous)) continue;
    // "manages clients": a plural straight before another word that is not a list word is a verb with its object.
    const next = /^\s+([A-Za-z]+)/.exec(plain.slice(m.index + word.length));
    if (next !== null && !LIST_FOLLOW.has(next[1].toLowerCase())) continue;
    // The fields of "with a ...", only for the word the "with" follows.
    add(word, /^\s+with\s/i.test(plain.slice(m.index + word.length)) ? withFields(plain, m.index + word.length) : []);
  }
  return found;
}

/** Every layer type on the pages, and every layer type in the menu slots (Rows included). */
function typesOf(spec: AppSpec): { pages: Set<string>; menu: Set<string> } {
  const walk = (roots: readonly unknown[], into: Set<string>): void => {
    const stack: unknown[] = [...roots];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      if (typeof item !== 'object' || item === null) continue;
      const layer = item as { type?: unknown; children?: unknown };
      if (typeof layer.type === 'string') into.add(layer.type);
      if (Array.isArray(layer.children)) stack.push(...(layer.children as unknown[]));
    }
  };
  const pages = new Set<string>();
  const menu = new Set<string>();
  walk(spec.pages.map((p) => p.layout), pages);
  walk([...slotLayers(spec.menu, 'start'), ...slotLayers(spec.menu, 'end')], menu);
  return { pages, menu };
}

/** Which of the things the prompt names (tables, fields, parts, record pages) are not in `spec`. */
export function notMade(prompt: string, spec: AppSpec): NotMade {
  const items: string[] = [];
  const push = (item: string): void => {
    if (!items.includes(item)) items.push(item);
  };
  const sentences = sentencesOf(prompt).map((x) => withoutBusiness(withoutNegated(x)));

  const candidates: Candidate[] = [];
  for (const sentence of sentences) {
    for (const c of candidatesOf(sentence)) {
      const known = candidates.find((k) => k.stem === c.stem);
      if (known === undefined) candidates.push(c);
      else known.fields.push(...c.fields);
    }
  }
  const tableOf = (word: string): AppSpec['tables'][number] | undefined => spec.tables.find((t) => stemsOf(t.label).includes(stem(word)));

  const namedElsewhere = (word: string): boolean =>
    spec.tables.some((t) => t.fields.some((f) => stemsOf(f.label).includes(word))) || spec.pages.some((p) => stemsOf(p.title).includes(word));

  const { pages: pageTypes, menu: menuTypes } = typesOf(spec);
  const anywhere = (...types: string[]): boolean => types.some((t) => pageTypes.has(t) || menuTypes.has(t));

  // A table the ask took the page of ("Remove the Crews page") has no page on purpose.
  const pageRemoved = new Set<string>();
  const removeRe = /\b(?:remove|delete|drop|get rid of)\s+(?:the\s+)?(?:page\s+(?:for|of)\s+(?:the\s+)?([a-z]+)|([a-z]+)\s+page)\b/g;
  const lowered = prompt.toLowerCase();
  for (let m = removeRe.exec(lowered); m !== null; m = removeRe.exec(lowered)) pageRemoved.add(stem(m[1] ?? m[2]));
  // A table only another table points at (a lookup list) is picked from, not shown on a page of its own.
  const isLookupOnly = (id: string): boolean => spec.tables.some((t) => t.id !== id && t.fields.some((f) => f.type === 'reference' && f.table === id));

  const missingFields: string[] = [];
  for (const c of candidates) {
    const table = tableOf(c.stem);
    if (table === undefined) {
      // A plural that is a field ("Expenses" on Jobs) or a page ("Reports") is made too; only a word nothing in the design carries is missing.
      // "tiles for orders and revenue" names the Number tile part (StatCard), which the design has.
      const isTilePart = c.stem === 'tile' && anywhere('StatCard');
      if (!namedElsewhere(c.stem) && !isTilePart) push(c.name);
      continue;
    }
    // A table the prompt names that exists but that no page has a source of: the app keeps it and shows it nowhere.
    const pageLess = !spec.pages.some((p) => p.sources.some((src) => src.table === table.id));
    if (pageLess && !isLookupOnly(table.id) && !stemsOf(table.label).some((w) => pageRemoved.has(w))) push(`a page for ${table.label}`);
    for (const field of c.fields) {
      const words = stemsOf(field);
      const present = table.fields.some((f) => {
        const label = new Set(stemsOf(f.label));
        const own = new Set(words);
        return words.every((w) => label.has(w)) || [...label].every((w) => own.has(w));
      });
      if (!present) missingFields.push(`a ${field} field in ${table.label}`);
    }
  }
  missingFields.forEach(push);

  const text = withoutBrackets(sentences.join(' ')).toLowerCase();

  // A page for each record of a table the design does have, and no page that opens from a list for it.
  const perRe = /\ba page (?:for (?:each|every|one|a) |per )([a-z]+)/g;
  for (let m = perRe.exec(text); m !== null; m = perRe.exec(text)) {
    const table = tableOf(m[1]);
    if (table === undefined) continue;
    // Leniently: a page that opens from a list and has a record source of the table, or is named or addressed like it.
    const own = new Set(stemsOf(table.label));
    const has = spec.pages.some(
      (p) =>
        p.route.includes('/:') &&
        (p.sources.some((s) => s.mode === 'record' && s.table === table.id) ||
          p.route.toLowerCase().includes(table.id.toLowerCase()) ||
          stemsOf(p.title).some((w) => own.has(w))),
    );
    if (!has) push(m[0]);
  }

  if (/\b(?:chart|graph)s?\b/.test(text) && !anywhere('Chart')) push('a chart');
  // "the number of jobs" and "the total amount" are words about a field or a count, not a request for a Number tile.
  const numberAsk = /\b(?:one|a|an|the)\s+(?:(?:big|large|single)\s+)?(number(?!\s+of\b)|total(?!\s+\w))|\b(number|total)\s+tile\b/.exec(text);
  if (numberAsk !== null && !anywhere('StatCard')) push(`a ${numberAsk[1] ?? numberAsk[2]}`);
  if (/\b(?:a|an|the)\s+(?:\w+\s+){0,2}?form\b(?!\s+of)/.test(text) && !anywhere('RecordForm', 'QuickAdd')) push('a form');
  if (/\bmenu\s+button\b/.test(text)) {
    if (!menuTypes.has('Button') && !menuTypes.has('QuickAdd')) push('a menu button');
  } else if (/\b(?:a|an|the)\s+(?:\w+\s+)?menu\b/.test(text) && spec.nav.length === 0 && spec.menu === undefined) {
    push('a menu');
  }
  if (/\b(?:a|an)\s+search(?:\s+(?:box|bar))?\b|\bsearch\s+(?:box|bar)\b/.test(text) && !anywhere('SearchBox')) push('a search box');

  // A filtered view asked for ("who hasn't paid", "which repairs are still open") needs a page source with a where on a field of that table.
  const filtered = (table: AppSpec['tables'][number] | undefined): boolean =>
    spec.pages.some((p) =>
      p.sources.some((src) => (table === undefined || src.table === table.id) && src.where.some((c) => spec.tables.find((t) => t.id === src.table)?.fields.some((f) => f.id === c.field) === true)),
    );
  const raw = prompt.toLowerCase();
  const asked: { what: string; table: AppSpec['tables'][number] | undefined }[] = [];
  for (const m of raw.matchAll(WHO_NOT)) asked.push({ what: `people who haven't ${m[0].split(/ +/).pop()}`, table: /^pa(?:id|y)$/.test(m[0].split(/ +/).pop() ?? '') ? spec.tables.find((t) => stemsOf(t.label).includes('payment')) : undefined });
  for (const m of raw.matchAll(WHICH_OPEN)) asked.push({ what: `${m[1]} that are ${m[2]}`, table: tableOf(m[1]) });
  if (asked.length === 0) for (const m of raw.matchAll(PLAIN_FILTER)) asked.push({ what: m[0], table: undefined });
  for (const a of asked) if (!filtered(a.table)) push(`a list of only ${a.what}`);

  if (items.length === 0) return { items, line: null };
  const shown = items.slice(0, SHOWN);
  const more = items.length - shown.length;
  return { items, line: `${NOT_MADE_PREFIX}${shown.join(', ')}${more > 0 ? ` ${NOT_MADE_MORE(more)}` : ''}` };
}
