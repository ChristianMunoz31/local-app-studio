// "Remove it from those parts too" (DESIGN-phase14.md P-04). After a field or table is taken out on the Data step, the pages that
// still use it have problems. This pure module takes those references out of the pages: one problem at a time, as the validator
// reports it, until the design validates or a problem has no safe fix. Nothing is mutated; the input is copied first.
//
// What each kind of problem becomes:
//   a page source on a missing table        the source goes, then every part that read it goes
//   a filter or sort on a missing field     that filter or sort goes
//   a list prop (columns, fields)           the field leaves the list; an empty list goes, so the part falls back to its defaults
//   Chart group by                          the next choice field of the table, or the Chart goes when there is none
//   another prop on a missing field/table  the prop is cleared; a part that still cannot do without it goes
//   a link field to a missing table         that field goes from its table (and the result names it, so the notice can)
import type { AppSpec, JsonValue, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { stableJson } from './stableJson';
import { validateSpec } from './validate';

/** A link field of another table that went because the table it pointed at is gone (by labels, for the notice). */
export interface RemovedLink {
  field: string;
  table: string;
}

/** `links`: the link fields taken out of their tables, in the order they went; the person is told about each one. */
export type RemoveReferencesResult = { ok: true; spec: AppSpec; changed: boolean; links: RemovedLink[] } | { ok: false };

const MAX_ROUNDS = 300;

const SOURCE_TABLE_RE = /^pages\.(\d+)\.sources\.(\d+)\.table$/;
const SOURCE_LIST_RE = /^pages\.(\d+)\.sources\.(\d+)\.(where|orderBy)\.(\d+)(?:\..*)?$/;
const LINK_FIELD_RE = /^tables\.(\d+)\.fields\.(\d+)\.table$/;
const PART_PROP_RE = /^(pages\.\d+\.layout(?:\.children\.\d+)*)\.props\.([^.]+)(?:\.(.+))?$/;

const FIXABLE_CODES: ReadonlySet<string> = new Set(['unknown_field', 'unknown_table', 'unknown_source', 'wrong_field_type', 'invalid_props', 'wrong_source_mode']);

interface Where {
  page: number;
  /** The children list that holds the part and its index, or null for the page's top part (which cannot go). */
  siblings: LayoutLayer[] | null;
  index: number;
  layer: LayoutLayer;
}

/** The part at a path like "pages.0.layout.children.1.children.0", or null. */
function locate(spec: AppSpec, layerPath: string): Where | null {
  const segments = layerPath.split('.');
  const page = Number(segments[1]);
  let layer = spec.pages[page]?.layout;
  if (layer === undefined) return null;
  let siblings: LayoutLayer[] | null = null;
  let index = 0;
  for (let i = 3; i + 1 < segments.length; i += 2) {
    const kids: LayoutLayer[] | string = layer.children;
    const k = Number(segments[i + 1]);
    if (!Array.isArray(kids) || kids[k] === undefined) return null;
    siblings = kids;
    index = k;
    layer = kids[k];
  }
  return { page, siblings, index, layer };
}

/** Takes a part (with what is inside it) out of its page. False for the page's top part. */
function dropPart(where: Where): boolean {
  if (where.siblings === null) return false;
  where.siblings.splice(where.index, 1);
  return true;
}

/** The first choice field of the table a Chart's source reads, or undefined. */
function nextChoiceField(spec: AppSpec, where: Where): string | undefined {
  const sourceId = where.layer.props.source;
  const source = spec.pages[where.page]?.sources.find((s) => s.id === sourceId);
  const table = spec.tables.find((t) => t.id === source?.table);
  return table?.fields.find((f) => f.type === 'select')?.id;
}

/** Fixes one problem in a part's props. False when nothing could be done. */
function fixPartProp(spec: AppSpec, layerPath: string, prop: string, rest: string | undefined): boolean {
  const where = locate(spec, layerPath);
  if (where === null) return false;
  const props = where.layer.props;
  const value: JsonValue | undefined = props[prop];
  // One entry of a list: the field leaves the list, and an empty list goes so the part uses its own defaults.
  if (Array.isArray(value) && rest !== undefined && /^\d+$/.test(rest)) {
    const next = value.filter((_, i) => i !== Number(rest));
    if (next.length === value.length) return false;
    if (next.length === 0) delete props[prop];
    else props[prop] = next;
    return true;
  }
  if (where.layer.type === 'Chart' && prop === 'groupBy' && value !== undefined) {
    const next = nextChoiceField(spec, where);
    if (next !== undefined && next !== value) {
      props.groupBy = next;
      return true;
    }
    return dropPart(where);
  }
  if (value !== undefined) {
    delete props[prop];
    return true;
  }
  // The prop is already gone and the part still cannot do without it.
  if (prop === 'field') {
    for (const key of ['stat', 'measure']) {
      const mode = props[key];
      if (mode !== undefined && mode !== 'count') {
        props[key] = 'count';
        return true;
      }
    }
  }
  return dropPart(where);
}

/** Fixes one problem. False when it has no safe fix or the fix changed nothing. */
function fixIssue(spec: AppSpec, issue: SpecIssue, links: RemovedLink[]): boolean {
  let m = SOURCE_TABLE_RE.exec(issue.path);
  if (m) {
    const sources = spec.pages[Number(m[1])]?.sources;
    if (sources === undefined || sources[Number(m[2])] === undefined) return false;
    sources.splice(Number(m[2]), 1);
    return true;
  }
  m = SOURCE_LIST_RE.exec(issue.path);
  if (m) {
    const source = spec.pages[Number(m[1])]?.sources[Number(m[2])];
    const list = source === undefined ? undefined : source[m[3] as 'where' | 'orderBy'];
    if (list === undefined || list[Number(m[4])] === undefined) return false;
    list.splice(Number(m[4]), 1);
    return true;
  }
  m = LINK_FIELD_RE.exec(issue.path);
  if (m) {
    const table = spec.tables[Number(m[1])];
    const gone = table?.fields[Number(m[2])];
    if (table === undefined || gone === undefined) return false;
    table.fields.splice(Number(m[2]), 1);
    links.push({ field: gone.label, table: table.label });
    return true;
  }
  m = PART_PROP_RE.exec(issue.path);
  if (m) {
    // A part that reads a source that is gone goes with it.
    if (issue.code === 'unknown_source') {
      const where = locate(spec, m[1]);
      return where !== null && dropPart(where);
    }
    return fixPartProp(spec, m[1], m[2], m[3]);
  }
  return false;
}

/** Lower rank first: a missing source table before the parts that read it, a part's source before its other props. */
function rank(issue: SpecIssue): number {
  if (LINK_FIELD_RE.test(issue.path) || SOURCE_TABLE_RE.test(issue.path)) return 0;
  if (issue.code === 'unknown_source') return 1;
  if (SOURCE_LIST_RE.test(issue.path)) return 2;
  return 3;
}

const fixable = (issue: SpecIssue): boolean => FIXABLE_CODES.has(issue.code) && (LINK_FIELD_RE.test(issue.path) || !issue.path.startsWith('tables'));

/**
 * Takes out of the pages every reference to a field or table the design no longer has. `ok` is true only when the result
 * validates; `changed` is false when the design was already fine. Never throws and never changes `input`.
 */
export function removeReferences(input: AppSpec): RemoveReferencesResult {
  const spec = structuredClone(input);
  let changed = false;
  const links: RemovedLink[] = [];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { issues } = validateSpec(spec);
    if (issues.length === 0) return { ok: true, spec, changed, links };
    const issue = issues.filter(fixable).sort((a, b) => rank(a) - rank(b))[0];
    if (issue === undefined) return { ok: false };
    const before = stableJson(spec);
    if (!fixIssue(spec, issue, links) || stableJson(spec) === before) return { ok: false };
    changed = true;
  }
  return { ok: false };
}

/** True when pressing "Remove it from those parts too" would leave a design that validates and would change something. */
export function canRemoveReferences(input: AppSpec): boolean {
  const result = removeReferences(input);
  return result.ok && result.changed;
}
