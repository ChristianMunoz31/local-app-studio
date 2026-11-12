# Features

A **feature** is a small reusable piece of a page. Design can insert it, and the local model can use it when it builds a page. Decision record: [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-007. Parts it is built from: [CATALOG.md](CATALOG.md). Spec format: [APP_SPEC.md](APP_SPEC.md).

## Two kinds

- **Built-in features** are the catalog parts in code: every part in CATALOG.md (the table below shows the plain names). They are listed on the Features page with a plain name, a one-line description and a live preview, and they cannot be edited there (see "The Features page" below). Developers add one by following "Adding a part" in CATALOG.md.
- **Custom features** are made by the user: select a part in Design and choose **Save as feature**, or press **New feature** on the Features page to compose one in the Feature builder (see "The Feature builder" below). A custom feature has a name, a one-sentence description written for the model, a few **parameters** (the values a page fills in) and the group of parts it stands for. Custom features live in Local App Studio, not in one app, so every app can use them. They are exported and imported like other Studio data and are never behind Pro.

## The Features page

One page shows every building block the same way: a built-in part and a feature you saved are both a **tile** with a live preview, a plain name, one line of description, a category chip and, for your own features, the settings they ask for and how many apps use them. Only the category chip and the menu differ.

| Category | Sub-group | Built-in parts (plain name shown) |
| --- | --- | --- |
| Layout | Structure | Section, Card, Columns, Row, Auto grid (Grid), Tabs, Show and hide section (Collapsible), Divider line |
| Layout | Text | Heading, Text, Callout |
| Navigation | none | Page links (NavLinks), Breadcrumb, Back link (BackLink), Page header (PageHeader) |
| Data | Show | Table of records (DataTable), List of records (RecordList), Record details (RecordDetail), Timeline, Checklist |
| Data | Summarize | Number tile (StatCard), Progress bar (ProgressBar) |
| Data | Charts | Chart |
| Input | none | Search box, Filters (FilterBar), Sort choice (SortControl), Form (RecordForm), Quick add (QuickAdd), Linked record picker (ReferencePicker) |
| Actions | none | Button, Link |
| Custom | none | every feature you saved |

The new parts, one line each:

- **Columns**: two to four columns side by side; you choose what goes in each.
- **Row**: small parts in one line, like a search box next to a button.
- **Page links**: links to the pages of your app, in a row or a list.
- **Breadcrumb**: shows where you are and links back to the list.
- **Back link**: one link back to another page.
- **Page header**: a page title with up to three buttons beside it.
- **Chart**: bars or a line that count or add up records by group.
- **Progress bar**: how close a number is to a goal.
- **Timeline**: records in date order, grouped by day.
- **Checklist**: records with a box to tick when done.
- **Callout**: a colored box with a note, a tip or a warning.
- **Show and hide section**: a titled block that opens and closes.
- **Sort choice**: lets people choose how a list is sorted.
- **Quick add**: one box and an Add button that adds a record.

Grid is now called **Auto grid**. An Export button is deferred: the export route returns one ZIP, so a single-file download part needs a route change first.

### Search, counts and order

- **Search words.** Type any words; a tile shows only when every word matches the start of its name, of a word in its name, or of a word in one of these, in this order of weight: the name, other words people use for it (for example "spreadsheet" finds Table of records, "sidebar" finds Columns), the category and sub-group names, the settings a custom feature asks for, then the description. Better matches come first. The part of the name that matched is highlighted.
- **Counts.** Each category chip and heading shows how many tiles match (`Data (9)`), and so do the sub-group headings (`Show (5)`). The chips count the current search whatever category is chosen.
- **Recently used.** With no search and category All, a row at the top lists the last 8 parts and features you placed in Design (kept in this browser). A feature you deleted is skipped.
- **Order.** Default order, A to Z, or Recently added (your own features, newest first; built-in parts keep their place).
- **Used in.** A saved feature's tile says `Used in 2 apps` or `Not used in an app yet`.
- **Address and keys.** The search, category and order are kept in the address (`?q=&cat=&sort=`), so Back from Use in app returns to the same view; a bad value falls back to the default. Press `/` (outside a text field) to jump to the search box and Escape to clear it.
- **In Design.** The shelf uses the same search, the same groups and counts, a Recently used row on top and a Navigation chip. It keeps no address state. Escape clears a typed search first.

The search, ranking and grouping are one pure module, `src/studio/showcase/search.ts`, shared by the page and the shelf.

Page, Tab and Column are never shown. The map lives in `src/studio/showcase/entries.ts` (Studio only, so the catalog and the sidecar stay untouched); a test checks that every part has exactly one category, a plain name and a short plain description.

- **Previews** run the runtime's own renderer over sample rows (`samples.ts`): the same rows every time, reference fields pointing at a row of the table they name, and a record chosen for the parts that show one. A preview is drawn at a fixed width for its category and shrunk to fit its box (`ScaleToFit`), so a wide table and a small number tile both show whole, without scrollbars. A preview mounts only when its tile is within 200 px of the viewport, so a long list stays light.
- **Details** open from the tile (or the menu) as a sheet on the right with a large preview, the settings the feature asks for, its version and how many apps use it. It keeps the dialog behaviour: Tab stays inside, Escape closes, focus goes back to the tile.
- **Use in app** asks which app (only apps that open fine) and opens that app's Design step with the tile chosen, ready to add to a page. With no app, it says to make one first on the Apps page.
- The menu order is fixed: Details, Use in app, then Edit, Duplicate, Export, Delete for your own features. **Edit** opens the feature in the Feature builder at `/features/<id>/edit`.
- **Needs a table.** A tile shows a "Needs a table" chip when adding it could not connect it: on the Features page (no app) every tile that draws rows, and on the Design shelf (`entryNeedsTable` in `src/studio/design/indicator.ts`) a part with a data bind when the app has no table, or a feature with a table or list setting that has no fitting table on the open page. Adding such a feature in Design opens **New table for <feature name>** and places the feature connected to the table you make (`featureTableDraft` and `placeFeatureOnNewTable` in `src/studio/lib/featureOnDrop.ts`). In an app a feature block carries the same pill as a part: "Connected to <Table>" or "Needs a table".

## The Feature builder

**New feature** (`/features/new`) and **Edit** (`/features/<id>/edit`) open `FeatureBuilderPage.tsx`, a thin host over the Design canvas (`DesignSession` with its `host` prop), so there is one canvas. It works on a **bench**: a small in-memory app (`src/studio/builder/bench.ts`) with one table per table slot and sample rows (Crews, Tasks, Items). Nothing about the bench is saved; the saved record is the same feature format as one from Save as feature.

- **Slots map onto the parameter types above.** A table slot becomes a `source` parameter (labelled "<Label> list") for each list a part uses on it, and a `table` parameter for a part that takes the table itself (Quick add, Form). A field a part uses becomes a `field` parameter, a Button or Link page becomes a `page` parameter, and text becomes a `text` parameter only when ticked ("Let people change these words"). `src/studio/builder/slotModel.ts` builds the slots and the record (`featureInputOf` runs the Save as feature logic and `validateFeatureInput`), the Slots panel is `SlotPanel.tsx`.
- **Words.** "Slot" is shown only in the builder (the glossary in [DESIGN.md](DESIGN.md)). Every builder string is in `src/studio/builder/words.ts`.
- **Save.** `BuilderSaveDialog.tsx` asks for a name (40 characters) and one line (160), runs the local checks, then `featuresApi.create` or, for an existing feature, `update` (a new version). A refusal is one of eight client-only codes (`feature_name_needed`, `feature_line_needed`, `feature_is_empty`, `feature_needs_slots`, `feature_too_many_settings`, `feature_too_big`, `feature_holds_itself`, `feature_check_failed`), chosen by `builderRefusal` in `featureRefusal.ts`, with the sentences in "Error codes" in DESIGN.md. The Features page shows the same plain sentences for a damaged import.
- **Try it in an app** saves first when needed, then opens Use in app.
- **What it cannot do:** parts that show one record, the menu bar and look, list filters and sort order, a feature saved with a one-record setting (it opens as damaged), and more than the limits below. A table slot and a list setting merge into one bench table only when their labels match, so a feature with a Table of records and a Quick add on one table can save three settings. In an app the table and its list are one choice (see "The settings in an app").


## Parameters

A parameter is a value the page supplies when the feature is placed. There are five types:

| Type | The page fills in | Example |
| --- | --- | --- |
| `text` | A short text: a title, a label, a button caption | "Open jobs" |
| `table` | One of the app's tables | `crews` |
| `source` | One of the page's data sources, list or record (fixed per parameter) | `open_crews` |
| `page` | One of the app's pages (for buttons, links and row clicks) | `crew` |
| `field` | A field of the table behind another `table` or `source` parameter, optionally only some field types | `size` |

When you save a selection as a feature, every table, source, page and field it points to becomes a parameter automatically (otherwise the feature would only work in the app it came from). Texts become parameters only when you tick them. Column lists and field lists that depend on a parameter are reset to the part's default (the first fields of the table), because the table can change.

## What happens when a feature is placed

The page never keeps a reference that could break later. When a feature is placed (by Design, by the model, or in an imported app), Local App Studio **expands** it: it copies the feature's parts into the page, puts the page's values into the parameter slots, and checks the result like any other part of the page. The copied group remembers which feature and which version it came from, so Design shows it as one block named after the feature.

- **Update to latest**: when the feature changed in your library after it was placed, the block offers "Update to latest". Your apps never change on their own. The update drops settings the new version no longer has, keeps the values that still fit and fills a new setting from the feature's own words or the defaults below (`latestValues` in `src/studio/lib/featureFromSelection.ts`), places the new version and says "Updated <label> to the latest version." A refusal that remains is a plain sentence ("Fill in <label>."), never an id (`issueWords.ts`). The settings form opens with those same values while the block is behind.
- **Newer version**: a block whose saved version is older than the library's (`isBehind` in `src/studio/design/indicator.ts`) shows an amber "Newer version" pill beside its connection pill (`NewerVersionPill`, a button that opens the settings), and the Design page strip counts them: "1 feature on this page has a newer version." (`behindCount`, `newerVersionLine`). The count follows the unsaved page.
- **Change values**: re-places the block with new parameter values (and the latest version).
- **Detach**: forgets the link; the parts stay as plain parts.

A built app does not know about features at all. It only sees the plain parts.

### The settings in an app

`src/studio/lib/featureParams.ts` (pure, imports the catalog only) decides what the settings mean to the person filling them in; `FeatureValuesForm.tsx` draws them.

- **One choice per slot.** `pairedParams` pairs a list setting "X list" with the table setting "X" (the labels the builder gives one slot), or the only table setting with the only list setting; the format has no link between them yet (OQ-16-9), so the labels are the rule. `shownParams` hides the paired list, so the form shows one table choice, labelled like the slot ("Things to track"). Choosing a table sets the list to a list of that table on the page, and when the page has none the choice says "This page gets a list of <Table>." and the list is made with the block. The builder's count of settings counts these rows.
- **Names, not ids.** The form takes the app's words (tables, fields, pages, lists, Created and Updated), so a choice reads "Open tasks", never `open_tasks`.
- **Defaults by field kind.** `pickField`: for a field setting, the field named like the setting, then a choice, a yes or no, a date, a link, then the rest in table order; Created and Updated only when nothing else fits. Before this a setting took the first allowed field, often a link.
- **Words from the canvas.** `textDefault`: a text setting that was ticked ("Let people change these words") starts with the words in the feature's own parts, the ones on the builder canvas, else the setting's label; "Shown as" only names the setting.
- **Words follow the table.** `featureWords.ts` (`withOwnWords`): the builder writes "<bench table> by <group>", "Add to <bench table>" and "Count of <bench table>" into the feature; when the block is placed or updated, a text that still equals that default is rewritten for the chosen table and field. A text someone wrote in the builder stays. The same rule for parts is `followWords.ts`.

## Rules the checks enforce

- Feature names (ids) follow the same rules as table ids: lowercase letters, digits and `_`, starting with a letter, at most 31 characters, not a reserved word.
- A feature can use other features, at most 3 levels deep, and never itself (directly or through others).
- At most 6 parameters, 24 bindings, 60 parts and 8 levels per feature; at most 100 custom features.
- A parameter only fills a slot of the matching kind. A feature cannot carry class names, styles, scripts or event handlers, and a parameter value is always plain text or an id from the app.
- A feature that an app or another feature uses cannot be deleted. Local App Studio lists where it is used; detach it there first.

## For the model

When the helper builds a page from your prompt, the model sees up to 6 of your custom features (the ones that fit the page and changed most recently), each with the first 100 characters of its description and its parameters. It may place one as `{"type": "Feature", "props": {"featureId": "kpi_row", "params": {"source": "open_crews", "amount": "size", "title": "Crew size"}}}`. The result is expanded and checked before you see it, and the review on Prompt names the features used.

## Where the code lives

| Path | What |
| --- | --- |
| `src/catalog/features/` | Pure library: types, limits, slots, expansion, checks, sample spec, model text (Studio only; a runtime build refuses it) |
| `server/studio/features/` | Storage in `studio_features`, routes under `/api/studio/features`, usage scan |
| `server/modules/studio.tools.js` | The Studio Assistant's `list_features` read tool |
| `src/studio/pages/FeaturesPage.tsx` | The Features page (Studio menu) |
| `src/studio/showcase/` | The showcase: entries and categories (`entries.ts`), preview models (`samples.ts`), tile, preview frame, scale to fit, filters, details sheet, Use in app |
| `src/studio/components/Feature*.tsx` | Design palette, Save as feature, block bar (until the Design canvas replaces them) |
| `src/studio/pages/FeatureBuilderPage.tsx`, `src/studio/builder/` | The Feature builder: bench, slot model, Slots panel, table slot dialog, save dialog, refusal codes, words |
| `src/studio/lib/featureOnDrop.ts` | Adding a feature that needs a table on a page where none fits (the table is made first) |
| `src/studio/lib/featureParams.ts`, `featureWords.ts` | What the settings mean in an app: paired table and list choice, default field by kind, words from the canvas, words that follow the table |
