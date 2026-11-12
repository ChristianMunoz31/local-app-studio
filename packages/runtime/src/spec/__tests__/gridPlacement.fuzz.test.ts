// Seeded fuzz of the free-placement reader and the layout validator (phase 21). Seeds are fixed; a failure message starts with the seed.
import { describe, expect, it } from 'vitest';
import { CATALOG_CHECKS } from '@/catalog/validateLayout';
import { mulberry32 } from '@/test-utils/specFuzz';
import crewRoster from '../fixtures/crew-roster.json';
import { GRID_LIMITS, collides, isValidPlace, nextFreeCell, readGrid, readingOrder, rowEnd } from '../gridPlacement';
import type { GridPlace } from '../gridPlacement';
import { validateAppSpec } from '../schema';

type Rand = () => number;
const int = (rand: Rand, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const KNOWN = new Set(['grid_not_allowed', 'grid_overlap']);

function randomPlace(rand: Rand): GridPlace {
  const span = int(rand, 1, 12);
  const rowSpan = int(rand, 1, 12);
  return { col: int(rand, 1, 13 - span), span, row: int(rand, 1, 61 - rowSpan), rowSpan };
}

const JUNK: unknown[] = [null, 'x', 4, [], {}, { col: 0, span: 1, row: 1, rowSpan: 1 }, { col: 1, span: 99, row: 1, rowSpan: 1 }, { col: 1.5, span: 1, row: 1, rowSpan: 1 }, { col: 1, span: 1, row: 1, rowSpan: 1, x: 1 }];

function blockOf(rand: Rand): unknown {
  const roll = rand();
  if (roll < 0.4) return undefined;
  if (roll < 0.75) return randomPlace(rand);
  return JUNK[int(rand, 0, JUNK.length - 1)];
}

type Obj = Record<string, unknown>;
function layerOf(rand: Rand, id: string, depth: number): Obj {
  const kind = rand();
  const grid = blockOf(rand);
  const base: Obj = { id, type: 'Text', props: {}, children: 'x' };
  if (kind < 0.45 && depth < 3) {
    const free = rand() < 0.6;
    const count = int(rand, 0, 5);
    base.type = 'Grid';
    base.props = free
      ? { placement: 'free', columns: rand() < 0.8 ? 12 : 2, ...(rand() < 0.7 ? { rows: int(rand, 1, 70) } : {}) }
      : { columns: rand() < 0.2 ? 12 : 2, ...(rand() < 0.2 ? { rows: 3 } : {}) };
    base.children = Array.from({ length: count }, (_, i) => layerOf(rand, `${id}_${i}`, depth + 1));
  } else if (kind < 0.6 && depth < 3) {
    base.type = 'Section';
    base.children = Array.from({ length: int(rand, 0, 3) }, (_, i) => layerOf(rand, `${id}_${i}`, depth + 1));
  }
  if (grid !== undefined) base.grid = grid;
  return base;
}

describe('place lists', () => {
  it('nextFreeCell never collides and stays inside the grid (2000 lists)', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rand = mulberry32(seed);
      const taken: GridPlace[] = [];
      for (let n = int(rand, 0, 12); n > 0; n -= 1) {
        const p = randomPlace(rand);
        if (!collides(p, taken)) taken.push(p);
      }
      const span = int(rand, 1, 12);
      const rowSpan = int(rand, 1, 4);
      const free = nextFreeCell(taken, span, rowSpan);
      if (free === null) continue;
      const where = `seed ${seed}`;
      expect(isValidPlace(free), where).toBe(true);
      expect(collides(free, taken), where).toBe(false);
      expect(free.span, where).toBe(span);
      expect(rowEnd(free), where).toBeLessThanOrEqual(GRID_LIMITS.maxRow);
    }
  });

  it('readingOrder keeps every child exactly once', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = mulberry32(seed);
      const kids = Array.from({ length: int(rand, 0, 10) }, (_, i) => ({ id: `k${i}`, grid: blockOf(rand) }));
      const ordered = readingOrder(kids);
      expect([...ordered].map((k) => k.id).sort(), `seed ${seed}`).toEqual(kids.map((k) => k.id).sort());
      for (const k of kids) if (readGrid(k.grid) !== null) expect(isValidPlace(readGrid(k.grid) as GridPlace)).toBe(true);
    }
  });
});

describe('validateAppSpec with junk grid blocks', () => {
  it('never throws and every grid code is a known one (500 specs)', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const rand = mulberry32(seed);
      const spec = structuredClone(crewRoster) as unknown as { pages: Array<{ layout: Obj }> };
      spec.pages[0].layout = { id: 'root', type: 'Page', props: {}, children: Array.from({ length: int(rand, 0, 4) }, (_, i) => layerOf(rand, `n${i}`, 0)) };
      const run = (): ReturnType<typeof validateAppSpec> => validateAppSpec(spec, { ...CATALOG_CHECKS });
      expect(run, `seed ${seed}`).not.toThrow();
      for (const issue of run().issues) {
        if (issue.code.startsWith('grid_')) expect(KNOWN.has(issue.code), `seed ${seed}: ${issue.code}`).toBe(true);
      }
    }
  });
});
