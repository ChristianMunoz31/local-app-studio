// Catalog checks for page layouts (docs/CATALOG.md, "Validation of layouts"). Pure. `checkLayout` is the hook passed to
// validateAppSpec; `checkLayer` checks one layer tree against a PartContext (the Studio server uses it for the spike
// layout, the designer for live marks). Codes: unknown_part, invalid_props, child_not_allowed, children_not_allowed,
// unknown_source, wrong_source_mode, unknown_field, wrong_field_type, unknown_page, action_needs_record, wrong_child_count
// sizing_not_allowed, grid_not_allowed and grid_overlap. `checkMenu` runs the same checks over the menu slots (place "menu"): a part's `menuProps` replace
// its props there and bindings are not checked, because the menu bar has no sources of its own.
import { collides, isFreeGridLayer, readGrid, readGridProps, rowEnd } from '@local-app-studio/runtime/spec/gridPlacement.ts';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement.ts';
import { MENU_SLOTS, slotLayers } from '@local-app-studio/runtime/spec/menuSlots.ts';
import type { AppSpec, AppSpecInput, JsonValue, LayoutCheckContext, LayoutLayer, MenuCheckContext, Page, SpecIssue } from '@local-app-studio/runtime/spec/schema.ts';
import { READ_ONLY_COLUMNS } from './bindings.ts';
import { PART_NAMES, getPartDefinition } from './definitions.ts';
import { UNSIZED_TYPES } from '@local-app-studio/runtime/catalog/parts/sizingClasses.ts';
import type { Binding, PartContext, PartDefinition } from './types.ts';

type PageInput = AppSpecInput['pages'][number];

/**
 * The PartContext of one page of a spec. Tolerates a spec that was not normalized (a missing `mode` is "list", missing
 * `sources` or `tables` are empty). Every table also offers created_at and updated_at as datetime fields.
 */
export function partContextFor(spec: AppSpec | AppSpecInput, page: Page | PageInput): PartContext {
  return contextOf(spec, page.sources ?? [], page.route);
}

type SourceInput = NonNullable<PageInput['sources']>[number];

function contextOf(spec: AppSpec | AppSpecInput, sources: readonly SourceInput[], route: string): PartContext {
  const tables = spec.tables ?? [];
  return {
    tableIds: tables.map((t) => t.id),
    pageIds: spec.pages.map((p) => p.id),
    sourceIds: sources.map((s) => s.id),
    sources: Object.fromEntries(sources.map((s) => [s.id, { table: s.table, mode: s.mode ?? 'list' }])),
    fields: Object.fromEntries(
      tables.map((t) => [
        t.id,
        [
          ...t.fields.map((f) => ({ id: f.id, type: f.type })),
          ...READ_ONLY_COLUMNS.map((id) => ({ id, type: 'datetime' as const })),
        ],
      ]),
    ),
    recordPage: route.endsWith('/:id'),
    recordPageIds: spec.pages.filter((p) => p.route.endsWith('/:id')).map((p) => p.id),
  };
}

/** The menu bar's context: every table, page and field, no sources, not a record page. */
export function menuPartContext(spec: AppSpec | AppSpecInput): PartContext {
  return contextOf(spec, [], '/');
}

const listOf = (names: readonly string[]): string => (names.length > 0 ? names.join(', ') : 'none yet');
const quote = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(', ');

/** The value at a dotted path of a props object, or undefined. */
function valueAt(props: Record<string, JsonValue>, dotted: string): unknown {
  let cursor: unknown = props;
  for (const key of dotted.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** The table a field binding belongs to: its `of` prop names a source (its table) or a table. */
function tableFor(def: PartDefinition, bind: Binding, props: Record<string, JsonValue>, ctx: PartContext): string | null {
  const ofBind = def.binds.find((b) => b.prop === bind.of);
  const ofValue = bind.of === undefined ? undefined : props[bind.of];
  if (!ofBind || typeof ofValue !== 'string') return null;
  if (ofBind.kind === 'source') return ctx.sources[ofValue]?.table ?? null;
  if (ofBind.kind === 'table') return ctx.tableIds.includes(ofValue) ? ofValue : null;
  return null;
}

interface Found {
  path: string;
  code: string;
  message: string;
}

/** Binding checks of one layer: sources, fields and pages named by its props exist and fit. */
function checkBindings(def: PartDefinition, props: Record<string, JsonValue>, ctx: PartContext, at: string): Found[] {
  const found: Found[] = [];
  for (const bind of def.binds) {
    const value = valueAt(props, bind.prop);
    if (value === undefined || value === null) continue;
    const here = `${at}.props.${bind.prop}`;
    if (bind.kind === 'source' && typeof value === 'string') {
      const source = ctx.sources[value];
      if (!source) {
        found.push({ path: here, code: 'unknown_source', message: `${def.name}: this page has no source "${value}". Use one of: ${listOf(ctx.sourceIds)}.` });
      } else if (bind.mode !== undefined && source.mode !== bind.mode) {
        const right = ctx.sourceIds.filter((id) => ctx.sources[id].mode === bind.mode);
        found.push({
          path: here,
          code: 'wrong_source_mode',
          message: `${def.name} needs a ${bind.mode} source, but "${value}" is a ${source.mode} source. Use one of: ${listOf(right)}.`,
        });
      }
    } else if (bind.kind === 'page' && typeof value === 'string') {
      if (!ctx.pageIds.includes(value)) {
        found.push({ path: here, code: 'unknown_page', message: `${def.name}: there is no page "${value}". Use one of: ${listOf(ctx.pageIds)}.` });
      }
    } else if (bind.kind === 'field' || bind.kind === 'fields') {
      const table = tableFor(def, bind, props, ctx);
      if (table === null) continue;
      const known = ctx.fields[table] ?? [];
      const names = Array.isArray(value) ? value : [value];
      names.forEach((name, i) => {
        if (typeof name !== 'string') return;
        const where = Array.isArray(value) ? `${here}.${i}` : here;
        const field = known.find((f) => f.id === name);
        const usable = known.filter((f) => (!bind.editable || !READ_ONLY_COLUMNS.includes(f.id)) && (!bind.fieldTypes || bind.fieldTypes.includes(f.type)));
        if (!field) {
          found.push({ path: where, code: 'unknown_field', message: `${def.name}: table "${table}" has no field "${name}". Use one of: ${listOf(usable.map((f) => f.id))}.` });
        } else if (bind.editable && READ_ONLY_COLUMNS.includes(name)) {
          found.push({ path: where, code: 'unknown_field', message: `${def.name}: "${name}" is filled in by the app and cannot be edited. Use one of: ${listOf(usable.map((f) => f.id))}.` });
        } else if (bind.fieldTypes && !bind.fieldTypes.includes(field.type)) {
          found.push({
            path: where,
            code: 'wrong_field_type',
            message: `${def.name}: "${name}" is a ${field.type} field, but this prop needs ${bind.fieldTypes.join(', ')}. Use one of: ${listOf(usable.map((f) => f.id))}.`,
          });
        }
      });
    }
  }
  return found;
}

/** The sentence for a part with too few or too many children. */
function childCountMessage(def: PartDefinition, count: number): string {
  const { min, max } = def.childCount ?? { min: 0, max: 0 };
  const only = def.allowedChildren?.length === 1 ? def.allowedChildren[0] : undefined;
  const kind = only === undefined ? 'parts' : only === 'Button' ? 'buttons' : `${only} parts`;
  return min === 0 ? `${def.name} holds at most ${max} ${kind}. It has ${count}.` : `${def.name} holds ${min} to ${max} ${kind}. It has ${count}.`;
}

/** Props rules that span more than one prop. */
function checkCrossProps(def: PartDefinition, props: Record<string, JsonValue>, ctx: PartContext, at: string): Found[] {
  const found: Found[] = [];
  const bad = (prop: string, message: string): void => {
    found.push({ path: `${at}.props.${prop}`, code: 'invalid_props', message });
  };
  if (def.name === 'RecordForm') {
    const { mode, source, table } = props;
    if (mode === 'edit' && source === undefined) {
      bad('source', `RecordForm in edit mode needs a record source. Set source to a record source of table "${String(table)}".`);
    }
    if (typeof source === 'string' && typeof table === 'string') {
      const sourceTable = ctx.sources[source]?.table;
      if (sourceTable !== undefined && sourceTable !== table) {
        bad('source', `RecordForm: source "${source}" reads table "${sourceTable}", not "${table}". Use a source of table "${table}".`);
      }
    }
  }
  if (def.name === 'StatCard') {
    const stat = props.stat ?? 'count';
    if (stat !== 'count' && props.field === undefined) {
      bad('field', `StatCard with stat "${String(stat)}" needs a field. Set field to an integer or real field.`);
    }
  }
  if (def.name === 'Chart') {
    const measure = props.measure ?? 'count';
    if (measure !== 'count' && props.field === undefined) {
      bad('field', `Chart with measure "${String(measure)}" needs a field. Set field to an integer or real field, or use measure "count".`);
    }
  }
  if (def.name === 'ProgressBar') {
    const stat = props.stat ?? 'count';
    const mode = typeof props.source === 'string' ? ctx.sources[props.source]?.mode : undefined;
    if (mode === 'record' && props.field === undefined) {
      bad('field', 'ProgressBar on a record source needs a field. Set field to an integer or real field of that record.');
    } else if (mode !== 'record' && stat === 'sum' && props.field === undefined) {
      bad('field', 'ProgressBar with stat "sum" needs a field. Set field to an integer or real field, or use stat "count".');
    }
  }
  if (def.name === 'NavLinks' && props.show === 'pages' && props.pages === undefined) {
    bad('pages', 'NavLinks with show "pages" needs pages. Set pages to 1 to 8 page ids, or use show "menu".');
  }
  if (def.name === 'Grid') {
    const free = props.placement === 'free';
    if (free && (props.columns ?? 2) !== 12) bad('columns', 'Grid: parts placed freely use 12 columns. Set columns to 12.');
    if (!free && props.columns === 12) bad('columns', 'Grid: 12 columns only work when parts are placed freely. Use 1 to 4 columns, or set placement to free.');
    if (!free && props.rows !== undefined) bad('rows', 'Grid: rows only work when parts are placed freely. Remove rows, or set placement to free.');
  }
  return found;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Actions that need a record: withRecord, open-form edit and delete-record. */
function checkActions(def: PartDefinition, props: Record<string, JsonValue>, ctx: PartContext, at: string): Found[] {
  const found: Found[] = [];
  for (const [prop, value] of Object.entries(props)) {
    if (!isRecord(value) || typeof value.action !== 'string') continue;
    const here = `${at}.props.${prop}`;
    const inRow = prop === 'rowAction';
    const afterSave = prop === 'afterSave';
    const rowTable = typeof props.source === 'string' ? ctx.sources[props.source]?.table : undefined;
    const bad = (message: string): void => {
      found.push({ path: here, code: 'action_needs_record', message });
    };
    if (value.action === 'navigate' && typeof value.pageId === 'string') {
      const withRecord = value.withRecord === true;
      if (ctx.recordPageIds !== undefined) {
        const target = ctx.recordPageIds.includes(value.pageId);
        if (withRecord && !target) {
          bad(`${def.name}: page "${value.pageId}" has no :id in its route, so withRecord must be false. Or go to a page whose route ends in /:id.`);
        } else if (!withRecord && target) {
          bad(`${def.name}: page "${value.pageId}" needs a record id. Set withRecord to true.`);
        }
      }
      if (withRecord && !inRow && !afterSave && !ctx.recordPage) {
        bad(`${def.name}: withRecord needs a record. Use it in a row action, after a form saves, or on a page whose route ends in /:id.`);
      }
    } else if ((value.action === 'open-form' && value.mode === 'edit') || value.action === 'delete-record') {
      const table = typeof value.table === 'string' ? value.table : undefined;
      if (table === undefined) continue;
      if (inRow) {
        if (rowTable !== undefined && rowTable !== table) {
          bad(`${def.name}: a row action acts on rows of "${rowTable}", not "${table}". Set table to "${rowTable}".`);
        }
      } else if (!ctx.recordPage || !Object.values(ctx.sources).some((s) => s.mode === 'record' && s.table === table)) {
        bad(`${def.name}: ${String(value.action)} needs a record of "${table}". Use it as a row action, or on a page whose route ends in /:id with a record source of "${table}".`);
      }
    }
  }
  return found;
}

/** The words of the two grid codes; the Design canvas shows these exact strings (they equal the copy rows of src/errors/copy.core.js). */
export const GRID_NOT_ALLOWED_MESSAGE =
  'This part has a place on a grid, but it is not inside a grid that places parts freely. Remove its place, or move it into a grid with Place parts freely turned on.';
export const GRID_OVERLAP_MESSAGE = 'Two parts cannot share the same cells. Move or resize one of them to empty cells.';

/**
 * Checks every layer of a tree against the catalog. Returns one issue per problem, at most `maxIssues`.
 * `base` is the dotted path of `root` in the document, for example "pages.1.layout". `place` "menu" checks a layer of a menu
 * slot: a part with `menuProps` is parsed against those and its bindings are skipped.
 */
export type LayerPlace = 'page' | 'menu';

export function checkLayer(root: LayoutLayer, ctx: PartContext, base: string, maxIssues = 20, place: LayerPlace = 'page'): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const add = (path: string, code: string, message: string): void => {
    if (issues.length < maxIssues) issues.push({ path, code, message });
  };
  const stack: Array<{ layer: LayoutLayer; path: string; parent: string | null; isRoot: boolean; parentFree: boolean }> = [
    { layer: root, path: base, parent: null, isRoot: true, parentFree: false },
  ];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { layer, path, parent, isRoot, parentFree } = item;
    const def = getPartDefinition(layer.type);
    if (layer.sizing !== undefined && UNSIZED_TYPES.has(layer.type)) {
      add(`${path}.sizing`, 'sizing_not_allowed', `${layer.type} takes the width of the part it is in, so it cannot have sizing. Remove sizing.`);
    }
    // A block is only for a child of a free Grid. A root is checked alone by the Design helpers, so only a Page or a menu layer is a real root.
    if (layer.grid !== undefined && !parentFree && (!isRoot || root.type === 'Page' || place === 'menu')) {
      add(`${path}.grid`, 'grid_not_allowed', GRID_NOT_ALLOWED_MESSAGE);
    }
    if (!def) {
      add(`${path}.type`, 'unknown_part', `"${layer.type}" is not a part. Use one of: ${listOf(PART_NAMES)}.`);
    } else {
      const menuOwn = place === 'menu' && def.menuProps !== undefined;
      const schema = menuOwn && def.menuProps ? def.menuProps(ctx) : (def.designProps ?? def.props)(ctx);
      const bindingIssues = menuOwn ? [] : [...checkBindings(def, layer.props, ctx, path)];
      const handled = new Set(bindingIssues.map((f) => f.path));
      const parsed = schema.safeParse(layer.props);
      if (!parsed.success) {
        const allowed = Object.keys(schema.shape);
        for (const issue of parsed.error.issues) {
          const at = [path, 'props', ...issue.path.map((p) => (typeof p === 'symbol' ? (p.description ?? '') : String(p)))].join('.');
          // The binding check words an unknown or mismatched id better than the enum error under the same path.
          if (handled.has(at)) continue;
          const message =
            issue.code === 'unrecognized_keys'
              ? `${def.name} has no prop ${quote(issue.keys)}. Use: ${allowed.length > 0 ? listOf(allowed) : 'no props'}.`
              : `${def.name}: ${issue.message}.`;
          add(at, 'invalid_props', message);
        }
      }
      for (const f of bindingIssues) add(f.path, f.code, f.message);
      for (const f of checkCrossProps(def, layer.props, ctx, path)) add(f.path, f.code, f.message);
      // An action that does not parse says nothing useful about records.
      if (parsed.success) for (const f of checkActions(def, layer.props, ctx, path)) add(f.path, f.code, f.message);
      if (parent !== null) {
        const parentDef = getPartDefinition(parent);
        if (def.childOf !== undefined && !def.childOf.includes(parent)) {
          add(
            `${path}.type`,
            'child_not_allowed',
            def.childOf.length === 0
              ? `${def.name} can only be the top part of a page.`
              : `${def.name} can only go inside: ${listOf(def.childOf)}.`,
          );
        } else if (parentDef?.allowedChildren !== undefined && !parentDef.allowedChildren.includes(def.name)) {
          add(`${path}.type`, 'child_not_allowed', `${parentDef.name} can only hold: ${listOf(parentDef.allowedChildren)}.`);
        }
      }
      if (def.children === 'none') {
        if (typeof layer.children === 'string' || layer.children.length > 0) {
          add(`${path}.children`, 'children_not_allowed', `${def.name} takes no children. Leave children empty.`);
        }
      } else if (def.children === 'text') {
        if (Array.isArray(layer.children) && layer.children.length > 0) {
          add(`${path}.children`, 'children_not_allowed', `${def.name} takes text, not other parts. Give its label as text.`);
        }
      } else if (typeof layer.children === 'string') {
        add(`${path}.children`, 'children_not_allowed', `${def.name} holds other parts, not text. Put the text in a Text part inside it.`);
      } else if (def.childCount !== undefined && (layer.children.length < def.childCount.min || layer.children.length > def.childCount.max)) {
        add(`${path}.children`, 'wrong_child_count', childCountMessage(def, layer.children.length));
      }
    }
    const free = isFreeGridLayer(layer);
    if (free && Array.isArray(layer.children)) {
      const accepted: GridPlace[] = [];
      layer.children.forEach((child, i) => {
        const at = readGrid(child.grid);
        if (at === null) return;
        if (collides(at, accepted)) add(`${path}.children.${i}.grid`, 'grid_overlap', GRID_OVERLAP_MESSAGE);
        else accepted.push(at);
      });
      const last = accepted.reduce((m, p) => Math.max(m, rowEnd(p)), 0);
      if (last > readGridProps(layer.props).rows) {
        add(`${path}.props.rows`, 'invalid_props', `Grid: rows must be at least ${last}, the last row its parts reach. Set rows to ${last}.`);
      }
    }
    if (Array.isArray(layer.children)) {
      // Pushed last to first so issues come out in document order.
      for (let i = layer.children.length - 1; i >= 0; i -= 1) {
        stack.push({ layer: layer.children[i], path: `${path}.children.${i}`, parent: def ? def.name : null, isRoot: false, parentFree: free });
      }
    }
  }
  return issues;
}

/** The hook for validateAppSpec(input, { checkLayout }). */
export function checkLayout(ctx: LayoutCheckContext): SpecIssue[] {
  return checkLayer(ctx.page.layout, partContextFor(ctx.spec, ctx.page), ctx.path);
}

/** The hook for validateAppSpec(input, { checkMenu }): every top layer of both slots, at "menu.start.0". */
export function checkMenu(ctx: MenuCheckContext): SpecIssue[] {
  const partCtx = menuPartContext(ctx.spec);
  const issues: SpecIssue[] = [];
  for (const slot of MENU_SLOTS) {
    slotLayers(ctx.spec.menu, slot).forEach((layer, i) => {
      issues.push(...checkLayer(layer as LayoutLayer, partCtx, `menu.${slot}.${i}`, 20, 'menu'));
    });
  }
  return issues;
}

/** Both hooks, for `validateAppSpec(x, { ...CATALOG_CHECKS })`. Every production caller passes this. */
export const CATALOG_CHECKS = Object.freeze({ checkLayout, checkMenu });
