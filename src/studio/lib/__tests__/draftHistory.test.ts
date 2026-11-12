import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, canRedo, canUndo, createHistory, present, push, redo, undo } from '../draftHistory';

describe('draftHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const h = createHistory('a');
    expect(present(h)).toBe('a');
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('undoes and redoes, and a new push drops the redo steps', () => {
    let h = push(push(createHistory('a'), 'b', { label: 'b' }), 'c', { label: 'c' });
    h = undo(h);
    expect(present(h)).toBe('b');
    expect(canRedo(h)).toBe(true);
    expect(present(redo(h))).toBe('c');
    h = push(h, 'd', { label: 'd' });
    expect(canRedo(h)).toBe(false);
    expect(present(undo(h))).toBe('b');
  });

  it('merges consecutive pushes with the same key into one step', () => {
    let h = push(createHistory('a'), 'b', { label: 'type', coalesceKey: 'k' });
    h = push(h, 'bc', { label: 'type', coalesceKey: 'k' });
    h = push(h, 'bcd', { label: 'type', coalesceKey: 'k' });
    expect(h.entries.length).toBe(2);
    expect(present(undo(h))).toBe('a');
  });

  it('does not merge different keys, no key, or a push right after an undo', () => {
    let h = push(createHistory('a'), 'b', { label: 'x', coalesceKey: 'one' });
    h = push(h, 'c', { label: 'x', coalesceKey: 'two' });
    expect(h.entries.length).toBe(3);
    h = push(h, 'd', { label: 'x' });
    h = push(h, 'e', { label: 'x' });
    expect(h.entries.length).toBe(5);
    let k = push(push(createHistory('a'), 'b', { label: 'x', coalesceKey: 'k' }), 'c', { label: 'x', coalesceKey: 'other' });
    k = undo(k);
    k = push(k, 'z', { label: 'x', coalesceKey: 'k' });
    expect(present(undo(k))).toBe('b');
  });

  it('keeps at most 50 entries and drops the oldest', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 80; i += 1) h = push(h, i, { label: String(i) });
    expect(h.entries.length).toBe(MAX_HISTORY);
    expect(present(h)).toBe(80);
    for (let i = 0; i < 100; i += 1) h = undo(h);
    expect(present(h)).toBe(31);
  });
});
