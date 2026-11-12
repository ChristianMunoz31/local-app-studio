import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { askOutcome, placeAsk } from '../askOutcome';
import type { AskOutcome } from '../askOutcome';
import { NOTHING_MOVED, placeBullets } from '../promptBullets';
import { diffSpecs, isPlaceChange } from '../specDiff';
import { block, gridSpec, three, tile } from './placeFixtures';

const judge = (ask: string, before: AppSpec, after: AppSpec): AskOutcome => askOutcome({ ask, changes: diffSpecs(before, after), before, after });
const bullets = (before: AppSpec, after: AppSpec): string[] => placeBullets(before, after, diffSpecs(before, after));
const wrapInColumn = (spec: AppSpec): AppSpec => {
  const out = structuredClone(spec);
  const root = out.pages[0].layout;
  const kids = root.children as LayoutLayer[];
  root.children = [kids[0], { id: 'column_1', type: 'Column', props: {}, children: [kids[1]] } as unknown as LayoutLayer];
  return out;
};

describe('the put rule: "put" and "place" move a part only with a position or size word', () => {
  it('"put X on it", "on the page", "on the Orders page" are ordinary adds, not place clauses', () => {
    for (const ask of ['Put a chart on it', 'Put a chart on the page', 'Put a chart on the Orders page', 'Place a chart on the Orders page', 'Put the chart on the Orders page']) {
      const a = placeAsk(ask);
      expect([a.toFlow, a.toFree, a.moves.length], ask).toEqual([false, false, 0]);
    }
  });

  it('a put clause that names no part stays outside layout; one that names a part is an add and lays out by the add rule', () => {
    expect(placeAsk('Put a note on the Orders page').layout).toBe(false);
    expect(placeAsk('Put a chart on the Orders page').layout).toBe(true);
    expect(placeAsk('Put a chart on the Orders page').moves).toEqual([]);
  });

  it('"Add a table and put a chart on it" has no move clause', () => {
    const a = placeAsk('Add a table and put a chart on it');
    expect(a.moves).toEqual([]);
    expect(a.toFree || a.toFlow).toBe(false);
  });

  it('"put" with a position word is still a move with layout true', () => {
    for (const ask of ['Put the chart at the top', 'Put the chart below the tiles', 'Place the chart next to the list', 'Put the chart first', 'Put the chart last', 'Put the chart on the left']) {
      const a = placeAsk(ask);
      expect([a.moves.length, a.layout], ask).toEqual([1, true]);
    }
  });

  it('"put" with a size word is a move', () => {
    expect(placeAsk('Put a bigger chart on the page').moves).toHaveLength(1);
  });

  it('a chart added by "Put a chart on the Orders page" is Done, judged by the add rules, with no place line', () => {
    const before = gridSpec(three().slice(0, 2));
    const after = gridSpec(three());
    const out = judge('Put a chart on the Orders page', before, after);
    expect(out.lines.map((l) => l.done)).toEqual([true]);
  });

  it('the chart is not Done when nothing was added', () => {
    const before = gridSpec(three().slice(0, 2));
    expect(judge('Put a chart on the Orders page', before, before).lines.map((l) => l.done)).toEqual([false]);
  });
});

describe('place lines of the review: gaps', () => {
  it('a part whose grid block is unreadable gives no place line and does not throw', () => {
    const before = gridSpec(three());
    const bad = three();
    bad[2] = tile('chart_1', 'Chart', { col: 'x', span: -3, row: null, rowSpan: 'y' } as never);
    const after = gridSpec(bad);
    let changes: ReturnType<typeof diffSpecs> = [];
    expect(() => {
      changes = diffSpecs(before, after);
    }).not.toThrow();
    expect(changes.filter(isPlaceChange).filter((c) => c.path.includes('chart_1'))).toEqual([]);
    expect(() => bullets(before, after)).not.toThrow();
    expect(bullets(before, after).join(' ')).not.toContain('Chart');
  });

  it('a nested free Grid does not crash, and a part moved inside it is reported or ignored consistently both ways', () => {
    const before = wrapInColumn(gridSpec(three()));
    const moved = three();
    moved[2] = tile('chart_1', 'Chart', block(1, 8, 4, 3));
    const after = wrapInColumn(gridSpec(moved));
    const out = bullets(before, after);
    expect(Array.isArray(out)).toBe(true);
    expect(bullets(before, before)).toEqual([]);
    expect(bullets(after, before).length).toBe(out.length);
  });

  it('NOTHING_MOVED is the last line, after the place lines', () => {
    const before = gridSpec(three());
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 3, 1))]);
    const out = bullets(before, after);
    expect(out.at(-1)).toBe(NOTHING_MOVED);
    expect(out.length).toBeGreaterThan(1);
  });
});
