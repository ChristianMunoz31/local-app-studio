import { describe, expect, it } from 'vitest';
import { layer } from '@/catalog/__tests__/fixtures';
import { COLUMNS_KEY, KEEP_ROW_ACTION, MAX_COLUMNS, ROW_ACTION_KEY, applySpecial, columnsValue, rowActionValue, specialKeysOf } from '../rowColumns';

describe('columns and row click settings (P-05, Columns)', () => {
  it('only a Table of records takes columns, and a List of records takes only a row click', () => {
    expect(specialKeysOf('DataTable')).toEqual([COLUMNS_KEY, ROW_ACTION_KEY]);
    expect(specialKeysOf('RecordList')).toEqual([ROW_ACTION_KEY]);
    expect(specialKeysOf('Heading')).toEqual([]);
  });

  it('writes the ticked fields as columns and removes the prop when none is ticked', () => {
    const l = layer('t', 'DataTable', { source: 's' });
    expect(applySpecial(l, COLUMNS_KEY, 'name,status,name')).toBeNull();
    expect(l.props.columns).toEqual(['name', 'status']);
    expect(columnsValue(l)).toBe('name,status');
    expect(applySpecial(l, COLUMNS_KEY, '')).toBeNull();
    expect(l.props.columns).toBeUndefined();
  });

  it('refuses more than the most columns in plain words and leaves the part as it was', () => {
    const l = layer('t', 'DataTable', { source: 's', columns: ['a'] });
    const many = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `f${i}`).join(',');
    expect(applySpecial(l, COLUMNS_KEY, many)).toBe(`Pick at most ${MAX_COLUMNS} columns.`);
    expect(l.props.columns).toEqual(['a']);
  });

  it('a row click opens a page with the record, none removes it, and an action set by hand is kept', () => {
    const l = layer('t', 'DataTable', { source: 's' });
    expect(rowActionValue(l)).toBe('');
    applySpecial(l, ROW_ACTION_KEY, 'crew');
    expect(l.props.rowAction).toEqual({ action: 'navigate', pageId: 'crew', withRecord: true });
    expect(rowActionValue(l)).toBe('crew');
    applySpecial(l, ROW_ACTION_KEY, KEEP_ROW_ACTION);
    expect(l.props.rowAction).toEqual({ action: 'navigate', pageId: 'crew', withRecord: true });
    applySpecial(l, ROW_ACTION_KEY, '');
    expect(l.props.rowAction).toBeUndefined();
    const hand = layer('t', 'DataTable', { source: 's', rowAction: { action: 'openUrl', url: 'https://example.com' } });
    expect(rowActionValue(hand)).toBe(KEEP_ROW_ACTION);
  });
});
