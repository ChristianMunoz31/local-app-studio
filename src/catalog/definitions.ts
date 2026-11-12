// The catalog in catalog order (docs/CATALOG.md). Pure. Every part: the 19 of v1, then the 15 of phase 8.
import { backLinkDef } from '@local-app-studio/runtime/catalog/parts/BackLink.def.ts';
import { breadcrumbDef } from '@local-app-studio/runtime/catalog/parts/Breadcrumb.def.ts';
import { buttonDef } from '@local-app-studio/runtime/catalog/parts/Button.def.ts';
import { calloutDef } from '@local-app-studio/runtime/catalog/parts/Callout.def.ts';
import { cardDef } from '@local-app-studio/runtime/catalog/parts/Card.def.ts';
import { chartDef } from '@local-app-studio/runtime/catalog/parts/Chart.def.ts';
import { checklistDef } from '@local-app-studio/runtime/catalog/parts/Checklist.def.ts';
import { collapsibleDef } from '@local-app-studio/runtime/catalog/parts/Collapsible.def.ts';
import { columnDef } from '@local-app-studio/runtime/catalog/parts/Column.def.ts';
import { columnsDef } from '@local-app-studio/runtime/catalog/parts/Columns.def.ts';
import { dataTableDef } from '@local-app-studio/runtime/catalog/parts/DataTable.def.ts';
import { dividerDef } from '@local-app-studio/runtime/catalog/parts/Divider.def.ts';
import { filterBarDef } from '@local-app-studio/runtime/catalog/parts/FilterBar.def.ts';
import { gridDef } from '@local-app-studio/runtime/catalog/parts/Grid.def.ts';
import { headingDef } from '@local-app-studio/runtime/catalog/parts/Heading.def.ts';
import { linkDef } from '@local-app-studio/runtime/catalog/parts/Link.def.ts';
import { navLinksDef } from '@local-app-studio/runtime/catalog/parts/NavLinks.def.ts';
import { pageDef } from '@local-app-studio/runtime/catalog/parts/Page.def.ts';
import { pageHeaderDef } from '@local-app-studio/runtime/catalog/parts/PageHeader.def.ts';
import { progressBarDef } from '@local-app-studio/runtime/catalog/parts/ProgressBar.def.ts';
import { quickAddDef } from '@local-app-studio/runtime/catalog/parts/QuickAdd.def.ts';
import { recordDetailDef } from '@local-app-studio/runtime/catalog/parts/RecordDetail.def.ts';
import { recordFormDef } from '@local-app-studio/runtime/catalog/parts/RecordForm.def.ts';
import { recordListDef } from '@local-app-studio/runtime/catalog/parts/RecordList.def.ts';
import { referencePickerDef } from '@local-app-studio/runtime/catalog/parts/ReferencePicker.def.ts';
import { rowDef } from '@local-app-studio/runtime/catalog/parts/Row.def.ts';
import { searchBoxDef } from '@local-app-studio/runtime/catalog/parts/SearchBox.def.ts';
import { sectionDef } from '@local-app-studio/runtime/catalog/parts/Section.def.ts';
import { sortControlDef } from '@local-app-studio/runtime/catalog/parts/SortControl.def.ts';
import { statCardDef } from '@local-app-studio/runtime/catalog/parts/StatCard.def.ts';
import { tabDef } from '@local-app-studio/runtime/catalog/parts/Tab.def.ts';
import { tabsDef } from '@local-app-studio/runtime/catalog/parts/Tabs.def.ts';
import { textDef } from '@local-app-studio/runtime/catalog/parts/Text.def.ts';
import { timelineDef } from '@local-app-studio/runtime/catalog/parts/Timeline.def.ts';
import type { PartDefinition } from './types.ts';

export const PART_DEFINITIONS: readonly PartDefinition[] = [
  pageDef,
  sectionDef,
  gridDef,
  cardDef,
  tabsDef,
  tabDef,
  headingDef,
  textDef,
  dividerDef,
  dataTableDef,
  recordFormDef,
  recordDetailDef,
  statCardDef,
  recordListDef,
  filterBarDef,
  searchBoxDef,
  referencePickerDef,
  buttonDef,
  linkDef,
  columnsDef,
  columnDef,
  rowDef,
  navLinksDef,
  breadcrumbDef,
  backLinkDef,
  pageHeaderDef,
  calloutDef,
  collapsibleDef,
  chartDef,
  progressBarDef,
  timelineDef,
  checklistDef,
  sortControlDef,
  quickAddDef,
];

export const PART_NAMES: readonly string[] = PART_DEFINITIONS.map((d) => d.name);

const BY_NAME: ReadonlyMap<string, PartDefinition> = new Map(PART_DEFINITIONS.map((d) => [d.name, d]));

/** The definition of a part by its layer type, or undefined for a name that is not a catalog part. */
export const getPartDefinition = (name: string): PartDefinition | undefined => BY_NAME.get(name);
