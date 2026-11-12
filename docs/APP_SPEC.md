# AppSpec v1

An AppSpec is the whole definition of an app built with Local App Studio: its tables, its pages (composed from catalog parts), its menu and its theme. It is plain JSON. The authoritative schema is `packages/runtime/src/spec/schema.ts` (zod 4); this page explains it. If the two disagree, the code wins and this page is fixed.

Where it lives: Studio stores drafts per app; a built app has it baked in as `config/app-spec.json` (ADR-001). How it becomes a database: ADR-004. How pages use catalog parts: [CATALOG.md](CATALOG.md).

## Example

```json
{
  "specVersion": 1,
  "app": { "name": "Crew Roster", "slug": "crew-roster", "identifier": "com.example.crewroster",
           "version": "1.0.0", "description": "Crews and their leads", "icon": "users" },
  "tables": [
    { "id": "people", "label": "People", "titleField": "name", "fields": [
      { "id": "name", "label": "Name", "type": "text", "required": true } ] },
    { "id": "crews", "label": "Crews", "titleField": "name", "fields": [
      { "id": "name", "label": "Name", "type": "text", "required": true },
      { "id": "size", "label": "Size", "type": "integer", "default": 1 },
      { "id": "lead_id", "label": "Lead", "type": "reference", "table": "people" },
      { "id": "status", "label": "Status", "type": "select", "options": ["active", "paused"], "default": "active" } ] }
  ],
  "pages": [
    { "id": "home", "title": "Home", "route": "/",
      "sources": [ { "id": "open_crews", "table": "crews",
                     "where": [ { "field": "status", "op": "eq", "value": "active" } ],
                     "orderBy": [ { "field": "name", "dir": "asc" } ], "limit": 50 } ],
      "layout": { "id": "root", "type": "Page", "props": {}, "children": [
        { "id": "h1", "type": "Heading", "props": { "size": "lg" }, "children": "Open crews" },
        { "id": "t1", "type": "DataTable", "props": { "source": "open_crews", "columns": ["name", "size", "status"] }, "children": [] } ] } }
  ],
  "nav": [ { "pageId": "home", "label": "Home", "icon": "home" } ],
  "theme": { "preset": "aurora", "radius": "md" }
}
```

Differences from the brief's seed: `orderBy` entries are objects (`{ "field", "dir" }`), not tuples (small models fill objects more reliably, and the JSON Schema stays simple); `theme.preset` uses the kit's background preset ids and `theme.id` the built-in theme ids; `source` ids follow the id regex (no camelCase).

## Top level

| Key | Type | Rules |
| --- | --- | --- |
| `specVersion` | literal `1` | Required. See Versioning |
| `app` | object | Required. Below |
| `tables` | array | 0 to 30. Default `[]` |
| `pages` | array | 1 to 30. One page must have route `/` |
| `nav` | array | 0 to 20. Default `[]` |
| `theme` | object | Default `{ "preset": "aurora", "radius": "md" }`; optional `id` and `overrides` (see Nav and theme) |
| `menu` | object | Optional, no default: absent is the classic look (the kit drawer only) and adds no key anywhere (see Menu bar) |

Unknown keys are rejected at every level (`unrecognized_keys`), so a model cannot smuggle in extra data. The whole spec is at most 512 KiB of JSON.

## `app`

| Key | Rule |
| --- | --- |
| `name` | 2 to 40 chars, `^[A-Za-z][A-Za-z0-9]*( [A-Za-z0-9]+)*$` (same rule as `init-app`). Becomes the window title, the installer name and the data folder `%APPDATA%\<name>\`. Not `Local App Studio` or `Local App Studio Dev` (`reserved_name`) |
| `slug` | 2 to 40 chars, `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Build folder and output folder name |
| `identifier` | Reverse DNS, at most 120 chars, lowercase parts of `a-z 0-9 -`, at least two parts. Must not end in `.dev` or `.app` and must not start with `com.neuralfoundry.localappstudio` (`reserved_identifier`) |
| `version` | `MAJOR.MINOR.PATCH`, digits only (no pre-release tags: the Windows installer needs plain numbers) |
| `description` | 0 to 300 chars, default `""` |
| `icon` | One of the icon names below, or `null` (default) |

## Ids and reserved words

Table, field, page and source ids match `^[a-z][a-z0-9_]{0,30}$`. Layer ids (inside layouts) match `^[A-Za-z0-9_-]{1,64}$` and are assigned by code, never by the model. Reserved, checked after zod (`reserved_word`):

- **Table ids**: every SQLite keyword (the full list at sqlite.org/lang_keywords.html, plus `true`, `false`, `strict`); kit and Studio tables `items`, `app_state`, `assistant_conversations`, `assistant_messages`, `app_secrets`, `audit_log`, `schema_version`, `app_schema_version`, `apps`, `builds`; prefixes `sqlite_`, `app_`, `assistant_`, `studio_`; kit cloud category ids `items`, `notes`, `memory`, `mixed` (table ids double as category ids); Windows device names `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9` (table ids become export file names).
- **Field ids**: every SQLite keyword; the runtime columns `id`, `created_at`, `updated_at`; SQLite's implicit `rowid` and `oid` (`query.js` treats `rowid` specially).
- **Route first segments**: `api`, `assets`, `data`, `desktop`, `designer`, `items`, `preview`, `settings`, `studio`.

The sets are exported from `schema.ts` (`SQL_KEYWORDS`, `KIT_TABLE_IDS`, `isReservedTableId`, `isReservedFieldId`, ...). When a kit table is added upstream, add it to `KIT_TABLE_IDS`.

## Tables and fields

A table: `{ id, label, titleField?, fields }`. `label` is 1 to 60 chars, single line. `fields` holds 1 to 60 entries. `titleField` names a text, longtext or select field shown as the record's title (reference pickers, lists); without it the runtime uses the first text field, then the id. Every table also gets `id` (uuid), `created_at` and `updated_at`, added by the runtime; do not declare them.

A field: `{ id, label, type, required?, default?, ... }`, a discriminated union on `type`. `required` defaults to `false` and means NOT NULL. `default` must have the field's own type:

| `type` | Extra keys | `default` | Stored as |
| --- | --- | --- | --- |
| `text` | | string, at most 500 | TEXT, max 500 |
| `longtext` | | string, at most 20000 | TEXT, max 20000 |
| `integer` | | safe integer | INTEGER |
| `real` | | finite number | REAL |
| `boolean` | | `true` or `false` | INTEGER 0 or 1 |
| `date` | | `"YYYY-MM-DD"` | TEXT, canonical date |
| `datetime` | | ISO with `Z`, like `"2026-01-31T09:00:00Z"` | TEXT, canonical UTC |
| `select` | `options`: 1 to 50 unique strings of 1 to 60 chars | one of `options` | TEXT with a CHECK |
| `reference` | `table`: id of another declared table | not allowed | uuid TEXT with a foreign key |

References form a tree: no table may point at itself, directly or through other tables (`reference_cycle`). This keeps `IMPORT_ORDER` (parents first) well defined. Deleting a referenced record: an optional reference is set to null, a required one blocks the delete (`record_in_use`).

A text or integer field may carry `autoNumber`, and a table may carry `rules` (see "Automations").

## Pages

A page: `{ id, title, route, sources, layout }`.

- `route`: `/` or a lowercase path like `/crews` or `/crews/open`, at most 60 chars, optionally ending in `/:id` (a record page). Routes are unique. Pages with `/:id` cannot be in `nav`.
- `sources`: 0 to 8 named queries the page's parts bind to (below).
- `layout`: a ui-builder `ComponentLayer` tree: `{ id, type, name?, feature?, sizing?, props, children }` where `children` is an array of layers or a string (text content). The root's `type` is `Page`, and only the root. Limits: 300 layers, 16 levels. `props` values are JSON. Never allowed in props: `className`, `style`, `children`, `dangerouslySetInnerHTML`, `key`, `ref`, any `on...` handler, and ui-builder variable references (`{ "__variableRef": ... }`) (`forbidden_prop`). Whether `type` is a real catalog part and whether its props are valid is checked by the catalog hook (CATALOG.md).
- `feature` (optional, on any layer): `{ id, version, params }`, the marker the feature expander puts on the root of an expanded block (FEATURES.md). `id` follows the id rules, `version` is an integer from 1 to 1000000, `params` maps at most 6 parameter names to texts of at most 2000 characters. It is inert data: the runtime renders `type`, `props` and `children` only, and unknown keys on a layer are still refused. A layer of type `Feature` (`{ "type": "Feature", "props": { "featureId", "params" } }`) is a request to expand, never stored: every write path expands it first, and a stored or built spec that still holds one fails the catalog check as `unknown_part`.

## Sources

`{ id, table, mode, where, orderBy, limit }`, translated by the runtime one-to-one onto `server/db/query.js` `select`.

| Key | Rule |
| --- | --- |
| `id` | Unique on the page |
| `table` | A declared table |
| `mode` | `list` (default) or `record`. `record` is the one row whose id is the `:id` of the page route; it needs a route ending in `/:id` and takes no `where` or `orderBy` |
| `where` | 0 to 8 conditions `{ field, op, value }`, all must hold (AND). `field` is a field of the table or a runtime column |
| `orderBy` | 0 to 3 entries `{ field, dir }`, `dir` `asc` (default) or `desc` |
| `limit` | Integer 1 to 200, default 50 |

Operators are exactly those of `query.js` `op`: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`. Several conditions on one field are combined with `op.and`, so the same operator may appear only once per field (`duplicate_condition`). `in` takes a list of at most 50 values; every other operator takes one value. `null` works only with `eq` and `ne` (`IS NULL`, `IS NOT NULL`). Ordering operators (`gt`, `gte`, `lt`, `lte`) are refused on boolean, select and reference fields and on `id` (`op_not_allowed`). Every value must fit the field: whole number for integer, number for real, `true`/`false` for boolean, a date or datetime string, one of the options for select (`invalid_value`). Not in v1: OR groups (`query.js` has `$or`), free-text search inside a source (the SearchBox part adds it at run time), joins.

## Nav and theme

`nav`: `{ pageId, label, icon? }`, each `pageId` an existing page without `/:id`, each page at most once. The runtime renders these as the built app's menu bar when the spec has a `menu` block, with the app entry (Assistant and Settings) at its end; without a bar the entry sits in the bottom right corner. A built app shows nothing else around the design.

`theme` (details in [THEMES.md](THEMES.md)):

| Key | Values | Notes |
| --- | --- | --- |
| `preset` | `aurora`, `ocean`, `sunset`, `forest`, `graphite`, `solid` | The legacy background glow (the kit's presets). Default `aurora`. Used only while there is no `id`. |
| `radius` | `none`, `sm`, `md`, `lg` | The legacy corner size. Default `md`. Used only while there is no `id`. |
| `id` | `slate`, `paper`, `midnight`, `forest`, `sand`, `ocean`, `rose`, `mono` | Optional. Picks a built-in theme. Without it the app keeps the standard kit look ("Classic"), so every spec written before themes renders as before. |
| `overrides` | `{ accentHue?, radius?, mode? }` | Optional, and only with an `id` (`custom`: "Pick a theme before changing its accent, corners or light and dark."). `accentHue` is a whole number 0 to 359, `radius` is `none`, `sm`, `md` or `lg`, `mode` is `light` or `dark` (the mode a fresh install starts in). |

Anything else in the block is `unrecognized_keys`; an unknown `id` or `mode` is `invalid_value`; an `accentHue` outside 0 to 359 is `too_small` or `too_big`, and a fraction or text is `invalid_type`. When Studio sets an `id` it also writes `preset` and `radius` from the theme and clears `overrides`. A built app sanitizes the block again at startup (`packages/runtime/src/theme/sanitize.ts`). The example above keeps the legacy block: `{ "preset": "aurora", "radius": "md" }` is still valid and means Classic.

## Layer sizing

`sizing` (optional, on a layer, beside `props`): `{ width?, grow? }`, where the layer sits in a row of its parent. `width` is one of `full`, `three-quarters`, `two-thirds`, `half`, `third`, `quarter`, `fit` (only the space the part needs); default `full`. `grow` is a boolean, default `false`: the part also takes any room left in its row (ignored at `full`). The block is strict (`unrecognized_keys`, no pixels, no free numbers, no class or style); a block that is not an object or an unknown width is refused by zod at `pages.N.layout...sizing`. Absent means the whole row, exactly as before; the block has no top-level default, so a layer without it parses and normalizes with no `sizing` key, and an explicit `{ "width": "full", "grow": false }` is kept as written. Normalizing fills `width` and `grow` only inside a present block. Defaults and the tolerant reader are in `packages/runtime/src/spec/sizing.ts`.

- Rows form only in parents that stack their children: Page, Section, Card, Collapsible, Column and Tab. A run of consecutive children whose width is not `full` renders as one wrapping row (one column below the `md` breakpoint); every `full` child renders as before. The gap between items comes from the theme's spacing, and the widths subtract their share of it, so widths that add up to one row fill one line (CATALOG.md, "Rows of parts").
- A `sizing` block on a Page, Tab or Column layer is refused as `sizing_not_allowed`: their width is set by the part they are in. Under Grid, Row, PageHeader, Tabs and Columns a block is kept and ignored.
- Compile and migration planning ignore layouts, so `sizing` never plans a migration step.
- Compatibility: `sizing` is an additive optional key, so `specVersion` stays `1`. A phase 8 build of Local App Studio refuses a spec that carries `sizing` (its layer schema is strict); open such a spec with a phase 9 build or later.

## Free placement on a grid

A Grid part can place its children freely on 12 columns instead of flowing them (phase 21, ADR-012). The shape is additive and optional; an old spec reads unchanged.

**Grid props** (stored layers; the helper is offered only `columns` and `gap`):

| Prop | Values | Default | Notes |
| --- | --- | --- | --- |
| `columns` | `1`, `2`, `3`, `4`, `12` | `2` | `12` only with `placement: "free"`; a free Grid must have `12` |
| `gap` | `sm`, `md`, `lg` | `md` | applies to both modes |
| `placement` | `flow`, `free` | `flow` | absent means flow |
| `rows` | whole number 1 to 60 | absent | only with `placement: "free"`; at least the last row any child covers. The editor keeps it equal to the largest row end of the children (1 with none); the renderer does not read it |

Switching back to flow deletes `placement` and `rows` (absent, not `"flow"`).

**The child block.** `grid` (optional, on a layer, beside `sizing`): `{ col, span, row, rowSpan }`, all four required, strict (`unrecognized_keys`).

| Key | Range | Rule |
| --- | --- | --- |
| `col` | 1 to 12 | first column |
| `span` | 1 to 12 | `col + span <= 13` |
| `row` | 1 to 60 | first row |
| `rowSpan` | 1 to 12 | `row + rowSpan <= 61`: the last row covered is at most 60 |

- Cells left empty are fine. Two children of a free Grid may not share a cell (touching edges are fine): the second is refused as `grid_overlap` at `...children.N.grid`. Range errors inside the block are zod's own (`too_small`, `too_big`, `custom`). A cross-prop rule of Grid is `invalid_props`: parts placed freely use 12 columns, 12 columns only work when placed freely, `rows` only works when placed freely, and `rows` must be at least the last row the parts reach.
- A `grid` block anywhere except on a child of a free Grid is refused as `grid_not_allowed` at `...grid` (a Page root and a menu slot layer count as not in a free Grid; a part checked alone, as Design does, is not refused for its block).
- A child of a free Grid without a block (a hand-written spec) is allowed. It renders as a full row the browser places, and the editor gives it a cell on its next edit.
- `sizing` on a child of a free Grid is kept and ignored; Design shows no Width there.
- From `md` up the Grid is 12 columns; below `md` the children stack in one column, in reading order (row, then column). Rows are sized by content, with a small minimum height from the theme spacing. Nothing is in pixels.
- The pure reader is `packages/runtime/src/spec/gridPlacement.ts` (`readGrid`, `cellsOf`, `overlaps`, `nextFreeCell`, `readingOrder`, ...), erasable TypeScript with no imports (ADR-006). The classes are in `packages/runtime/src/catalog/parts/gridClasses.ts` (CATALOG.md, "Parts placed freely").
- Compile and migration planning ignore layouts, so the block never plans a migration step. Export, Import and Duplicate carry it, because it is spec data.
- Compatibility: additive optional keys, so `specVersion` stays `1`. A phase 20 build refuses a spec that carries them (its schemas are strict); open such a spec with a phase 21 build or later. A page the helper regenerates is rewritten as a flow layout.

## Menu bar

`menu`: `{ position?, style?, start?, end? }` (the slots are below), optional and absent by default. `position` is `top` (a bar above every page) or `side` (a 14rem column on the left, stacked above the page on a narrow screen); default `top`. `style` is `labels` or `icons-and-labels`; default `icons-and-labels`. Both are strict enums and the block takes no other key (`unrecognized_keys`); a block that is not an object, or an unknown value, is refused. The items come from `nav`, so a page with `/:id` never shows. The runtime shell (`SpecApp`, shared by Preview and built apps) wraps the page in the bar only when the block exists; the kit drawer keeps its pages too. Without `menu`, validation, normalizing, compile and migration planning are byte-identical to before.

### Menu slots

`menu` also takes two optional slots, `start` and `end`: `{ position?, style?, start?, end? }`. Each is an array of layers like any container's children (at most 6 per slot), drawn in the bar. On a top bar `start` sits before the page links and `end` after them, pushed to the right; on the side rail `start` is above the links and `end` below them. Below `md` the bar stacks (start, links, end) and the rail is already a strip above the page.

- **Allow list** (`packages/runtime/src/spec/menuSlots.ts`, `MENU_PARTS`): Button, Link, SearchBox, QuickAdd, Text and Row. A Row holds Button, Link, SearchBox, QuickAdd and Text (`MENU_ROW_PARTS`, no Row in a Row). No data views, forms, Divider or saved features. Only a Row holds other parts, so the depth is a slot, a Row, its parts.
- **Limits** (`MENU_LIMITS`): 6 top layers per slot (zod, `too_big`) and 24 layers in the whole menu, Rows and their parts included.
- **Enforced by `validateAppSpec` itself**, with no catalog hook, so every caller refuses a bad slot. Codes: `menu_part_not_allowed` at `menu.start.0.type` (`The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.`, in a Row `A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.`, under any other part `Only a Row can hold other parts in the menu bar.`), `menu_too_large` at `menu` (`The menu bar may hold at most 24 parts.`), `duplicate_id` at `menu.end.0.id` (`Layer id "x" is used twice in the menu bar.`; ids are unique across both slots and live in their own namespace, so a menu layer may share an id with a page layer) and `forbidden_prop` (the same rule as page layouts). A slot that is not an array, a layer with no id and any other key under `menu` are refused by zod.
- **Catalog checks** (`checkMenu`, in `CATALOG_CHECKS`): the props, actions and pages of each slot layer are checked with the menu's own context: every table, page and field, no sources, not a record page. A menu Button or Link therefore cannot `delete-record`, open an `edit` form or use `withRecord: true`. A SearchBox in the menu takes only `placeholder` (`menuProps`): the runtime binds it to the first list source of the page that is open, searching its title field and then its other text fields (at most 4), and renders nothing on a page with no list source.
- **A Button that opens a form** is the usual Button: `{ "action": { "action": "open-form", "table": "crews", "mode": "create" } }`. Slot parts render inside the page's own data provider (a portal), so the form opens in the page's dialog host and a save refreshes the page's lists.
- **Normalizing** fills a present `sizing` block of a slot layer, like a page layer. Absent and empty slots stay as they are. Compile and migration planning never read `menu`.
- **Compatibility:** slots are additive optional keys, so `specVersion` stays `1`. A phase 9 build refuses a spec that carries them (its menu schema is strict); open such a spec with a phase 10 build or later.

Icon names (for `app.icon`, `nav[].icon` and parts): `home`, `list`, `table`, `users`, `user`, `box`, `calendar`, `chart`, `clipboard`, `file`, `folder`, `tag`, `star`, `briefcase`, `truck`, `wrench`, `settings`, `inbox`, `map`, `heart`. The runtime maps them to lucide-react glyphs.

## Automations

Two additive optional keys (phase 28, ADR-013). An old spec reads unchanged; the helper is not offered either key.

**Numbered automatically.** `autoNumber` on one text or integer field per table.

| Field type | Block | Value written |
| --- | --- | --- |
| `text` | `{ prefix?, start?, width? }`: `prefix` 0 to 20 characters, single line; `start` whole number 0 to 999999999999 (default 1); `width` 1 to 12 (default 1) | `prefix` then the number padded with zeros to `width`, like `INV-1001`; a longer number just grows |
| `integer` | `{ start? }` | the number |

- The block is strict (`unrecognized_keys`); on any other field type it is `unrecognized_keys`. A second numbered field in a table, or a numbered field with a `default`, is `auto_number_not_allowed` at `tables.N.fields.M.autoNumber`.
- The runtime assigns the next number when a record is added, inside the same transaction, from `app_state` key `autonumber.<table>.<field>`: the larger of `start`, the last number handed out plus one, and the highest stored value plus one. Numbers are never reused after a delete.
- A record sent with a value for the field is refused (`invalid_record`, "<Label> is numbered automatically."); an edit may resend the stored value but not change it. Forms show the field read-only.
- Imports keep the next number above the highest stored value. Restoring an older backup hands out again the numbers given after that backup.

**Rules on a status change.** `rules` on a table: at most 20, each `{ when: { field, is }, then: [{ set, to }] }` with 1 to 5 actions.

| Key | Rule |
| --- | --- |
| `when.field` | a `select` or `boolean` field of the table |
| `when.is` | one of the field's options (select) or `true` / `false` (boolean) |
| `then[].set` | a field of the table; not the numbered field, not `when.field` |
| `then[].to` | `"today"` (a date field), `"now"` (a datetime field), `"clear"` (an optional field), `{ "value": <literal> }` (fits the field like a default; not on a reference), or `{ "field": "<id>" }` (another field of the table of the same type, or text or longtext from text, longtext or select; a reference only from a reference to the same table) |

Example: `{ "when": { "field": "paid", "is": true }, "then": [ { "set": "paid_on", "to": "today" } ] }`.

- A rule fires on add when the new record's `when.field` (or its default) equals `is`, and on edit when the edit changes `when.field` to `is`. One pass in array order: no rule sees another rule's change, so nothing chains or loops. Rules never change another record.
- A rule never overwrites a value the person changed in the same save (on an edit, a value counts as changed only when it differs from the stored one; on add, only when it is not empty). A later action on the same field replaces an earlier one.
- `today` is the server's local calendar date; `now` is the current time in the datetime encoding.
- A rule's writes pass the same validation and reference checks as the person's; a rule that would break the record refuses the save with that field named. A save that applied rules answers `applied: [{ field, label, to, words }]` beside `data`, for example `"Paid on was set to today."`.
- CSV import runs rules only when the person ticks Apply automations; the ZIP importer restores rows as stored and never runs rules.
- Codes: `rule_field_missing` (a named field is not in the table) at `tables.N.rules.R.when.field`, `...then.A.set` or `...then.A.to.field`; `rule_not_allowed` (any other refusal above, or the same `when` setting the same field twice) at the offending key.
- Compile and migration planning ignore both keys, so they never plan a migration step. Export, Import and Duplicate carry them, because they are spec data.
- Compatibility: additive optional keys, so `specVersion` stays `1`. A phase 27 build refuses a spec that carries them (its schemas are strict); open such a spec with a phase 28 build or later.

## Validation API

```ts
import { validateAppSpec, validateTables, formatIssues } from './schema.ts';

const result = validateAppSpec(input, { checkLayout }); // never throws
if (!result.ok) prompt += formatIssues(result.issues);  // "- pages.0.sources.0.where.0.field: Table "crews" has no field "state" ... [unknown_field]"
```

- `validateAppSpec(input, opts?)` returns `{ ok: true, value: AppSpec, issues: [] }` or `{ ok: false, value: null, issues: SpecIssue[] }`. Order: size check, zod (`AppSpecSchema.safeParse`), then referential checks only if zod passed, then `opts.checkLayout` per page. At most `opts.maxIssues` (default 20) issues.
- `validateTables(input)` checks the plan step's `{ "tables": [...] }` block alone (zod plus the table checks).
- `SpecIssue = { path, code, message }`. `path` is dotted from the spec root (`tables.0.fields.2.default`, `(root)` for the whole document). `message` is one plain sentence that names the fix and, where useful, the allowed values, so it can be fed straight back to a small model.
- Codes: zod's own (`invalid_type`, `invalid_value`, `invalid_format`, `invalid_union`, `too_small`, `too_big`, `unrecognized_keys`, `custom`) plus `duplicate_id`, `duplicate_route`, `duplicate_option`, `duplicate_condition`, `reserved_word`, `reserved_name`, `reserved_identifier`, `unknown_table`, `unknown_field`, `unknown_page`, `reference_cycle`, `invalid_default`, `op_not_allowed`, `route_param`, `record_source`, `missing_home`, `layout_root`, `layout_too_large`, `layout_too_deep`, `forbidden_prop`, `menu_part_not_allowed`, `menu_too_large`, `auto_number_not_allowed`, `rule_field_missing`, `rule_not_allowed`, and the catalog hook's codes (CATALOG.md; they include `grid_not_allowed` and `grid_overlap`).
- Exports for the pipeline: `AppSpecSchema`, `TablesBlockSchema`, `TableSchema`, `FieldSchema`, `PageSchema`, `SourceSchema`, `LayoutLayerSchema`, the constants (`ID_RE`, `LIMITS`, `FIELD_TYPES`, `WHERE_OPS`, `ICONS`, `THEME_PRESETS`, `RADII`) and the inferred types (`AppSpec`, `AppSpecInput`, `Table`, `Field`, `Page`, `Source`, `WhereCondition`, `LayoutLayer`, ...). `AppSpec` is the parsed output (defaults filled); `AppSpecInput` is what a file or a model may contain.

For the model, JSON Schema comes from `z.toJSONSchema(TablesBlockSchema, { io: 'input' })` with descriptions and defaults stripped (CATALOG.md, "Compact JSON Schema"); `.describe()` texts are kept short for that reason.

## Versioning

- `specVersion` is an integer literal. v1 accepts only `1`.
- A change is **compatible** (stays v1) when every valid v1 spec stays valid and means the same: a new optional key with a default, a new field type, a new icon, a new part, a raised limit. A compatible change still needs the parent's approval because both phase branches depend on the schema.
- Anything else (a removed or renamed key, a new required key, a stricter rule, a changed meaning) is **v2**: `packages/runtime/src/spec/schema.ts` keeps the v1 schema as `AppSpecV1Schema`, adds `AppSpecV2Schema`, and adds `upgradeSpec(input: unknown): unknown` (a pure, deterministic, chained `v1 to v2 to ...` function). `validateAppSpec` upgrades first, then validates against the latest version. Upgrades never touch the database: a built app's migrations come from comparing old and new specs (ADR-004).
- Studio stores the `specVersion` it last saved; it upgrades drafts on open and shows the result as a diff before saving. A built app is never upgraded in place; a rebuild bakes the latest version.
