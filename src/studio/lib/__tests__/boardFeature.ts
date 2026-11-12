// The "Status board" of the maker's critique as a saved feature: one builder slot saved as a table setting and a list setting, a field it
// groups by, the field a Quick add writes to, and a words setting. Version 2 adds a words setting for the chart's title (a new setting).
import type { FeatureDefinition, FeatureLibrary, FeatureParam } from '@/catalog/features';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';

const layer = (id: string, type: string, props: LayoutLayer['props'], children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });

export const BOARD_PARAMS: FeatureParam[] = [
  { name: 'things', label: 'Things to track', type: 'table' },
  { name: 'things_list', label: 'Things to track list', type: 'source', mode: 'list' },
  { name: 'status', label: 'Status', type: 'field', of: 'things_list', fieldTypes: ['select', 'boolean', 'reference', 'date'] },
  { name: 'title_field', label: 'Name', type: 'field', of: 'things', fieldTypes: ['text'] },
  { name: 'board_title', label: 'Board title', type: 'text' },
];

/** The board as saved. `chartWords` adds the setting of version 2. */
export function boardDef(version = 1, chartWords = false): FeatureDefinition {
  const params = chartWords ? [...BOARD_PARAMS, { name: 'chart_title', label: 'Chart title', type: 'text' as const }] : BOARD_PARAMS;
  return {
    id: 'status_board',
    label: 'Status board',
    description: 'A heading, a list, a chart and a quick add.',
    version,
    updatedAt: '2026-11-05T00:00:00.000Z',
    params,
    fragment: layer('sec', 'Section', {}, [
      layer('h', 'Heading', { size: 'lg' }, 'Status board'),
      layer('tbl', 'DataTable', { source: 'x', columns: ['name'] }),
      layer('ch', 'Chart', { source: 'x', groupBy: 'x', measure: 'count', title: 'Things to track by Status' }),
      layer('qa', 'QuickAdd', { table: 't', field: 'x', placeholder: 'Add to Things to track' }),
      layer('cnt', 'StatCard', { source: 'x', stat: 'count', label: 'Count of Things to track' }),
    ]),
    bindings: [
      { param: 'board_title', layer: 'h', target: 'children' },
      { param: 'things_list', layer: 'tbl', target: 'props.source' },
      { param: 'things_list', layer: 'ch', target: 'props.source' },
      { param: 'things_list', layer: 'cnt', target: 'props.source' },
      { param: 'status', layer: 'ch', target: 'props.groupBy' },
      { param: 'things', layer: 'qa', target: 'props.table' },
      { param: 'title_field', layer: 'qa', target: 'props.field' },
      ...(chartWords ? [{ param: 'chart_title', layer: 'ch', target: 'props.title' }] : []),
    ],
  };
}

export const boardLibrary = (...defs: FeatureDefinition[]): FeatureLibrary => new Map(defs.map((d) => [d.id, d]));
