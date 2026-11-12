# Catalog of UI parts

Pages in an AppSpec are trees of catalog parts. The model composes pages from this catalog and nothing else: it never writes code, class names or function props. Developers extend the catalog in code, the way the kit's custom flow blocks are added. The page layout format is in [APP_SPEC.md](APP_SPEC.md); the decision to vendor ui-builder is ADR-002. Since phase 7 nothing builds the vendored editor: Design is the `@dnd-kit` canvas in `src/studio/design/`, and `src/vendor/ui-builder/` stays in the repo, unused.

## Features

Saved groups of parts ("features") sit on top of the catalog: a pure library in `src/catalog/features/` (validation, expansion into plain layers, limits, the two seed features), stored in `studio_features` and used from Design, the review on the Prompt step, the Feature builder and the Features page. See [FEATURES.md](FEATURES.md). The page-step schema offers the model a `Feature` entry only when features exist; the size numbers are in [BUDGETS.md](BUDGETS.md).

## Where the code lives

```
src/catalog/
  types.ts           PartDefinition, PartContext, Binding, PartComponentProps  (pure)
  enums.ts           TONES, SIZES, variants, ICONS re-export                   (pure)
  ids.ts             idEnum(ids): z.enum for non-empty lists, else z.never      (pure)
  bindings.ts        which ids a bindable prop may name, from a PartContext     (pure)
  actions.ts         actionSchema(ctx), navigateActionSchema(ctx)               (pure)
  modelParts.ts      CORE_PARTS, OPTIONAL_PARTS, DEFAULT_EXTRAS: which parts the page step offers (pure)
  parts/<Name>.def.ts  one PartDefinition per part                              (pure)
  parts/<Name>.tsx     the React component                                      (UI)
  parts/RecordFormView.tsx  the form RecordForm, the open-form dialog and the data browser share
  parts/format.ts    formatValue, formatStat, titleFieldOf                      (no zod)
  definitions.ts     PART_DEFINITIONS, in catalog order                         (pure)
  components.ts      PART_COMPONENTS: part name to component, no zod below it   (UI, the runtime imports this)
  context.tsx        CatalogDataContext, CatalogPageProvider and the data hooks (UI)
  ActionHost.tsx     the dialogs behind open-form and delete-record             (UI)
  registry.tsx       buildRegistry(ctx): ui-builder ComponentRegistry           (UI, no longer used by Design)
  modelSchema.ts     compact JSON Schema and prompt text for the model          (pure)
  validateLayout.ts  the checkLayout and checkMenu hooks for validateAppSpec    (pure)
  parts/menuSearch.ts   the list source and fields a menu SearchBox searches    (pure)
  parts/menuClasses.ts  the class tables of the menu bar                        (pure)
```

"Pure" files import only zod, `packages/runtime/src/spec/schema.ts` and each other, follow the ADR-006 syntax rules (relative `.ts` imports, `import type`, no JSX, no `@/`), and are imported by the Studio server for the generation pipeline. Components and `registry.tsx` are UI only. The runtime chunk carries no zod: components, `context.tsx`, `ActionHost.tsx` and `components.ts` reach a zod-importing file (enums, ids, actions, definitions, `*.def.ts`, `registry.tsx`, `modelSchema.ts`, `validateLayout.ts`) only through `import type`; `imports.test.ts` scans for it.

## The part contract

```ts
interface PartContext {          // built from the spec and the page being edited or generated
  tableIds: string[]; pageIds: string[]; sourceIds: string[];
  sources: Record<string, { table: string; mode: 'list' | 'record' }>;
  fields: Record<string, { id: string; type: FieldType }[]>;   // by table id, created_at and updated_at included
  recordPage: boolean;           // the page route ends in /:id
  recordPageIds?: string[];      // ids of the spec's pages whose route ends in /:id (absent: not checked)
}
interface Binding {
  prop: string;                  // dotted for nested props, e.g. "action.pageId"
  kind: 'source' | 'field' | 'fields' | 'table' | 'page';
  of?: string;                   // for field(s): the prop naming the source or table they belong to
  mode?: 'list' | 'record';      // for source
  fieldTypes?: FieldType[];      // for field(s)
  editable?: boolean;            // for field(s): not created_at or updated_at
}
interface PartDefinition {
  name: string;                  // PascalCase, equals layer.type
  group: 'layout' | 'data' | 'action';
  description: string;           // for the model, one or two sentences, at most 200 chars
  props: (ctx: PartContext) => z.ZodObject;   // strict object; ids narrowed to enums from ctx
  children: 'none' | 'text' | 'parts';
  allowedChildren?: string[];    // when children is 'parts'; omitted means any part except Page
  childOf?: string[];            // allowed parents; omitted means any part whose children are 'parts'
  binds: Binding[];
  example: LayoutLayer;          // one valid example layer (ids included), shown to the model
  textDefault?: string;          // default text for children 'text'
  childCount?: { min: number; max: number };  // children 'parts' only: how many children it holds (Columns 2 to 4)
  designProps?: (ctx: PartContext) => z.ZodObject;  // props a stored layer may carry, a superset of `props`; absent: `props`
}
```

Rules for every part:

- **Props are data.** Enums over free text; strings have a `max`. No `className`, `style`, `on...` or function props (the spec validator refuses them on any layer). Styling is only through `variant`, `size` and `tone`, which map to kit tokens (`docs/DESIGN.md`): no new colors, no new button styles. A human-only "advanced className" toggle is not in v1.
- **Components** are kit styled (`SectionCard`, `formStyles.js`, `glass-*`, `slate-slateNNN`, `text-accent-*`), JSX or TSX, receive the parsed props plus rendered `children`, and read data only through `context.tsx` hooks. They never fetch on their own.
- **Ids from the model are enums.** `props(ctx)` builds `z.enum` from `ctx` (sources, fields, pages, tables), so structured output can only pick declared ids. `idEnum([])` is `z.never()`: a part whose required binding has nothing to bind to cannot be generated, which is correct.
- **`designProps` is for Design only.** The layout validator parses a stored layer against `designProps ?? props`; the model schema and prompt are built from `props` alone, so a prop that is only in `designProps` is set in Design and the helper never sees it. Grid uses it for `placement` and `rows` and the 12-column value (ADR-012).
- **Defaults live in the zod schema** (`.default(...)`), so the designer's auto-form and the model share them.

## Shared enums

| Enum | Values | Maps to |
| --- | --- | --- |
| `tone` | `neutral`, `muted`, `accent`, `success`, `warning`, `danger` | `slate100`, `slate400`, `accent-indigo`, `accent-green`, `accent-amber`, `accent-red` |
| `size` | `sm`, `md`, `lg` | the kit type scale (`text-sm`, `text-base`, `text-lg`, headings `text-xl` to `text-3xl`) |
| `icon` | the AppSpec `ICONS` list | lucide-react, size 14 to 16 |

## The part list

34 parts: the 19 of v1 and the 15 of phase 8 (Columns, Column, Row, NavLinks, Breadcrumb, BackLink, PageHeader, Callout, Collapsible, Chart, ProgressBar, Timeline, Checklist, SortControl, QuickAdd). ExportButton is deferred: the export route returns one ZIP with both formats, behind sign-in, and Preview cannot reach it.

Layout parts:

| Part | Props (default) | Children | Placement |
| --- | --- | --- | --- |
| Page | `width`: `narrow`, `normal`, `wide` (`normal`) | parts | layout root only |
| Section | `title?` label, `subtitle?` (120), `icon?`, `variant`: `card`, `plain` (`card`) | parts | |
| Grid | `columns`: 1 to 4 (2), or 12 with `placement: free`; `gap`: `sm`, `md`, `lg` (`md`); `placement`: `flow`, `free` (`flow`); `rows?` 1 to 60 (free only) | parts | shown as "Auto grid" on the Features page and the Design shelf |
| Card | `title?` label, `tone` (`neutral`), `variant`: `subtle`, `outline` (`subtle`) | parts | |
| Tabs | none | Tab only | |
| Tab | `label` | parts | `childOf: ['Tabs']` |
| Heading | `size` (`md`), `tone` (`neutral`) | text | |
| Text | `size`: `sm`, `md` (`md`), `tone` (`neutral`) | text | |
| Divider | `spacing`: `sm`, `md`, `lg` (`md`) | none | |
| Columns | `layout`: `equal`, `wide-left`, `wide-right`, `sidebar-left`, `sidebar-right` (`equal`), `gap`: `sm`, `md`, `lg` (`md`), `align`: `top`, `center`, `stretch` (`top`) | Column only, 2 to 4 (`childCount`) | |
| Column | none | parts | `childOf: ['Columns']` |
| Row | `gap`: `sm`, `md`, `lg` (`sm`), `justify`: `start`, `between`, `end` (`start`), `wrap`: `wrap`, `one-line` (`wrap`) | the small parts: every part except Page, Tab, Column, Columns, Tabs and Section | |
| PageHeader | `title` label, `subtitle?` (120), `icon?` | Button, Link and QuickAdd, 0 to 3 (`childCount`) | |
| Callout | `tone`: `note`, `success`, `warning`, `danger` (`note`), `title?` label | text | |
| Collapsible | `title` label, `start`: `closed`, `open` (`closed`) | parts | |

Data parts (all `children: 'none'`):

| Part | Props (default) | Binds |
| --- | --- | --- |
| DataTable | `source`, `columns` (1 to 8 field ids; default the first 5 fields), `rowAction?`, `pageSize`: 10, 25, 50 (25), `emptyText?` (120) | source (list); columns of source |
| RecordForm | `table`, `mode`: `create`, `edit` (`create`), `source?` (required for edit), `fields?` (1 to 30; default all), `submitLabel?` label, `afterSave?` navigate action | table; source (record); fields of table |
| RecordDetail | `source`, `fields?` | source (record); fields of source |
| StatCard | `source`, `stat`: `count`, `sum`, `avg`, `min`, `max` (`count`), `field?` (required unless `count`), `label`, `tone`, `icon?` | source (list); field of source, integer or real |
| RecordList | `source`, `titleField?`, `subtitleField?`, `badgeField?` (select), `rowAction?`, `emptyText?` | source (list); fields of source |
| FilterBar | `source`, `fields` (1 to 4: select, boolean, date, datetime, reference) | source (list); fields of source |
| SearchBox | `source`, `fields` (1 to 4: text, longtext), `placeholder?` (60) | source (list); fields of source |
| ReferencePicker | `source`, `field` (a reference field of the source's table), `label?` | source (list); field of source, reference |
| Chart | `source`, `kind`: `bar`, `line` (`bar`), `groupBy` (select, boolean, date, datetime, reference), `measure`: `count`, `sum`, `avg` (`count`), `field?` (integer or real; required unless `count`), `bucket`: `day`, `month` (`month`), `title?` label | source (list); groupBy and field of source |
| ProgressBar | `source` (list or record), `stat`: `count`, `sum` (`count`), `field?` (integer or real; required for `sum` and for a record source), `target` whole number 1 to 1,000,000,000 (10), `label`, `tone` (`accent`) | source; field of source, integer or real |
| Timeline | `source`, `dateField` (date, datetime), `titleField?`, `subtitleField?`, `order`: `newest`, `oldest` (`newest`), `emptyText?` (120) | source (list); the three fields of source |
| Checklist | `source`, `field` (an editable boolean), `titleField?`, `emptyText?` (120) | source (list); field of source, boolean, editable; titleField of source |
| SortControl | `source`, `fields` (1 to 6: text, integer, real, date, datetime, select), `label?` | source (list); fields of source |
| QuickAdd | `table`, `field` (an editable text field of the table), `placeholder?` (60), `buttonLabel?` label | table; field of table, text, editable |

Action parts:

| Part | Props (default) | Children |
| --- | --- | --- |
| Button | `variant`: `primary`, `secondary`, `danger` (`primary`), `size`: `sm`, `md` (`md`), `icon?`, `action` | text (the label) |
| Link | `action` (navigate only) | text |
| BackLink | `action` (navigate only) | text (default `Back`) |
| NavLinks | `show`: `menu`, `pages` (`menu`), `pages?` (1 to 8 pages without `:id`, required for `pages`), `direction`: `horizontal`, `vertical` (`horizontal`), `icons`: `show`, `hide` (`show`) | Button and Link, 0 to 3, drawn as list items after the page links |
| Breadcrumb | `page` (a page without `:id`), `source?` (a record source) | none |

Behavior notes: StatCard values come from `GET /api/data/:table/stats` over the source's conditions, but not a typed search: a Number tile or Chart keeps the page's totals while the list narrows (a FilterBar's filters still apply; code computes, the model never supplies a number). FilterBar, SearchBox and ReferencePicker add conditions to their source for the current page view only (same operator set as sources; SearchBox uses `query.js` `search`, which is `app_icontains`); they never change the spec. Delete always asks through the kit `ConfirmDialog`; `open-form` opens a kit `Modal` with a RecordForm.

Details the table cannot hold:

- Components get the layer's props as stored (no zod parse in the runtime), so every component applies the same defaults as its schema. A test renders each part from raw and from parsed props and compares the markup.
- DataTable pages through the source by `pageSize` (`useSource(source, { limit })`). Left out, `columns` is the first five fields of the table. Reference columns show the title of the referenced record (one `id in (...)` request per target table). A row click runs `rowAction` with the row (`useRunAction()(action, { table, id })`).
- FilterBar: select, boolean and reference fields set `eq`; date and datetime set `gte` and `lte` (a datetime bound is the local start or end of the chosen day as an ISO timestamp). SearchBox waits 250 ms after typing; the last SearchBox of a page wins. ReferencePicker lists up to 200 records sorted by title.
- RecordForm and the open-form dialog share `RecordFormView`: an input per field type, create prefills the spec defaults, an empty optional field is left out on create and sent as `null` on edit, and a server problem naming a field shows beside that field. Where the page is not live (no `navigate`: the designer canvas, the Features library tiles and drawer, the Feature builder previews) the form shows no button and never writes, even on Enter; Preview and built apps pass `navigate` and keep Save.
- Tabs: each Tab tells its Tabs its label, only the active Tab renders its parts, the arrow keys move between tabs.
- A part with no data source (the designer canvas) shows a one-line placeholder instead of rows.

Behavior of the phase 8 parts (the stubs of the foundation package show only a plain name or their parts; each owner package builds the part to this):

- **Columns, Column, Row.** Columns counts its children for the template (fewer than 2: one column; more than 4: the template of 4 wraps). `layout` maps to a constant table of literal Tailwind classes per layout and count, all `grid-cols-1 md:grid-cols-[...]`, so below 768 px everything stacks; `wide` is `2fr` against `1fr`, `sidebar` is a narrow outer column (`minmax(12rem,1fr)`) against `3fr`. `gap` is the theme spacing times 2, 4 or 6; `align` maps to `items-start`, `items-center`, `items-stretch`. Column is `min-w-0 space-y-3`. Row is `flex items-center` with `gap`, `justify` and `wrap`.
- **NavLinks.** `<nav aria-label="Page links">` of buttons that navigate without a record, `aria-current="page"` on the current page. `menu`: the `spec.nav` items whose page has no `:id`, label and icon from the item. `pages`: the label of the nav item for that page, else the page title. Button and Link children follow the page links as list items; the empty line shows only when there are no links and no children. Nothing to show: `No pages to show yet.`
- **Breadcrumb.** `<nav aria-label="Breadcrumb">` with a list: the title of `page` (a button), then the record title (`titleFieldOf` of the record source) or the current page title as `aria-current="page"`.
- **BackLink** is a Link with an arrow icon and the same action rules. **PageHeader** is a `font-display` title (`h2`), the subtitle, and its Button, Link and QuickAdd children on the right; it stacks below `sm`.
- **Callout.** `role="note"` with an `sr-only` word first (`Note:`, `Good news:`, `Warning:`, `Problem:`) and the accent border and tint of its tone. **Collapsible.** A button with `aria-expanded` and `aria-controls`; where the page is not live (the canvas, previews) it always renders open.
- **Chart.** The server groups (`useSourceGroups`, at most 12 groups plus one "other" row; a date group's no-date bucket is its own "No date" row past the limit and never part of "Earlier"); the part only draws, at the figure's measured width so its text keeps one size. A Decimal value shows two decimals (1,200.50), counts and axis ticks stay whole. Plain SVG on kit tokens, a `<figure>` holding an `svg` with `role="img"` and an `sr-only` table of label and value. A datetime or date group is bucketed in UTC by day or month, so a late-evening record can fall on the next day.
- **ProgressBar.** A list source shows the count or the sum from the stats; a record source shows `record[field]`. The percent is `clamp(round(value / target * 100), 0, 100)` computed in code; `role="progressbar"`.
- **Timeline.** Rows of the source sorted by `dateField` (`useSource(source, { sort })`), grouped by day in code, a heading per day.
- **Checklist.** A checkbox per row that updates the boolean field through the data layer (`useMutations().update`, validated like a form). Not live: disabled. **SortControl** sets the sort of the source for the page view (`useSourceSort`); the page sort is replaced by `useSource`'s own `sort` option when a part passes one. **QuickAdd** creates a record from one text field (`useMutations().create`); not live: disabled.
- **Live or not.** `useIsLive()` is true when the data layer can navigate (a built app, Preview) and false on the Design canvas and in previews; the parts that write are disabled when it is false.

## Declarative actions

`actionSchema(ctx)` is a discriminated union on `action`:

```ts
{ action: 'navigate', pageId: PageId, withRecord: boolean /* false */ }
{ action: 'open-form', table: TableId, mode: 'create' | 'edit' /* 'create' */ }
{ action: 'delete-record', table: TableId, thenPageId?: PageId }
```

- `withRecord: true` passes the current record id to a page whose route ends in `/:id`; the target page must have that route (`action_needs_record` otherwise), and the reverse: navigating to a `/:id` page needs `withRecord: true`.
- `open-form` with `mode: 'edit'` and `delete-record` act on the **current record**: the row, when the action is a DataTable or RecordList `rowAction`, or the page's record source of the same table on a `/:id` page. Without one, `action_needs_record`.
- The runtime executes actions through `useRunAction()`; no action carries code, a URL or a callback. Link is navigate-only (no external URLs in v1: the shell's navigation policy opens web links outside the app anyway).

## Data binding to page sources

- A bindable prop holds a **source id** of the current page (`"source": "open_crews"`) or ids of fields of that source's table. Bindings are declared per part (`binds`) and checked by `validateLayout.ts`.
- Components call `useSource(sourceId)` (returns `{ rows, total, loading, error, refresh, offset, setOffset }`; the optional second argument `{ limit }` sets the page size) or `useRecord(sourceId)` (record mode), plus `useSourceStats(sourceId)`, `useSourceFilters(sourceId)` (run-time conditions and search), `useMutations()` (create, update, remove; each refetches every source of that table) and `useRunAction()`. Without a provider or data source every hook returns empty values and no-op setters. The provider is `CatalogDataContext`: the runtime's `SpecPage` implements it over `{apiBase}/data/...` (`apiBase` is `/api` in a built app and `/api/preview` in Studio Preview); the Studio designer implements it with sample rows (Preview data when running, else three placeholder rows generated from field types).
- Parts name a source; they never build a query. The data API resolves a source by page id and source id from the spec it runs with, re-validates every run-time filter with the same rules as the AppSpec validator, and never accepts a table or column outside the compiled spec.
- **ui-builder variables are not used** in v1: `LayerRenderer` gets no `variables`, `variableValues` or `functionRegistry`, and the spec validator refuses `{ "__variableRef": ... }`. Variables are untyped strings, numbers, booleans or function keys, which would bypass the binding checks above; sources replace them.

## Mapping a part to a ui-builder registry entry

`buildRegistry(ctx)` returns one `ComponentRegistry` entry per part, rebuilt (memoized) when the page's sources or the spec's tables change:

| Registry key | From the part |
| --- | --- |
| `component` | `parts/<Name>.tsx` |
| `schema` | `def.props(ctx)`, plus `children: z.string()` when `def.children === 'text'` (ui-builder edits text children through the schema) |
| `from` | `'@/catalog/parts/<Name>'` (only used by ui-builder's code export) |
| `defaultChildren` | `def.textDefault` for text parts, `[]` otherwise |
| `fieldOverrides` | `children` as a textarea; `source`, field and page props as selects of the enum values; `action` with a small action editor (`src/studio/`, phase 3) |
| `childOf` | `def.childOf` |

ui-builder only enforces `childOf`. `allowedChildren` (for example Tabs accepts only Tab) and the bindings are enforced by `validateLayout.ts`, which the designer also runs on every change to mark invalid layers.

## Validation of layouts

`validateLayout.ts` exports `checkLayout(ctx: LayoutCheckContext): SpecIssue[]`, passed to `validateAppSpec(input, { checkLayout })`. It parses each layer's props with its part's `props(ctx)` and adds codes: `unknown_part`, `invalid_props` (zod issue path appended, for example `pages.0.layout.children.1.props.columns.0`), `child_not_allowed`, `children_not_allowed` (text or parts where the part takes none), `wrong_child_count` (a part with `childCount` holds too few or too many children: `Columns holds 2 to 4 Column parts. It has 1.`, `PageHeader holds at most 3 parts. It has 4.`), `unknown_source`, `wrong_source_mode`, `unknown_field`, `wrong_field_type`, `unknown_page`, `action_needs_record`, `grid_not_allowed` (a `grid` block on a layer that is not a child of a free Grid: `This part has a place on a grid, but it is not inside a grid that places parts freely. Remove its place, or move it into a grid with Place parts freely turned on.`, at `...grid`), `grid_overlap` (a child of a free Grid whose cells overlap an earlier child: `Two parts cannot share the same cells. Move or resize one of them to empty cells.`, at `...children.N.grid`), `sizing_not_allowed` (a `sizing` block on a Page, Tab or Column: `Tab takes the width of the part it is in, so it cannot have sizing. Remove sizing.`, at `...sizing`). Messages follow the APP_SPEC rule: one sentence, the fix, the allowed values.

**The menu bar.** `checkMenu(ctx: MenuCheckContext)` runs `checkLayer(layer, menuPartContext(spec), "menu.start.0", 20, "menu")` over every top layer of both slots, and `CATALOG_CHECKS = { checkLayout, checkMenu }` is what every production caller of `validateAppSpec` spreads (`validateAppSpec(x, { ...CATALOG_CHECKS })`; `catalogChecks.test.js` scans for a caller that does not). The `place` argument of `checkLayer` is `page` (default) or `menu`. In the menu a part's optional `menuProps(ctx)` replaces its `props(ctx)` and its bindings are not checked, because the menu has no sources: SearchBox's `menuProps` is `{ placeholder? }`, and `packages/runtime/src/catalog/parts/menuSearch.ts` binds it at render time. `menuPartContext(spec)` offers every table, page and field, no sources and `recordPage: false`, so `checkActions` already refuses `delete-record`, an `edit` form and `withRecord: true`. The allow list itself (`menu_part_not_allowed`, `menu_too_large`) is enforced by `validateAppSpec` without the hook (APP_SPEC.md, "Menu slots").

- A binding problem replaces the enum error that zod reports under the same path (one issue per problem). Bindings are checked from each definition's `binds`; the field of a `fields` binding is looked up in the table of the `of` source or table.
- Cross-prop rules are `invalid_props`: a RecordForm in `edit` mode needs a `source` (a record source of its own table), a StatCard whose `stat` is not `count` needs a `field`, a Chart whose `measure` is not `count` needs a `field`, a ProgressBar needs a `field` for `stat: sum` on a list source and for any stat on a record source, and a NavLinks with `show: pages` needs `pages`. For Grid: `placement: free` needs `columns: 12`, `columns: 12` needs `placement: free`, `rows` needs `placement: free`, and `rows` of a free Grid must be at least the last row its parts reach.
- `action_needs_record`: `withRecord: true` needs a target page whose route ends in `/:id` and a record at hand (a row action, a form's `afterSave`, or a `/:id` page); a target that needs an id needs `withRecord: true`; `open-form` edit and `delete-record` need the page's record source of that table, or are a row action on a source of that table. Action checks are skipped for a layer whose props do not parse.

## Rows of parts

A layer may carry a `sizing` block (`{ width, grow }`, APP_SPEC.md "Layer sizing") to sit beside its neighbours. The literal classes and the grouping helper are in `parts/sizingClasses.ts` (pure, no colors), shared by the runtime `SpecRenderer` and the Design canvas so both draw the same row.

- `SIZED_PARENTS` (Page, Section, Card, Collapsible, Column, Tab) stack their children. `sizingSegments(parentType, children)` splits their children into singles (width `full`, or absent) and rows (each run of consecutive children whose width is not `full`). A parent with no row segment renders exactly the plain list of before, with the same elements and keys.
- A row is `<div class="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start">`; each item is a `<div>` with `min-w-0`, one `md:basis-*` class and `md:grow` when `grow` is set, holding the part. Below `md` every item stacks at full width.
- Share widths subtract their part of the gaps: `basis = f * 100% - g * (1 - f)` with `g = 4 * --spacing` (the `gap-4` of the row), so two halves, a third plus two thirds, three thirds, four quarters, or a quarter plus three quarters fill one line at any theme density. `fit` is `md:basis-auto`, `full` is `md:basis-full`.
- `UNSIZED_TYPES` (Page, Tab, Column) take their width from their parent: a `sizing` block on them is `sizing_not_allowed`. Under Grid, Row, PageHeader, Tabs and Columns a block is kept and ignored (no wrapper), so Columns and PageHeader still count their real children.

## Parts placed freely

A Grid with `placement: free` lays out its children on 12 columns (APP_SPEC.md, "Free placement on a grid"). The literal classes are in `parts/gridClasses.ts` (pure, no colors), shared by the runtime `SpecRenderer` and the Design canvas.

- **Tables.** `COL_START_CLASS` (1 to 12), `COL_SPAN_CLASS` (1 to 12), `ROW_START_CLASS` (1 to 60) and `ROW_SPAN_CLASS` (1 to 12): 96 literal classes, each written out so the Tailwind scanner sees it (`md:col-start-4`, `md:col-span-3`, `md:row-start-2`, `md:row-span-1`).
- **Container and items.** The container is `flex flex-col md:grid md:grid-cols-12 md:auto-rows-[minmax(calc(var(--spacing)*10),auto)]` plus the Grid's own gap class. Each child of a free Grid is wrapped in a `<div>` with `min-w-0 md:flex md:flex-col md:*:grow` and its four position classes, so the part grows to fill its rows. A child without a readable block gets `min-w-0 md:col-span-12` and the browser places it.
- **Reading order.** The children are in the DOM in reading order (row, then column), sorted by `readingOrder`; there is no CSS `order`, so a screen reader hears what a sighted reader sees.
- **Narrow screens.** Below `md` the wrappers are plain blocks in a column, so a phone gets one column in reading order.
- **Row height.** Rows are `auto` with a minimum of `10 * --spacing`, the same on the canvas and in built apps. `rows` is stored for readers and the Design overlay; the CSS does not use it.

## Compact JSON Schema for the model

`modelSchema.ts` derives every schema the model sees from zod, so there is one definition:

- **Tables step**: `compactJsonSchema(z.toJSONSchema(TablesBlockSchema, { io: 'input' }))`.
- **Page step** (one page per call): `pageJsonSchema(ctx)`. The model's layer shape is `{ type, props, children }` with no `id` or `name`: code assigns ids afterwards (`assignLayerIds`, deterministic `<type>_<n>` with the type lowercased, n per type from 1, pre-order; the root is `root_<pageId>`). The tree is generated to a fixed depth of four (Page, container, container, leaf) as explicit nested schemas instead of a recursive `$ref`, which small models and grammar decoders handle better. `$defs.l2` and `l3` are `anyOf` over the containers allowed at that depth plus the leaves (`l4`: parts that hold text or nothing); Tabs sit at level 2 only and hold `t3`, the Tab entry. A container's props schema is shared as `$defs.p_<Name>`; a leaf carries its props inline. A part with no children has no `children` key (`assignLayerIds` adds `[]`), a text part has `{ type: 'string', maxLength: 2000 }`. Every entry except the Page root, Tab (`t3`) and Column (`c3`) has an optional `width` that refers to `$defs.w`, the enum of layer widths (ADR-009; no `grow`). `assignLayerIds` turns a width other than `full` into `sizing: { width, grow: false }` and drops any other value, never a repair round. A part whose required binding has no candidate in the context (a DataTable with no list source) is left out. Sub-schemas that repeat (the action union, the icon list) become `$defs.h<n>` references.
- **`compactJsonSchema(schema)`** removes `$schema`, `$id`, `title`, `description`, `default`, `examples` and `pattern` (ids are enums already; regex support in grammar decoders is partial), and turns `oneOf` into `anyOf`. It keeps `type`, `const`, `enum`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`, `maxLength`, `anyOf`, `$defs`, `$ref`, drops `type` next to an `enum` or `const`, and removes what nothing can satisfy (an id enum with no ids): such a branch, an optional property, or the whole schema (`{ not: {} }`). `z.toJSONSchema` throws on types JSON Schema cannot express; that is wanted (no transforms or custom types in part schemas).
- **Leaves for the model** (ADR-010): `MODEL_LEAVES` (NavLinks) lists parts that hold children in the catalog but are written as leaves in the page schema and prompt, so their entry stays as before. PageHeader offers Button, Link and QuickAdd. The model never writes menu slots (`start`, `end`); an edit keeps the current ones.
- **Descriptions go to prompt text, not the schema.** The catalog words the model sees are built from the part definitions. Helper prompt budgets are kept with the helper (pro, not in the public source).
- **Size targets** are enforced by tests through exported constants in the helper (pro). Ollama receives the schema through the structured output extension of `server/ai/providers/ollama.js` (`format: <schema object>`, phase 3).

## The phase 1 spike catalog

Phase 1 built five parts: **Page**, **Section**, **Heading**, **Text** and **Button** (with the full `action` prop schema; the spike runtime executes `navigate` and shows "Not available yet" for the other two). It also creates `types.ts`, `enums.ts`, `ids.ts`, `actions.ts`, `definitions.ts`, `context.tsx` (with stub hooks), `registry.tsx`, and a first `validateLayout.ts` covering `unknown_part`, `invalid_props`, `child_not_allowed` and `children_not_allowed`. `/designer` opens the vendored UIBuilder with this registry; `/preview` renders a saved layout with `LayerRenderer`. Phase 2 added the remaining parts, the data hooks and the model schema (the 19 parts of v1; phase 8 added 15 more); phase 3 adds the designer's field overrides and action editor.

## Which parts the model is offered

The helper (pro) splits the catalog into core parts, offered on every page, and optional parts, offered only when asked for. Columns hold `c3`, the Column entry, as Tabs hold `t3`; both sit at level 2. A part with `childCount` writes `minItems` (when above 0) and `maxItems` on its children array. The part lists, defaults and caps are kept with the helper (pro, not in the public source).

## Data hooks added in phase 8

`context.tsx` adds `useIsLive()`, `useSourceSort(sourceId)` (the sort a SortControl set for a source; `useSource` sends it, and its own `opts.sort` beats it), and `useSourceGroups(sourceId, { groupBy, measure, field?, bucket? })`, which calls the optional `CatalogDataSource.groups`. A data source without `groups` makes the hook report `Not available here.`.

## Adding a part (developers)

1. `parts/<Name>.def.ts` (definition, pure) and `parts/<Name>.tsx` (component, kit tokens only).
2. Add it to `PART_DEFINITIONS` in `definitions.ts`.
3. Tests: the example validates, the component renders in both themes, the page-step schema stays under its size target.
4. Bump nothing in `specVersion`: a new part is a compatible change (APP_SPEC.md, Versioning).
