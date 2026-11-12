// Part name to React component, with no zod anywhere below it: this is what the runtime renderer imports, so the
// runtime chunk carries the components and not the definitions (docs/CATALOG.md). UI only. Keep the key order equal
// to PART_DEFINITIONS (a test checks it).
import type { ComponentType } from 'react';
import type { PartComponentProps } from './types.ts';
import { BackLink } from '@local-app-studio/runtime/catalog/parts/BackLink.tsx';
import { Breadcrumb } from '@local-app-studio/runtime/catalog/parts/Breadcrumb.tsx';
import { Button } from '@local-app-studio/runtime/catalog/parts/Button.tsx';
import { Callout } from '@local-app-studio/runtime/catalog/parts/Callout.tsx';
import { Card } from '@local-app-studio/runtime/catalog/parts/Card.tsx';
import { Chart } from '@local-app-studio/runtime/catalog/parts/Chart.tsx';
import { Checklist } from '@local-app-studio/runtime/catalog/parts/Checklist.tsx';
import { Collapsible } from '@local-app-studio/runtime/catalog/parts/Collapsible.tsx';
import { Column } from '@local-app-studio/runtime/catalog/parts/Column.tsx';
import { Columns } from '@local-app-studio/runtime/catalog/parts/Columns.tsx';
import { DataTable } from '@local-app-studio/runtime/catalog/parts/DataTable.tsx';
import { Divider } from '@local-app-studio/runtime/catalog/parts/Divider.tsx';
import type { EditorProps } from '@local-app-studio/runtime/catalog/parts/editorProps.ts';
import { FilterBar } from '@local-app-studio/runtime/catalog/parts/FilterBar.tsx';
import { Grid } from '@local-app-studio/runtime/catalog/parts/Grid.tsx';
import { Heading } from '@local-app-studio/runtime/catalog/parts/Heading.tsx';
import { Link } from '@local-app-studio/runtime/catalog/parts/Link.tsx';
import { NavLinks } from '@local-app-studio/runtime/catalog/parts/NavLinks.tsx';
import { Page } from '@local-app-studio/runtime/catalog/parts/Page.tsx';
import { PageHeader } from '@local-app-studio/runtime/catalog/parts/PageHeader.tsx';
import { ProgressBar } from '@local-app-studio/runtime/catalog/parts/ProgressBar.tsx';
import { QuickAdd } from '@local-app-studio/runtime/catalog/parts/QuickAdd.tsx';
import { RecordDetail } from '@local-app-studio/runtime/catalog/parts/RecordDetail.tsx';
import { RecordForm } from '@local-app-studio/runtime/catalog/parts/RecordForm.tsx';
import { RecordList } from '@local-app-studio/runtime/catalog/parts/RecordList.tsx';
import { ReferencePicker } from '@local-app-studio/runtime/catalog/parts/ReferencePicker.tsx';
import { Row } from '@local-app-studio/runtime/catalog/parts/Row.tsx';
import { SearchBox } from '@local-app-studio/runtime/catalog/parts/SearchBox.tsx';
import { Section } from '@local-app-studio/runtime/catalog/parts/Section.tsx';
import { SortControl } from '@local-app-studio/runtime/catalog/parts/SortControl.tsx';
import { StatCard } from '@local-app-studio/runtime/catalog/parts/StatCard.tsx';
import { Tab, Tabs } from '@local-app-studio/runtime/catalog/parts/Tabs.tsx';
import { Text } from '@local-app-studio/runtime/catalog/parts/Text.tsx';
import { Timeline } from '@local-app-studio/runtime/catalog/parts/Timeline.tsx';

// Each component declares its own typed props; a layer carries them as plain JSON, so the map erases the types.
const part = <P extends EditorProps>(component: ComponentType<P>): ComponentType<PartComponentProps> =>
  component as unknown as ComponentType<PartComponentProps>;

export const PART_COMPONENTS: Readonly<Record<string, ComponentType<PartComponentProps>>> = {
  Page: part(Page),
  Section: part(Section),
  Grid: part(Grid),
  Card: part(Card),
  Tabs: part(Tabs),
  Tab: part(Tab),
  Heading: part(Heading),
  Text: part(Text),
  Divider: part(Divider),
  DataTable: part(DataTable),
  RecordForm: part(RecordForm),
  RecordDetail: part(RecordDetail),
  StatCard: part(StatCard),
  RecordList: part(RecordList),
  FilterBar: part(FilterBar),
  SearchBox: part(SearchBox),
  ReferencePicker: part(ReferencePicker),
  Button: part(Button),
  Link: part(Link),
  Columns: part(Columns),
  Column: part(Column),
  Row: part(Row),
  NavLinks: part(NavLinks),
  Breadcrumb: part(Breadcrumb),
  BackLink: part(BackLink),
  PageHeader: part(PageHeader),
  Callout: part(Callout),
  Collapsible: part(Collapsible),
  Chart: part(Chart),
  ProgressBar: part(ProgressBar),
  Timeline: part(Timeline),
  Checklist: part(Checklist),
  SortControl: part(SortControl),
  QuickAdd: part(QuickAdd),
};
