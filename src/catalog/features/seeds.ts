// The two seed features (docs/FEATURES.md). Plain data; the Studio server writes them on first use and the tests prove
// they pass validateFeatureInput. Pure.
import type { FeatureDefinition } from './types.ts';

export const SEED_UPDATED_AT = '2026-11-02T00:00:00.000Z';

export const SEED_FEATURES: readonly FeatureDefinition[] = [
  {
    id: 'kpi_row',
    label: 'Number row',
    description: 'Three numbers over one list: how many records, and the total and average of one number field.',
    version: 1,
    updatedAt: SEED_UPDATED_AT,
    params: [
      { name: 'source', label: 'List', type: 'source', mode: 'list' },
      { name: 'amount', label: 'Number field', type: 'field', of: 'source', fieldTypes: ['integer', 'real'] },
      { name: 'title', label: 'Title', type: 'text' },
    ],
    fragment: {
      id: 'f1',
      type: 'Section',
      props: { title: 'Overview' },
      children: [
        { id: 'f2', type: 'StatCard', props: { source: 's', stat: 'count', label: 'Records' }, children: [] },
        { id: 'f3', type: 'StatCard', props: { source: 's', stat: 'sum', field: 'x', label: 'Total' }, children: [] },
        { id: 'f4', type: 'StatCard', props: { source: 's', stat: 'avg', field: 'x', label: 'Average' }, children: [] },
      ],
    },
    bindings: [
      { param: 'title', layer: 'f1', target: 'props.title' },
      { param: 'source', layer: 'f2', target: 'props.source' },
      { param: 'source', layer: 'f3', target: 'props.source' },
      { param: 'source', layer: 'f4', target: 'props.source' },
      { param: 'amount', layer: 'f3', target: 'props.field' },
      { param: 'amount', layer: 'f4', target: 'props.field' },
    ],
  },
  {
    id: 'search_list',
    label: 'Search list',
    description: 'A search box above a table of one list, so people can find a record by typing.',
    version: 1,
    updatedAt: SEED_UPDATED_AT,
    // SearchBox requires a non-empty fields list, so it cannot be left out; its one entry is bound to a text field param.
    params: [
      { name: 'source', label: 'List', type: 'source', mode: 'list' },
      { name: 'search', label: 'Field to search', type: 'field', of: 'source', fieldTypes: ['text', 'longtext'] },
    ],
    fragment: {
      id: 'f1',
      type: 'Section',
      props: {},
      children: [
        { id: 'f2', type: 'SearchBox', props: { source: 's', fields: ['x'] }, children: [] },
        { id: 'f3', type: 'DataTable', props: { source: 's' }, children: [] },
      ],
    },
    bindings: [
      { param: 'source', layer: 'f2', target: 'props.source' },
      { param: 'source', layer: 'f3', target: 'props.source' },
      { param: 'search', layer: 'f2', target: 'props.fields.0' },
    ],
  },
];
