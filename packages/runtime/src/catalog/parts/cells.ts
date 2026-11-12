import type { Table } from '../../spec/schema.ts';
import { fieldInfo, useReferenceTitles } from '../../../../../src/catalog/context.tsx';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { formatValue } from './format.ts';

/**
 * Returns a function that turns one cell into text. Values are formatted by field type; a reference shows the
 * title of the record it points to (fetched once for all rows with an `id in (...)` filter).
 */
export function useCellText(table: Table | null, rows: DataRow[], fieldIds: string[]): (row: DataRow, fieldId: string) => string {
  const requests: Record<string, string[]> = {};
  for (const id of fieldIds) {
    const info = fieldInfo(table, id);
    if (info?.type !== 'reference' || !info.table) continue;
    const ids = rows.map((r) => r[id]).filter((v): v is string => typeof v === 'string');
    requests[info.table] = [...(requests[info.table] ?? []), ...ids];
  }
  const titles = useReferenceTitles(requests);
  return (row, fieldId) => {
    const info = fieldInfo(table, fieldId);
    if (!info) return '';
    const value = row[fieldId];
    if (info.type === 'reference') return typeof value === 'string' && info.table ? (titles[info.table]?.[value] ?? '') : '';
    return formatValue(info, value);
  };
}
