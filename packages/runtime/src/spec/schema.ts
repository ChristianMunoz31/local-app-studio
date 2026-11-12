// AppSpec v1: the single schema that defines an app built with Local App Studio. Used by the Studio UI,
// the runtime, the Studio server and the model prompts. Docs: docs/APP_SPEC.md.
//
// The Studio server imports this file directly (Node 24 type stripping, docs/ARCHITECTURE_DECISIONS.md
// ADR-006), so it must stay erasable TypeScript: no enum, namespace, parameter properties or JSX, no "@/"
// alias, type-only imports written as `import type`, relative imports with a ".ts" extension. Imports are
// zod and the pure spec files beside it. Do not edit without the parent's approval: both phase branches depend on it.
import * as z from 'zod';
import { GRID_LIMITS } from './gridPlacement.ts';
import type { GridPlace } from './gridPlacement.ts';
import { MENU_LIMITS, MENU_SLOTS, hasSlotLayers, menuTypeProblem, slotLayers } from './menuSlots.ts';
import { duplicateActions, ruleProblems } from './rules.ts';
import type { Rule } from './rules.ts';
import { LAYER_WIDTHS } from './sizing.ts';
import type { LayerSizing } from './sizing.ts';
import { ACCENT_HUE_MAX, THEME_IDS, THEME_MODES } from '../theme/ids.ts';

export type { LayerSizing, LayerWidth } from './sizing.ts';
export type { GridPlace, GridCell } from './gridPlacement.ts';
export type { RuleTo, RuleAction, Rule } from './rules.ts';

export const SPEC_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Patterns and limits
// ---------------------------------------------------------------------------------------------

/** Table, field, page and source ids. */
export const ID_RE = /^[a-z][a-z0-9_]{0,30}$/;
export const SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Reverse DNS, same rules as scripts/init-app.mjs validateIdentifier (".dev" and ".app" endings checked separately). */
export const IDENTIFIER_RE = /^[a-z]([a-z0-9-]*[a-z0-9])?(\.[a-z]([a-z0-9-]*[a-z0-9])?)+$/;
export const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
/** Same rules as scripts/init-app.mjs validateName: letters, digits, single spaces, starts with a letter. */
export const APP_NAME_RE = /^[A-Za-z][A-Za-z0-9]*( [A-Za-z0-9]+)*$/;
/** "/" or "/crews" or "/crews/open" with an optional final "/:id". */
export const ROUTE_RE = /^\/([a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*(\/:id)?)?$/;
/**
 * Single-line text with no leading or trailing space, no control character (C0 or C1; a NUL would cut an SQL literal
 * short) and no bidi override or isolate (U+202A to U+202E, U+2066 to U+2069), which could reorder text on screen.
 */
export const LABEL_RE = /^[^\s\p{Cc}\u202a-\u202e\u2066-\u2069](?:[^\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]*[^\s\p{Cc}\u202a-\u202e\u2066-\u2069])?$/u;
/** Text with no NUL: SQLite cannot hold one inside an SQL literal, and a default is written into the create script. */
const NO_NUL_RE = /^[^\u0000]*$/;
export const LAYER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const LAYER_TYPE_RE = /^[A-Z][A-Za-z0-9]{0,39}$/;

export const LIMITS = Object.freeze({
  specChars: 512 * 1024,
  tables: 30,
  fieldsPerTable: 60,
  options: 50,
  optionChars: 60,
  labelChars: 60,
  descriptionChars: 300,
  textFieldChars: 500,
  longtextFieldChars: 20000,
  pages: 30,
  routeChars: 60,
  sourcesPerPage: 8,
  whereConditions: 8,
  inValues: 50,
  orderBy: 3,
  sourceLimitMin: 1,
  sourceLimitMax: 200,
  sourceLimitDefault: 50,
  nav: 20,
  layersPerPage: 300,
  layerDepth: 16,
  layerTextChars: 2000,
  issues: 20,
  autoPrefixChars: 20,
  autoWidthMax: 12,
  autoStartMax: 999_999_999_999,
  rulesPerTable: 20,
  ruleActions: 5,
} as const);

export const FIELD_TYPES = ['text', 'longtext', 'integer', 'real', 'boolean', 'date', 'datetime', 'select', 'reference'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Exactly the comparison operators of server/db/query.js `op` (op.and is implied by several conditions on one field). */
export const WHERE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type WhereOp = (typeof WHERE_OPS)[number];
const ORDERING_OPS: ReadonlySet<string> = new Set(['gt', 'gte', 'lt', 'lte']);

/** lucide-react glyphs the runtime maps by name (src/runtime owns the map). */
export const ICONS = [
  'home', 'list', 'table', 'users', 'user', 'box', 'calendar', 'chart', 'clipboard', 'file',
  'folder', 'tag', 'star', 'briefcase', 'truck', 'wrench', 'settings', 'inbox', 'map', 'heart',
] as const;
/** The kit background presets (src/constants/settingsDefaults.js BACKGROUND_PRESETS). */
export const THEME_PRESETS = ['aurora', 'ocean', 'sunset', 'forest', 'graphite', 'solid'] as const;
export const RADII = ['none', 'sm', 'md', 'lg'] as const;

// ---------------------------------------------------------------------------------------------
// Reserved words
// ---------------------------------------------------------------------------------------------

/** The SQLite keyword list (sqlite.org/lang_keywords.html), plus true, false and strict. */
export const SQL_KEYWORDS: ReadonlySet<string> = new Set(
  ('abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade ' +
    'case cast check collate column commit conflict constraint create cross current current_date current_time ' +
    'current_timestamp database default deferrable deferred delete desc detach distinct do drop each else end escape ' +
    'except exclude exclusive exists explain fail filter first following for foreign from full generated glob group ' +
    'groups having if ignore immediate in index indexed initially inner insert instead intersect into is isnull join ' +
    'key last left like limit match materialized natural no not nothing notnull null nulls of offset on or order ' +
    'others outer over partition plan pragma preceding primary query raise range recursive references regexp reindex ' +
    'release rename replace restrict returning right rollback row rows savepoint select set table temp temporary then ' +
    'ties to transaction trigger unbounded union unique update using vacuum values view virtual when where window with ' +
    'without true false strict').split(' '),
);
/** Kit, Studio and migration bookkeeping tables (server/db/tables.js plus schema tables and Studio's apps, builds). */
export const KIT_TABLE_IDS: ReadonlySet<string> = new Set([
  'items', 'app_state', 'assistant_conversations', 'assistant_messages', 'app_secrets', 'audit_log',
  'schema_version', 'app_schema_version', 'apps', 'builds',
]);
export const RESERVED_TABLE_PREFIXES: readonly string[] = ['sqlite_', 'app_', 'assistant_', 'studio_'];
/** Table ids double as cloud category ids (server/ai/privacy.js), so the kit categories and sentinels are taken. */
export const RESERVED_CATEGORY_IDS: ReadonlySet<string> = new Set(['items', 'notes', 'memory', 'mixed']);
/** Table ids become export file names (crews.csv) and app slugs become folder names; these are not valid file names on Windows. */
export const WINDOWS_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con', 'prn', 'aux', 'nul', 'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
/**
 * True when an app name cannot be used on Windows. The name becomes the program (Con.exe, spaces removed), the install folder
 * and the data folder of the built app, and the slug becomes the build, output and log names, so con, aux, nul, prn, com0 to
 * com9 and lpt0 to lpt9 are refused in any letter case, with or without spaces ("Com 1").
 */
export const isWindowsDeviceName = (name: string): boolean => WINDOWS_DEVICE_NAMES.has(name.replaceAll(' ', '').toLowerCase());
/** Added to every table by the runtime. rowid and oid are SQLite's implicit row ids (query.js orders by rowid). */
export const RUNTIME_COLUMNS = ['id', 'created_at', 'updated_at'] as const;
export const RESERVED_COLUMN_IDS: ReadonlySet<string> = new Set([...RUNTIME_COLUMNS, 'rowid', 'oid']);
/** First route segments owned by the shell, the data browser, Studio and the server. */
export const RESERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  'api', 'assets', 'data', 'desktop', 'designer', 'items', 'preview', 'settings', 'studio',
]);
/** Local App Studio's own names, and "Dev" and "App": their identifier (com.example.dev, .app) is reserved for the Dev channel. */
export const RESERVED_APP_NAMES: ReadonlySet<string> = new Set(['local app studio', 'local app studio dev', 'dev', 'app']);
export const RESERVED_IDENTIFIER_PREFIX = 'com.neuralfoundry.localappstudio';

export const isReservedTableId = (id: string): boolean =>
  SQL_KEYWORDS.has(id) || KIT_TABLE_IDS.has(id) || RESERVED_CATEGORY_IDS.has(id) || WINDOWS_DEVICE_NAMES.has(id) ||
  RESERVED_TABLE_PREFIXES.some((p) => id.startsWith(p));
export const isReservedFieldId = (id: string): boolean => SQL_KEYWORDS.has(id) || RESERVED_COLUMN_IDS.has(id);

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

export const IdSchema = z.string().regex(ID_RE).describe('id: a-z, 0-9 and _, starts with a letter, max 31');
export const LabelSchema = z.string().min(1).max(LIMITS.labelChars).regex(LABEL_RE).describe('Short display text');
const OptionSchema = z.string().min(1).max(LIMITS.optionChars).regex(LABEL_RE);
const IsoDateSchema = z.iso.date();
const IsoDateTimeSchema = z.iso.datetime();

const fieldBase = {
  id: IdSchema,
  label: LabelSchema,
  required: z.boolean().default(false).describe('A value must be given'),
};

// The nine field shapes as they were before automations. The helper's tables step keeps using them (TablesBlockSchema), so its
// schema bytes do not move; FieldSchema below adds the optional `autoNumber` to the text and integer shapes only.
const ModelTextFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('text'), default: z.string().max(LIMITS.textFieldChars).regex(NO_NUL_RE, 'A default cannot hold a NUL character.').optional() });
const ModelLongtextFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('longtext'), default: z.string().max(LIMITS.longtextFieldChars).regex(NO_NUL_RE, 'A default cannot hold a NUL character.').optional() });
const ModelIntegerFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('integer'), default: z.int().optional() });
const ModelRealFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('real'), default: z.number().optional() });
const ModelBooleanFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('boolean'), default: z.boolean().optional() });
const ModelDateFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('date'), default: IsoDateSchema.optional() });
const ModelDatetimeFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('datetime'), default: IsoDateTimeSchema.optional() });
const ModelSelectFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('select'),
  options: z.array(OptionSchema).min(1).max(LIMITS.options).describe('Allowed values, unique'),
  default: OptionSchema.optional(),
});
const ModelReferenceFieldSchema = z.strictObject({ ...fieldBase, type: z.literal('reference'), table: IdSchema.describe('id of another table') });

const ModelFieldSchema = z.discriminatedUnion('type', [
  ModelTextFieldSchema,
  ModelLongtextFieldSchema,
  ModelIntegerFieldSchema,
  ModelRealFieldSchema,
  ModelBooleanFieldSchema,
  ModelDateFieldSchema,
  ModelDatetimeFieldSchema,
  ModelSelectFieldSchema,
  ModelReferenceFieldSchema,
]);

/** On a text field. No zod defaults: absent keys are filled by readAutoNumber (prefix '', start 1, width 1). */
const AutoNumberTextSchema = z.strictObject({
  prefix: z.string().max(LIMITS.autoPrefixChars).regex(LABEL_RE).optional(),
  start: z.int().min(0).max(LIMITS.autoStartMax).optional(),
  width: z.int().min(1).max(LIMITS.autoWidthMax).optional(),
});
/** On an integer field: the counter only. */
const AutoNumberIntegerSchema = z.strictObject({ start: z.int().min(0).max(LIMITS.autoStartMax).optional() });

export const FieldSchema = z.discriminatedUnion('type', [
  ModelTextFieldSchema.extend({ autoNumber: AutoNumberTextSchema.optional() }),
  ModelLongtextFieldSchema,
  ModelIntegerFieldSchema.extend({ autoNumber: AutoNumberIntegerSchema.optional() }),
  ModelRealFieldSchema,
  ModelBooleanFieldSchema,
  ModelDateFieldSchema,
  ModelDatetimeFieldSchema,
  ModelSelectFieldSchema,
  ModelReferenceFieldSchema,
]);

const ModelTableSchema = z.strictObject({
  id: IdSchema,
  label: LabelSchema,
  titleField: IdSchema.optional().describe('Text or select field shown as the record title'),
  fields: z.array(ModelFieldSchema).min(1).max(LIMITS.fieldsPerTable),
});

const RuleToSchema = z.union([
  z.enum(['today', 'now', 'clear']),
  z.strictObject({ value: z.union([z.string().max(LIMITS.longtextFieldChars).regex(NO_NUL_RE), z.number(), z.boolean()]) }),
  z.strictObject({ field: IdSchema }),
]);

/** When a select field becomes an option or a tick box is ticked or unticked, set other fields of the record (docs/APP_SPEC.md, "Rules"). */
export const RuleSchema = z.strictObject({
  when: z.strictObject({ field: IdSchema, is: z.union([OptionSchema, z.boolean()]) }),
  then: z.array(z.strictObject({ set: IdSchema, to: RuleToSchema })).min(1).max(LIMITS.ruleActions),
});

export const TableSchema = ModelTableSchema.extend({
  fields: z.array(FieldSchema).min(1).max(LIMITS.fieldsPerTable),
  rules: z.array(RuleSchema).max(LIMITS.rulesPerTable).optional(),
});

const ScalarValueSchema = z.union([z.string().max(LIMITS.textFieldChars), z.number(), z.boolean()]);

export const WhereConditionSchema = z.strictObject({
  field: IdSchema,
  op: z.enum(WHERE_OPS),
  value: z.union([ScalarValueSchema, z.null(), z.array(ScalarValueSchema).max(LIMITS.inValues)]).describe('A list only for op "in"'),
});

export const OrderBySchema = z.strictObject({
  field: IdSchema,
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export const SourceSchema = z.strictObject({
  id: IdSchema,
  table: IdSchema,
  mode: z.enum(['list', 'record']).default('list').describe('record: the row whose id is the :id in the page route'),
  where: z.array(WhereConditionSchema).max(LIMITS.whereConditions).default([]),
  orderBy: z.array(OrderBySchema).max(LIMITS.orderBy).default([]),
  limit: z.int().min(LIMITS.sourceLimitMin).max(LIMITS.sourceLimitMax).default(LIMITS.sourceLimitDefault),
});

const JsonValueSchema = z.json();
export type JsonValue = z.output<typeof JsonValueSchema>;

/**
 * Where an expanded block came from (docs/FEATURES.md). Inert data: the runtime renders type, props and children only.
 * Only code sets it (the feature expander); Describe never emits it.
 */
export const FeatureMarkerSchema = z.strictObject({
  id: IdSchema,
  version: z.int().min(1).max(1_000_000),
  params: z
    .record(z.string().regex(ID_RE), z.string().max(LIMITS.layerTextChars))
    .refine((p) => Object.keys(p).length <= 6, 'At most 6 params.'),
});
export type FeatureMarker = z.output<typeof FeatureMarkerSchema>;

/** Where a layer sits in its parent's row. Absent: the whole row (docs/APP_SPEC.md "Layer sizing"). */
export const LayerSizingSchema = z.strictObject({
  width: z.enum(LAYER_WIDTHS).default('full'),
  grow: z.boolean().default(false),
});

/** Where a layer sits on a free Grid (docs/APP_SPEC.md "Free placement on a grid"). Only on a child of a Grid with placement free. */
export const LayerGridSchema = z
  .strictObject({
    col: z.int().min(1).max(GRID_LIMITS.columns),
    span: z.int().min(1).max(GRID_LIMITS.maxSpan),
    row: z.int().min(1).max(GRID_LIMITS.maxRow),
    rowSpan: z.int().min(1).max(GRID_LIMITS.maxRowSpan),
  })
  .refine((g) => g.col + g.span <= GRID_LIMITS.columns + 1, {
    message: 'A part on the grid must end by column 12. Make it narrower or move it left.',
    path: ['span'],
  })
  .refine((g) => g.row + g.rowSpan <= GRID_LIMITS.maxRow + 1, {
    message: 'A part on the grid must end by row 60. Make it shorter or move it up.',
    path: ['rowSpan'],
  });

/** ui-builder ComponentLayer, restricted for v1: no variable references, children are layers or text. */
export interface LayoutLayer {
  id: string;
  type: string;
  name?: string;
  feature?: FeatureMarker;
  sizing?: LayerSizing;
  grid?: GridPlace;
  props: Record<string, JsonValue>;
  children: LayoutLayer[] | string;
}

export const LayoutLayerSchema: z.ZodType<LayoutLayer> = z.lazy(() =>
  z.strictObject({
    id: z.string().regex(LAYER_ID_RE),
    type: z.string().regex(LAYER_TYPE_RE).describe('A catalog part name'),
    name: z.string().max(LIMITS.labelChars).optional(),
    feature: FeatureMarkerSchema.optional(),
    sizing: LayerSizingSchema.optional(),
    grid: LayerGridSchema.optional(),
    props: z.record(z.string(), JsonValueSchema),
    children: z.union([z.array(LayoutLayerSchema), z.string().max(LIMITS.layerTextChars)]),
  }),
);

export const PageSchema = z.strictObject({
  id: IdSchema,
  title: LabelSchema,
  route: z.string().max(LIMITS.routeChars).regex(ROUTE_RE).describe('"/" or "/a-z-path", may end with "/:id"'),
  sources: z.array(SourceSchema).max(LIMITS.sourcesPerPage).default([]),
  layout: LayoutLayerSchema,
});

export const NavItemSchema = z.strictObject({
  pageId: IdSchema,
  label: LabelSchema,
  icon: z.enum(ICONS).optional(),
});

export const ThemeOverridesSchema = z.strictObject({
  accentHue: z.int().min(0).max(ACCENT_HUE_MAX).optional(),
  radius: z.enum(RADII).optional(),
  mode: z.enum(THEME_MODES).optional(),
});

/**
 * `id` picks a built-in theme (src/theme). Without it the block is the legacy look: `preset` and `radius` only (the kit
 * "Classic" look). With it, `preset` and `radius` are kept in step with the theme for older readers. Docs: docs/THEMES.md.
 */
export const ThemeSchema = z
  .strictObject({
    preset: z.enum(THEME_PRESETS).default('aurora'),
    radius: z.enum(RADII).default('md'),
    id: z.enum(THEME_IDS).optional(),
    overrides: ThemeOverridesSchema.optional(),
  })
  .refine((t) => t.overrides === undefined || t.id !== undefined, {
    message: 'Pick a theme before changing its accent, corners or light and dark.',
    path: ['overrides'],
  });

export const MENU_POSITIONS = ['top', 'side'] as const;
export const MENU_STYLES = ['labels', 'icons-and-labels'] as const;

const MenuSlotSchema = z.array(LayoutLayerSchema).max(MENU_LIMITS.perSlot);

/**
 * The app menu bar, built from `nav`, plus optional `start` and `end` slots of small parts (docs/APP_SPEC.md, "Menu slots").
 * Absent means the classic look (the kit burger drawer only). The allow list is enforced by validateAppSpec (checkMenuLayers).
 */
export const MenuSchema = z.strictObject({
  position: z.enum(MENU_POSITIONS).default('top'),
  style: z.enum(MENU_STYLES).default('icons-and-labels'),
  start: MenuSlotSchema.optional(),
  end: MenuSlotSchema.optional(),
});

export const AppBlockSchema = z.strictObject({
  name: z.string().min(2).max(40).regex(APP_NAME_RE).describe('Display name: letters, digits, spaces'),
  slug: z.string().min(2).max(40).regex(SLUG_RE),
  identifier: z.string().max(120).regex(IDENTIFIER_RE).describe('Reverse DNS, like com.example.crewroster'),
  version: z.string().max(20).regex(SEMVER_RE).describe('MAJOR.MINOR.PATCH'),
  description: z.string().max(LIMITS.descriptionChars).default(''),
  icon: z.enum(ICONS).nullable().default(null),
});

export const AppSpecSchema = z.strictObject({
  specVersion: z.literal(SPEC_VERSION),
  app: AppBlockSchema,
  tables: z.array(TableSchema).max(LIMITS.tables).default([]),
  pages: z.array(PageSchema).min(1).max(LIMITS.pages),
  nav: z.array(NavItemSchema).max(LIMITS.nav).default([]),
  theme: ThemeSchema.default({ preset: 'aurora', radius: 'md' }),
  menu: MenuSchema.optional(),
});

/** The plan step of the generation pipeline asks the model for this block only. */
export const TablesBlockSchema = z.strictObject({
  tables: z.array(ModelTableSchema).min(1).max(LIMITS.tables),
});

export type AppSpec = z.output<typeof AppSpecSchema>;
export type AppSpecInput = z.input<typeof AppSpecSchema>;
export type AppBlock = z.output<typeof AppBlockSchema>;
export type Table = z.output<typeof TableSchema>;
export type Field = z.output<typeof FieldSchema>;
export type Source = z.output<typeof SourceSchema>;
export type WhereCondition = z.output<typeof WhereConditionSchema>;
export type OrderBy = z.output<typeof OrderBySchema>;
export type Page = z.output<typeof PageSchema>;
export type NavItem = z.output<typeof NavItemSchema>;
export type Theme = z.output<typeof ThemeSchema>;
export type Menu = z.output<typeof MenuSchema>;
export type ThemeOverrides = z.output<typeof ThemeOverridesSchema>;

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** One problem, phrased for a person and for a small model in the repair loop. `path` is dotted ("tables.0.fields.2"). */
export interface SpecIssue {
  path: string;
  code: string;
  message: string;
}

export type SpecValidation<T> = { ok: true; value: T; issues: SpecIssue[] } | { ok: false; value: null; issues: SpecIssue[] };

export interface LayoutCheckContext {
  spec: AppSpec;
  page: Page;
  /** Dotted path of the page's layout, for example "pages.1.layout". */
  path: string;
}

export interface MenuCheckContext {
  spec: AppSpec;
}

export interface ValidateOptions {
  /** Stop collecting after this many issues (default LIMITS.issues). */
  maxIssues?: number;
  /** Catalog checks (part types, props, childOf, bindings); supplied by src/catalog/validateLayout.ts. */
  checkLayout?: (ctx: LayoutCheckContext) => SpecIssue[];
  /** Catalog checks of the menu slots (props, bindings, actions); supplied by src/catalog/validateLayout.ts. Runs only when a slot holds a layer. */
  checkMenu?: (ctx: MenuCheckContext) => SpecIssue[];
}

type Add = (path: string, code: string, message: string) => void;

export const joinPath = (parts: ReadonlyArray<PropertyKey>): string =>
  parts.map((p) => (typeof p === 'symbol' ? (p.description ?? '') : String(p))).join('.');

function collector(max: number): { issues: SpecIssue[]; add: Add } {
  const issues: SpecIssue[] = [];
  const add: Add = (path, code, message) => {
    if (issues.length < max) issues.push({ path: path === '' ? '(root)' : path, code, message });
  };
  return { issues, add };
}

function sizeProblem(input: unknown): string | null {
  try {
    const text = JSON.stringify(input);
    if (typeof text !== 'string') return 'The spec must be a JSON object.';
    return text.length > LIMITS.specChars ? `An app design may be at most ${LIMITS.specChars / 1024} KB.` : null;
  } catch {
    return 'The spec must be plain JSON.';
  }
}

const ARRAY_CAPS: Readonly<Record<string, string>> = {
  tables: `An app may have at most ${LIMITS.tables} tables.`,
  fields: `A table may have at most ${LIMITS.fieldsPerTable} fields.`,
  pages: `An app may have at most ${LIMITS.pages} pages.`,
  sources: `A page may have at most ${LIMITS.sourcesPerPage} sources.`,
  nav: `The menu may have at most ${LIMITS.nav} items.`,
  rules: `A table may have at most ${LIMITS.rulesPerTable} automations.`,
  then: `An automation may set at most ${LIMITS.ruleActions} fields.`,
};

const AUTOMATION_WORDS = {
  auto_number_not_allowed: 'Only one field of a table can be numbered automatically, and it cannot have a default.',
  rule_field_missing: 'This automation names a field this table does not have.',
  rule_not_allowed: 'This automation cannot run as it is written.',
} as const;

function addZodIssues(error: z.ZodError, add: Add): void {
  for (const issue of error.issues) {
    // A bad field reports at fields.N (union) or fields.N.type (discriminator), so look back two or three steps.
    const p = issue.path;
    const isField = p[p.length - 2] === 'fields' || (p[p.length - 1] === 'type' && p[p.length - 3] === 'fields');
    const cap = issue.code === 'too_big' ? ARRAY_CAPS[String(p[p.length - 1])] : undefined;
    const message =
      cap ??
      (issue.code === 'invalid_union' && isField
        ? `Each field needs a known type: ${FIELD_TYPES.join(', ')}, with only that type's keys.`
        : issue.message);
    add(joinPath(issue.path), issue.code, message);
  }
}

interface ColumnInfo {
  kind: FieldType | 'uuid' | 'timestamp';
  options: readonly string[];
}

function columnsOf(table: Table): Map<string, ColumnInfo> {
  const map = new Map<string, ColumnInfo>([
    ['id', { kind: 'uuid', options: [] }],
    ['created_at', { kind: 'timestamp', options: [] }],
    ['updated_at', { kind: 'timestamp', options: [] }],
  ]);
  for (const f of table.fields) {
    if (!map.has(f.id)) map.set(f.id, { kind: f.type, options: f.type === 'select' ? f.options : [] });
  }
  return map;
}

function valueProblem(col: ColumnInfo, v: string | number | boolean): string | null {
  switch (col.kind) {
    case 'integer':
      return typeof v === 'number' && Number.isSafeInteger(v) ? null : 'must be a whole number';
    case 'real':
      return typeof v === 'number' ? null : 'must be a number';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'must be true or false';
    case 'date':
      return IsoDateSchema.safeParse(v).success ? null : 'must be a date like 2026-01-31';
    case 'datetime':
    case 'timestamp':
      return IsoDateTimeSchema.safeParse(v).success ? null : 'must be a date and time like 2026-01-31T09:00:00Z';
    case 'select':
      return typeof v === 'string' && col.options.includes(v) ? null : `must be one of: ${col.options.join(', ')}`;
    default:
      return typeof v === 'string' ? null : 'must be text';
  }
}

function checkApp(spec: AppSpec, add: Add): void {
  if (RESERVED_APP_NAMES.has(spec.app.name.toLowerCase())) {
    add('app.name', 'reserved_name', 'That name belongs to Local App Studio itself. Pick another name.');
  }
  if (isWindowsDeviceName(spec.app.name)) {
    add('app.name', 'reserved_name', 'That name is reserved on Windows, so the app could not be installed. Pick another name.');
  }
  if (WINDOWS_DEVICE_NAMES.has(spec.app.slug)) {
    add('app.slug', 'reserved_name', 'That short name is reserved on Windows. Pick another name.');
  }
  const last = spec.app.identifier.split('.').pop() ?? '';
  if (last === 'dev' || last === 'app' || spec.app.identifier.startsWith(RESERVED_IDENTIFIER_PREFIX)) {
    add('app.identifier', 'reserved_identifier', 'The identifier must not end in .dev or .app and must not be Local App Studio\'s own.');
  }
}

/** Table-level checks shared by validateAppSpec and validateTables. */
function checkTables(tables: readonly Table[], add: Add): void {
  const tableIds = new Set<string>();
  tables.forEach((t, i) => {
    const at = `tables.${i}`;
    if (tableIds.has(t.id)) add(`${at}.id`, 'duplicate_id', `Table id "${t.id}" is used twice.`);
    tableIds.add(t.id);
    if (isReservedTableId(t.id)) add(`${at}.id`, 'reserved_word', `"${t.id}" is reserved. Use another table id, like "${t.id}_list".`);
  });
  tables.forEach((t, i) => {
    const at = `tables.${i}`;
    const fieldIds = new Set<string>();
    t.fields.forEach((f, j) => {
      const fat = `${at}.fields.${j}`;
      if (fieldIds.has(f.id)) add(`${fat}.id`, 'duplicate_id', `Field id "${f.id}" is used twice in table "${t.id}".`);
      fieldIds.add(f.id);
      if (isReservedFieldId(f.id)) add(`${fat}.id`, 'reserved_word', `"${f.id}" is reserved. Use another field id, like "${t.id}_${f.id}".`);
      if (f.type === 'select') {
        if (new Set(f.options).size !== f.options.length) add(`${fat}.options`, 'duplicate_option', 'Each option must be different.');
        if (f.default !== undefined && !f.options.includes(f.default)) {
          add(`${fat}.default`, 'invalid_default', `The default must be one of: ${f.options.join(', ')}.`);
        }
      }
      if (f.type === 'reference' && !tableIds.has(f.table)) {
        add(`${fat}.table`, 'unknown_table', `There is no table "${f.table}". Use one of: ${[...tableIds].join(', ')}.`);
      }
    });
    if (t.titleField !== undefined) {
      const title = t.fields.find((f) => f.id === t.titleField);
      if (!title || (title.type !== 'text' && title.type !== 'longtext' && title.type !== 'select')) {
        add(`${at}.titleField`, 'unknown_field', 'titleField must name a text or select field of this table.');
      }
    }
    let numbered: string | null = null;
    t.fields.forEach((f, j) => {
      if ((f.type !== 'text' && f.type !== 'integer') || f.autoNumber === undefined) return;
      if (numbered !== null || f.default !== undefined) add(`${at}.fields.${j}.autoNumber`, 'auto_number_not_allowed', AUTOMATION_WORDS.auto_number_not_allowed);
      else numbered = f.id;
    });
    const rules = t.rules ?? [];
    rules.forEach((rule, r) => {
      for (const p of ruleProblems(t, rule, numbered)) add(`${at}.rules.${r}.${p.at}`, p.code, AUTOMATION_WORDS[p.code]);
    });
    for (const d of duplicateActions(rules as Rule[])) add(`${at}.rules.${d.rule}.${d.at}`, 'rule_not_allowed', AUTOMATION_WORDS.rule_not_allowed);
  });
  // References must form a tree (no table points back to itself, directly or through others), so
  // IMPORT_ORDER can list parents before children.
  const refs = new Map<string, string[]>(tables.map((t) => [t.id, t.fields.flatMap((f) => (f.type === 'reference' ? [f.table] : []))]));
  const state = new Map<string, 1 | 2>();
  const loops = (id: string): boolean => {
    const s = state.get(id);
    if (s === 2) return false;
    if (s === 1) return true;
    state.set(id, 1);
    const found = (refs.get(id) ?? []).some((next) => refs.has(next) && loops(next));
    state.set(id, 2);
    return found;
  };
  tables.forEach((t, i) => {
    if (!state.has(t.id) && loops(t.id)) {
      add(`tables.${i}`, 'reference_cycle', `Table "${t.id}" is part of a reference loop. A table cannot point back to itself, directly or through other tables.`);
    }
  });
}

function checkSource(src: Source, page: Page, at: string, tables: ReadonlyMap<string, Table>, add: Add): void {
  const table = tables.get(src.table);
  if (!table) {
    add(`${at}.table`, 'unknown_table', `There is no table "${src.table}". Use one of: ${[...tables.keys()].join(', ')}.`);
    return;
  }
  const cols = columnsOf(table);
  const known = [...cols.keys()].join(', ');
  if (src.mode === 'record') {
    if (!page.route.endsWith('/:id')) add(`${at}.mode`, 'route_param', 'A record source needs a page route ending in "/:id".');
    if (src.where.length > 0 || src.orderBy.length > 0) add(`${at}.mode`, 'record_source', 'A record source takes no where or orderBy.');
  }
  const seen = new Set<string>();
  src.where.forEach((c, k) => {
    const cat = `${at}.where.${k}`;
    const col = cols.get(c.field);
    if (!col) {
      add(`${cat}.field`, 'unknown_field', `Table "${table.id}" has no field "${c.field}". Use one of: ${known}.`);
      return;
    }
    const key = `${c.field}:${c.op}`;
    if (seen.has(key)) add(cat, 'duplicate_condition', `"${c.field}" already has a "${c.op}" condition.`);
    seen.add(key);
    if (ORDERING_OPS.has(c.op) && (col.kind === 'boolean' || col.kind === 'select' || col.kind === 'reference' || col.kind === 'uuid')) {
      add(`${cat}.op`, 'op_not_allowed', `"${c.op}" does not work on ${col.kind} fields. Use eq, ne or in.`);
    }
    const v = c.value;
    if (c.op === 'in') {
      if (!Array.isArray(v)) add(`${cat}.value`, 'invalid_value', 'op "in" needs a list of values.');
      else v.forEach((item, n) => {
        const p = valueProblem(col, item);
        if (p) add(`${cat}.value.${n}`, 'invalid_value', `"${c.field}" ${p}.`);
      });
      return;
    }
    if (Array.isArray(v)) add(`${cat}.value`, 'invalid_value', `op "${c.op}" needs one value, not a list.`);
    else if (v === null) {
      if (c.op !== 'eq' && c.op !== 'ne') add(`${cat}.value`, 'invalid_value', 'null works only with eq or ne.');
    } else {
      const p = valueProblem(col, v);
      if (p) add(`${cat}.value`, 'invalid_value', `"${c.field}" ${p}.`);
    }
  });
  src.orderBy.forEach((o, k) => {
    if (!cols.has(o.field)) add(`${at}.orderBy.${k}.field`, 'unknown_field', `Table "${table.id}" has no field "${o.field}". Use one of: ${known}.`);
  });
}

const FORBIDDEN_PROPS: ReadonlySet<string> = new Set(['className', 'style', 'children', 'dangerouslySetInnerHTML', 'key', 'ref']);
const isForbiddenProp = (key: string): boolean => FORBIDDEN_PROPS.has(key) || /^on[A-Z]/.test(key);
const isVariableRef = (v: JsonValue): boolean => v !== null && typeof v === 'object' && !Array.isArray(v) && '__variableRef' in v;

function checkLayout(root: LayoutLayer, base: string, add: Add): void {
  if (root.type !== 'Page') add(`${base}.type`, 'layout_root', 'The page layout must start with a Page part.');
  const ids = new Set<string>();
  const stack: Array<{ layer: LayoutLayer; path: string; depth: number }> = [{ layer: root, path: base, depth: 1 }];
  let count = 0;
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { layer, path, depth } = item;
    count += 1;
    if (count > LIMITS.layersPerPage) {
      add(base, 'layout_too_large', `A page may hold at most ${LIMITS.layersPerPage} parts.`);
      return;
    }
    if (depth > LIMITS.layerDepth) {
      add(path, 'layout_too_deep', `Parts may nest at most ${LIMITS.layerDepth} levels deep.`);
      continue;
    }
    if (ids.has(layer.id)) add(`${path}.id`, 'duplicate_id', `Layer id "${layer.id}" is used twice on this page.`);
    ids.add(layer.id);
    if (depth > 1 && layer.type === 'Page') add(`${path}.type`, 'layout_root', 'Only the top part of a page may be a Page.');
    for (const [key, value] of Object.entries(layer.props)) {
      if (isForbiddenProp(key) || isVariableRef(value)) {
        add(`${path}.props.${key}`, 'forbidden_prop', `Prop "${key}" is not allowed. Use the part's variant, size, tone and action props.`);
      }
    }
    if (Array.isArray(layer.children)) {
      layer.children.forEach((child, i) => stack.push({ layer: child, path: `${path}.children.${i}`, depth: depth + 1 }));
    }
  }
}

/**
 * The menu slots: only the allowed parts, a Row holds the small parts and no Row, unique layer ids across both slots, at most
 * MENU_LIMITS.layers layers in all, and the same forbidden props as a page layout. Paths are "menu.start.0.children.1".
 */
function checkMenuLayers(menu: Menu, add: Add): void {
  const ids = new Set<string>();
  let count = 0;
  for (const slot of MENU_SLOTS) {
    const stack: Array<{ layer: LayoutLayer; path: string; parent: string | null }> = [];
    const top = slotLayers(menu, slot) as readonly LayoutLayer[];
    for (let i = top.length - 1; i >= 0; i -= 1) stack.push({ layer: top[i], path: `menu.${slot}.${i}`, parent: null });
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      const { layer, path, parent } = item;
      count += 1;
      if (count > MENU_LIMITS.layers) {
        add('menu', 'menu_too_large', `The menu bar may hold at most ${MENU_LIMITS.layers} parts.`);
        return;
      }
      if (parent !== null && parent !== 'Row') {
        add(`${path}.type`, 'menu_part_not_allowed', 'Only a Row can hold other parts in the menu bar.');
      } else {
        const problem = menuTypeProblem(layer.type, parent === 'Row');
        if (problem !== null) add(`${path}.type`, 'menu_part_not_allowed', problem);
      }
      if (ids.has(layer.id)) add(`${path}.id`, 'duplicate_id', `Layer id "${layer.id}" is used twice in the menu bar.`);
      ids.add(layer.id);
      for (const [key, value] of Object.entries(layer.props)) {
        if (isForbiddenProp(key) || isVariableRef(value)) {
          add(`${path}.props.${key}`, 'forbidden_prop', `Prop "${key}" is not allowed. Use the part's variant, size, tone and action props.`);
        }
      }
      if (Array.isArray(layer.children)) {
        for (let i = layer.children.length - 1; i >= 0; i -= 1) stack.push({ layer: layer.children[i], path: `${path}.children.${i}`, parent: layer.type });
      }
    }
  }
}

function checkPagesAndNav(spec: AppSpec, add: Add, opts: ValidateOptions): SpecIssue[] {
  const tables = new Map(spec.tables.map((t) => [t.id, t]));
  const pageIds = new Map<string, Page>();
  const routes = new Set<string>();
  const extra: SpecIssue[] = [];
  spec.pages.forEach((page, i) => {
    const at = `pages.${i}`;
    if (pageIds.has(page.id)) add(`${at}.id`, 'duplicate_id', `Page id "${page.id}" is used twice.`);
    pageIds.set(page.id, page);
    if (routes.has(page.route)) add(`${at}.route`, 'duplicate_route', `Route "${page.route}" is used by two pages.`);
    routes.add(page.route);
    const first = page.route.split('/')[1] ?? '';
    if (RESERVED_ROUTE_SEGMENTS.has(first)) add(`${at}.route`, 'reserved_word', `Routes cannot start with "/${first}". Pick another path.`);
    const sourceIds = new Set<string>();
    page.sources.forEach((src, k) => {
      const sat = `${at}.sources.${k}`;
      if (sourceIds.has(src.id)) add(`${sat}.id`, 'duplicate_id', `Source id "${src.id}" is used twice on page "${page.id}".`);
      sourceIds.add(src.id);
      checkSource(src, page, sat, tables, add);
    });
    checkLayout(page.layout, `${at}.layout`, add);
    if (opts.checkLayout) extra.push(...opts.checkLayout({ spec, page, path: `${at}.layout` }));
  });
  if (!routes.has('/')) add('pages', 'missing_home', 'One page must have the route "/" (the home page).');
  const navIds = new Set<string>();
  spec.nav.forEach((item, i) => {
    const at = `nav.${i}.pageId`;
    const page = pageIds.get(item.pageId);
    if (!page) add(at, 'unknown_page', `There is no page "${item.pageId}". Use one of: ${[...pageIds.keys()].join(', ')}.`);
    else if (page.route.endsWith('/:id')) add(at, 'route_param', 'The menu cannot link to a page that needs a record id.');
    if (navIds.has(item.pageId)) add(at, 'duplicate_id', `Page "${item.pageId}" is in the menu twice.`);
    navIds.add(item.pageId);
  });
  return extra;
}

/**
 * Validates an AppSpec: zod first, then referential checks (references point at declared tables, source
 * fields exist on the source table, values fit their field, nav pageIds exist, unique ids and routes,
 * reserved words), then the optional catalog hook. Never throws.
 */
export function validateAppSpec(input: unknown, opts: ValidateOptions = {}): SpecValidation<AppSpec> {
  const { issues, add } = collector(opts.maxIssues ?? LIMITS.issues);
  const tooBig = sizeProblem(input);
  if (tooBig) {
    add('', 'too_big', tooBig);
    return { ok: false, value: null, issues };
  }
  const parsed = AppSpecSchema.safeParse(input);
  if (!parsed.success) {
    addZodIssues(parsed.error, add);
    return { ok: false, value: null, issues };
  }
  const spec = parsed.data;
  checkApp(spec, add);
  checkTables(spec.tables, add);
  const extra = checkPagesAndNav(spec, add, opts);
  for (const issue of extra) add(issue.path, issue.code, issue.message);
  if (spec.menu !== undefined) checkMenuLayers(spec.menu, add);
  if (opts.checkMenu && hasSlotLayers(spec.menu)) {
    for (const issue of opts.checkMenu({ spec })) add(issue.path, issue.code, issue.message);
  }
  return issues.length === 0 ? { ok: true, value: spec, issues } : { ok: false, value: null, issues };
}

/** Validates the plan step's `{ tables }` block alone (zod plus the table checks). Never throws. */
export function validateTables(input: unknown, opts: Pick<ValidateOptions, 'maxIssues'> = {}): SpecValidation<Table[]> {
  const { issues, add } = collector(opts.maxIssues ?? LIMITS.issues);
  const tooBig = sizeProblem(input);
  if (tooBig) {
    add('', 'too_big', tooBig);
    return { ok: false, value: null, issues };
  }
  const parsed = TablesBlockSchema.safeParse(input);
  if (!parsed.success) {
    addZodIssues(parsed.error, add);
    return { ok: false, value: null, issues };
  }
  checkTables(parsed.data.tables, add);
  return issues.length === 0 ? { ok: true, value: parsed.data.tables, issues } : { ok: false, value: null, issues };
}

/** Issues as short lines for the repair prompt: "- tables.0.fields.1.type: message [code]". */
export function formatIssues(issues: readonly SpecIssue[], max = 12): string {
  return issues
    .slice(0, max)
    .map((i) => `- ${i.path}: ${i.message} [${i.code}]`)
    .join('\n');
}
