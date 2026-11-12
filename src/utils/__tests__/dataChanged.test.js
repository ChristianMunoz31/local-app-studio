import { describe, expect, it, vi } from 'vitest';
import { DATA_CHANGED_EVENT, announceDataChanged, onDataChanged } from '../dataChanged';

describe('dataChanged', () => {
  it('delivers the table id to a subscriber until it unsubscribes', () => {
    const handler = vi.fn();
    const off = onDataChanged(handler);
    announceDataChanged('crews');
    expect(handler).toHaveBeenCalledWith('crews');
    off();
    announceDataChanged('crews');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty or non-string table and a malformed event', () => {
    const handler = vi.fn();
    const off = onDataChanged(handler);
    announceDataChanged('');
    announceDataChanged(undefined);
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { table: 5 } }));
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});
