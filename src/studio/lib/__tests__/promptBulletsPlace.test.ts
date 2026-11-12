import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { CHANGES_SHOWN, NOTHING_MOVED, PLACES_SHOWN, changeBullets, placeBullets, promptBullets } from '../promptBullets';
import { diffSpecs } from '../specDiff';
import { block, gridSpec, three, tile } from './placeFixtures';

const lines = (before: AppSpec, after: AppSpec): string[] => placeBullets(before, after, diffSpecs(before, after));

describe('placeBullets', () => {
  it('says each place change in the past tense, no full stop', () => {
    const before = gridSpec(three());
    const after = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 3)), tile('statcard_2', 'StatCard', block(5, 4, 1)), tile('chart_1', 'Chart', block(1, 6, 2, 3)), tile('statcard_3', 'StatCard', block(10, 3, 1))]);
    expect(lines(before, after)).toEqual([
      'Made Chart 6 columns wide',
      'Moved Number tile to row 3',
      'Placed Number tile at column 10, row 1, 3 columns wide',
    ]);
  });

  it('turns a grid on or off, and counts the parts of a new page', () => {
    const flow = gridSpec(three(), { free: false });
    expect(lines(flow, gridSpec(three()))).toEqual(['Turned on Place parts freely for Auto grid on Home']);
    expect(lines(gridSpec(three()), flow)).toEqual(['Turned off Place parts freely for Auto grid on Home']);
    const after = gridSpec(three());
    after.pages.push({ ...structuredClone(after.pages[0]), id: 'board', title: 'Board', route: '/board' });
    expect(lines(gridSpec([]), after).filter((l) => l.includes('Board'))).toEqual(['Placed 3 parts in a grid on Board']);
  });

  it('shows the first four, then how many more', () => {
    const base = Array.from({ length: 7 }, (_, i) => tile(`text_${i}`, 'Text', block(1, 2, i + 1), `T${i}`));
    const moved = Array.from({ length: 7 }, (_, i) => tile(`text_${i}`, 'Text', block(3, 2, i + 1), `T${i}`));
    const out = lines(gridSpec(base), gridSpec(moved));
    expect(PLACES_SHOWN).toBe(4);
    expect(out).toHaveLength(PLACES_SHOWN + 1);
    expect(out[PLACES_SHOWN]).toBe('and 3 more parts moved or placed');
    const one = Array.from({ length: 5 }, (_, i) => tile(`text_${i}`, 'Text', block(3, 2, i + 1), `T${i}`));
    expect(lines(gridSpec(base.slice(0, 5)), gridSpec(one)).at(-1)).toBe('and 1 more part moved or placed');
  });

  it('counts parts, not lines: the P7 line stands for all the parts it holds', () => {
    const base = Array.from({ length: 9 }, (_, i) => tile(`text_${i}`, 'Text', block(1, 2, i + 1), `T${i}`));
    const moved = Array.from({ length: 9 }, (_, i) => tile(`text_${i}`, 'Text', block(3, 2, i + 1), `T${i}`));
    expect(lines(gridSpec(base), gridSpec(moved)).at(-1)).toBe('and 5 more parts moved or placed');
  });

  it('counts the parts of a grouped line too', () => {
    const base = [
      ...Array.from({ length: 4 }, (_, i) => tile(`text_${i}`, 'Text', block(1, 2, i + 1), `T${i}`)),
      tile('s_1', 'StatCard', block(1, 4, 6)),
      tile('s_2', 'StatCard', block(5, 4, 6)),
      tile('s_3', 'StatCard', block(9, 4, 6)),
    ];
    const moved = [
      ...Array.from({ length: 4 }, (_, i) => tile(`text_${i}`, 'Text', block(3, 2, i + 1), `T${i}`)),
      tile('s_1', 'StatCard', block(1, 4, 5)),
      tile('s_2', 'StatCard', block(5, 4, 5)),
      tile('s_3', 'StatCard', block(9, 4, 5)),
    ];
    expect(lines(gridSpec(base), gridSpec(moved)).at(-1)).toBe('and 3 more parts moved or placed');
  });

  it('says nothing moved when the layout changed around a free grid and no part moved', () => {
    const before = gridSpec(three());
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 3, 1))]);
    expect(lines(before, after)).toEqual(['Placed Number tile at column 9, row 1, 3 columns wide', NOTHING_MOVED]);
    expect(NOTHING_MOVED).toBe('Nothing moved on the grid');
  });

  it('does not say nothing moved when something moved, nor when the layout did not change', () => {
    const before = gridSpec(three());
    const moved = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 3)), ...three().slice(1), tile('statcard_3', 'StatCard', block(9, 3, 1))]);
    expect(lines(before, moved)).not.toContain(NOTHING_MOVED);
    expect(lines(before, gridSpec(three()))).toEqual([]);
  });

  it('does not say nothing moved for a grid that is flow on either side, or a page that is new', () => {
    const flow = gridSpec(three(), { free: false });
    const flowMore = gridSpec([...three(), tile('statcard_3', 'StatCard')], { free: false });
    expect(lines(flow, flowMore)).toEqual([]);
    expect(lines(flow, gridSpec(three()))).not.toContain(NOTHING_MOVED);
    const added = gridSpec(three());
    added.pages.push({ ...structuredClone(added.pages[0]), id: 'board', title: 'Board', route: '/board' });
    expect(lines(gridSpec(three()), added)).toEqual(['Placed 3 parts in a grid on Board']);
  });

  it('is at most six lines', () => {
    const base = Array.from({ length: 9 }, (_, i) => tile(`text_${i}`, 'Text', block(1, 2, i + 1), `T${i}`));
    const moved = Array.from({ length: 9 }, (_, i) => tile(`text_${i}`, 'Text', block(3, 2, i + 1), `T${i}`));
    expect(lines(gridSpec(base), gridSpec(moved)).length).toBeLessThanOrEqual(6);
  });
});

describe('the other bullets skip place changes', () => {
  const before = gridSpec(three());
  const after = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 3)), ...three().slice(1)]);
  after.app.name = 'Orders';
  const changes = diffSpecs(before, after);

  it('changeBullets leaves them out and does not count them as more', () => {
    const out = changeBullets(after, changes);
    expect(out.shown.some((s) => s.includes('Moved'))).toBe(false);
    expect(out.shown.some((s) => s.startsWith('Renamed the app'))).toBe(true);
    expect(out.more).toBe(0);
  });

  it('promptBullets.changes leaves them out too', () => {
    const b = promptBullets({ spec: after, before, changes, needs: [] });
    expect(b.changes.some((s) => s.includes('Moved'))).toBe(false);
    expect(b.moreChanges).toBe(0);
    expect(CHANGES_SHOWN).toBeGreaterThan(b.changes.length);
  });
});
