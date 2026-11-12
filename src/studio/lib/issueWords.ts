// Plain words for problems (DESIGN-phase12.md 2.3, UX-81, UX-84). Pure, read only: it turns the code paths and the
// validator sentences of src/spec and src/catalog into places and sentences a person can read. It never changes them.
//
// Stable API, shared by the Apps page (import refusals, App settings, a damaged app), Data and Design:
//   pathWords(path, spec?)                 the place in words ("Table Crews, field Name", "Page Home, Table of records"), or null.
//   plainMessage(message, spec?, before?)  one validator sentence in plain words; an unknown sentence passes through unchanged.
//   plainIssue(issue, spec?, before?)      "<place>: <sentence>", or the sentence alone when there is no place. No code path is ever shown.
// `before` is the saved design: the label of a table, field or page that `spec` no longer has is read from it, so a removed
// thing is named by its label. The sentences about a missing field, table or page, and about a feature's parts and settings,
// never print an id list or created_at and updated_at.
//
// Rules, in order. Paths: specVersion, app.*, tables.N[.fields.K], pages.N[.layout...], menu.*, theme.*; anything else null.
// Messages: missing, wrong form, too small, too big, "has no source", the menu bar list, "X can only hold: A, B." and
// finally every remaining PascalCase part type is replaced by its plain label from the catalog's own label data.
import type { AppSpec, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { partLabel } from '@/studio/showcase/entries';
import { FIELD_TYPE_NAMES } from './specDiff';

const APP_WORDS: Readonly<Record<string, string>> = {
  name: 'App name',
  slug: 'File name',
  identifier: 'Windows app name',
  version: 'Version',
  description: 'App description',
  icon: 'App icon',
};

/** A zero based path segment as a list index, or null. */
function indexOf(segment: string | undefined): number | null {
  return segment !== undefined && /^\d+$/.test(segment) ? Number(segment) : null;
}

const named = (label: string | undefined, index: number): string => (label !== undefined && label.trim() !== '' ? label : String(index + 1));

/** The place a problem is at, in words, or null when the path has no plain place. */
export function pathWords(path: string, spec?: AppSpec | null): string | null {
  const parts = path.split('.');
  const head = parts[0];
  if (head === 'specVersion') return 'File version';
  if (head === 'app') {
    if (parts.length === 1) return 'App';
    const word = parts[1] === undefined ? undefined : APP_WORDS[parts[1]];
    return word ?? null;
  }
  if (parts.length === 1 && (head === 'tables' || head === 'pages')) return head === 'tables' ? 'Tables' : 'Pages';
  if (head === 'menu') return 'Menu bar';
  if (head === 'theme') return 'Look';
  if (head === 'tables') {
    const t = indexOf(parts[1]);
    if (t === null) return null;
    const table = `Table ${named(spec?.tables[t]?.label, t)}`;
    if (parts[2] === 'rules') return `an automation of ${named(spec?.tables[t]?.label, t)}`;
    if (parts[2] !== 'fields') return table;
    const f = indexOf(parts[3]);
    if (f === null) return table;
    const field = named(spec?.tables[t]?.fields[f]?.label, f);
    return parts[4] === 'autoNumber' ? `the numbering of ${field}` : `${table}, field ${field}`;
  }
  if (head === 'pages') {
    const p = indexOf(parts[1]);
    if (p === null) return null;
    const page = `Page ${named(spec?.pages[p]?.title, p)}`;
    if (parts[2] !== 'layout' || parts.length <= 3) return page;
    const root = spec?.pages[p]?.layout;
    const layer = root === undefined ? undefined : layerAt(root, parts.slice(3));
    return `${page}, ${layer === undefined ? 'a part' : partLabel(layer.type)}`;
  }
  return null;
}

/** The layer a path below "layout" names ("children.0.children.1.props.x" is the second child of the first child), or undefined. */
function layerAt(root: LayoutLayer, rest: readonly string[]): LayoutLayer | undefined {
  let layer = root;
  for (let i = 0; i + 1 < rest.length && rest[i] === 'children'; i += 2) {
    const k = indexOf(rest[i + 1]);
    const kids = layer.children;
    if (k === null || !Array.isArray(kids) || kids[k] === undefined) return undefined;
    layer = kids[k];
  }
  return layer;
}

const PASCAL_RE = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const HOLD_RE = /^(.+) can only hold: (.+)\.$/;

const LISTED = String.raw`\. Use one of: .*\.$`;
const PART = String.raw`(?:(\w+): )?`;
const NO_FIELD_RE = new RegExp(String.raw`^${PART}[Tt]able "([^"]*)" has no field "([^"]*)"${LISTED}`);
const NO_TABLE_RE = new RegExp(String.raw`^${PART}[Tt]here is no table "([^"]*)"${LISTED}`);
const NO_PAGE_RE = new RegExp(String.raw`^${PART}[Tt]here is no page "([^"]*)"${LISTED}`);
const READ_ONLY_RE = new RegExp(String.raw`^${PART}"([^"]*)" is filled in by the app and cannot be edited${LISTED}`);
const WRONG_TYPE_RE = new RegExp(String.raw`^${PART}"([^"]*)" is a (\w+) field, but this prop needs [^.]*${LISTED}`);
const WRONG_MODE_RE = new RegExp(String.raw`^(\w+) needs a (list|record) source, but "[^"]*" is a (?:list|record) source${LISTED}`);
const NO_PART_RE = /^There is no part "([^"]*)" in the fragment\.$/;
const UNUSED_PARAM_RE = /^Parameter "([^"]*)" is not used by any binding\.$/;
const FEATURE_PROPS_RE = /^A Feature needs exactly featureId \(text\) and params/;
const NO_PARAM_RE = /^There is no parameter "([^"]*)"\.$/;
const NO_FEATURE_RE = /^There is no feature "([^"]*)"(?:\. Use one of: .*)?\.$/;

/** Labels for the words of a sentence: the design first, then the saved one, then the inside name itself. */
interface Names {
  table(id: string): string;
  field(tableId: string, fieldId: string): string;
  page(id: string): string;
}

function namesOf(spec?: AppSpec | null, before?: AppSpec | null): Names {
  const designs = [spec, before].filter((d): d is AppSpec => d !== undefined && d !== null);
  const pick = (labels: Array<string | undefined>, fallback: string): string => {
    const found = labels.find((l) => l !== undefined && l.trim() !== '');
    return found ?? fallback;
  };
  return {
    table: (id) => pick(designs.map((d) => d.tables.find((t) => t.id === id)?.label), id),
    field: (tableId, fieldId) => pick(designs.map((d) => d.tables.find((t) => t.id === tableId)?.fields.find((f) => f.id === fieldId)?.label), fieldId),
    page: (id) => pick(designs.map((d) => d.pages.find((p) => p.id === id)?.title), id),
  };
}

interface Taught {
  part: string | null;
  text: string;
}

/** The plain sentence of a message the catalog taught this module, with the part it names (a part label), or null. */
function taught(message: string, names: Names): Taught | null {
  const partOf = (type: string | undefined): string | null => (type === undefined ? null : partLabel(type));
  let m = NO_FIELD_RE.exec(message);
  if (m) return { part: partOf(m[1]), text: `The table ${names.table(m[2])} has no field ${names.field(m[2], m[3])}.` };
  m = NO_TABLE_RE.exec(message);
  if (m) return { part: partOf(m[1]), text: `There is no table ${names.table(m[2])}.` };
  m = NO_PAGE_RE.exec(message);
  if (m) return { part: partOf(m[1]), text: `There is no page ${names.page(m[2])}.` };
  m = READ_ONLY_RE.exec(message);
  if (m) return { part: partOf(m[1]), text: 'That field is filled in by the app, so it cannot be edited here.' };
  m = WRONG_TYPE_RE.exec(message);
  if (m) {
    const kind = (FIELD_TYPE_NAMES as Record<string, string | undefined>)[m[3]] ?? m[3];
    return { part: partOf(m[1]), text: `The field ${m[2]} is a ${kind} field, which this part cannot use.` };
  }
  m = WRONG_MODE_RE.exec(message);
  if (m) return { part: partOf(m[1]), text: `This part needs ${m[2] === 'list' ? 'a list of records' : 'one record'}. Press Connect on it.` };
  m = NO_PART_RE.exec(message);
  if (m) return { part: null, text: `A part named ${m[1]} is not in this feature.` };
  m = UNUSED_PARAM_RE.exec(message);
  if (m) return { part: null, text: `The setting ${m[1]} is not used by any part of this feature.` };
  if (FEATURE_PROPS_RE.test(message)) return { part: null, text: 'This feature part is damaged. Remove it and add the feature again.' };
  m = NO_PARAM_RE.exec(message);
  if (m) return { part: null, text: `This feature has no setting named ${m[1]}.` };
  m = NO_FEATURE_RE.exec(message);
  if (m) return { part: null, text: `The feature ${m[1]} is not there.` };
  return null;
}

const withPart = (found: Taught): string => (found.part === null ? found.text : `${found.part}: ${found.text}`);

/** A list of part types ("Button, Link, SearchBox") as plain labels. */
const typesInWords = (list: string): string =>
  list
    .split(',')
    .map((type) => partLabel(type.trim()))
    .join(', ');

const NEEDS_VALUE_RE = /^Feature "[^"]*" needs a value for "[^"]*" \((.+)\)\.$/;
const TOO_SMALL_ONE_RE = /^Too small: expected string to have >=1 characters/;
const PATTERN_RE = /^Invalid string: must match pattern/;

/** A name's two validator sentences when it is empty: too short, and not the shape a name has. */
export const isEmptyName = (message: string): boolean => TOO_SMALL_ONE_RE.test(message) || PATTERN_RE.test(message);

/** A feature setting that has no value (an Update to latest or a placement that left one empty). */
const FILL_IN = (label: string): string => `Fill in ${label}.`;
/** A name that starts or ends with a space, or holds a character nobody can see. */
const NAME_SHAPE = 'This cannot start or end with a space, or hold a hidden character.';

/** One validator sentence in plain words. A sentence nobody taught this function passes through. */
export function plainMessage(message: string, spec?: AppSpec | null, before?: AppSpec | null): string {
  const found = taught(message, namesOf(spec, before));
  if (found) return withPart(found);
  const needs = NEEDS_VALUE_RE.exec(message);
  if (needs) return FILL_IN(needs[1]);
  if (PATTERN_RE.test(message)) return NAME_SHAPE;
  if (/^Invalid input: expected \w+, received undefined/.test(message) || /^Required$/.test(message)) return 'This is missing.';
  if (/^Invalid input/.test(message)) return 'This has the wrong form.';
  const small = /^Too small: expected string to have >=(\d+) characters/.exec(message);
  if (small) return `This needs at least ${small[1]} characters.`;
  if (/^Too big/.test(message)) return 'This is too long.';
  if (/has no source/.test(message)) return 'This part needs a table. Press Connect on it.';
  if (/^The menu bar can only hold:/.test(message)) return 'The menu bar takes buttons, links, search boxes, quick adds, text and rows.';
  const hold = HOLD_RE.exec(message);
  const base = hold ? `${hold[1]} can only hold: ${typesInWords(hold[2])}.` : message;
  return base.replace(PASCAL_RE, (type) => partLabel(type));
}

/** "<place>: <sentence>" for a problem, or the sentence alone when the path has no plain place. */
export function plainIssue(issue: SpecIssue, spec?: AppSpec | null, before?: AppSpec | null): string {
  const where = pathWords(issue.path, spec);
  const found = taught(issue.message, namesOf(spec, before));
  // The place already names the part ("Page Home, Table of records"), so the sentence does not name it twice.
  const what = found ? (found.part !== null && where !== null && where.endsWith(`, ${found.part}`) ? found.text : withPart(found)) : plainMessage(issue.message);
  return where === null ? what : `${where}: ${what}`;
}
