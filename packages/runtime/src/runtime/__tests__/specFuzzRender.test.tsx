// B1 A1.5 (DESIGN-phase11.md 2.1): the runtime renders every spec the validator accepts, on every page, with empty tables and
// with seeded rows, without a thrown error, an error boundary message or a console error. Seeds are fixed; a failure
// message starts with the seed. Specs come from the shared generator in src/test-utils (random layer trees from the catalog,
// Columns and Tabs nesting, sizing, menu slots).
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRow } from '@/catalog/context';
import type { AppSpec } from '../../spec/schema';
import { sampleDataSource } from '@/studio/lib/sampleDataSource';
import { accepted, forSeeds, genSpec, mulberry32 } from '@/test-utils/specFuzz';
import { fillLayouts } from '@/studio/test-utils/specFuzzLayouts';
import { AppMenuFrame } from '../AppMenu.jsx';
import { SpecPage } from '../index.js';
import { SpecRenderer } from '../SpecRenderer.jsx';

afterEach(cleanup);

const SEEDS = 24;
// One seed per test keeps each test short, so a loaded machine cannot time it out.
const SEED_LIST: number[] = [];
for (let seed = 1; seed <= SEEDS; seed += 1) SEED_LIST.push(seed);
const seen = { specs: 0, pages: 0, parts: 0, depth: 0, layers: 0 };
const BOUNDARY_TEXT = 'This part could not be shown.';

function rowsFor(spec: AppSpec, seeded: boolean): Record<string, DataRow[]> {
  const out: Record<string, DataRow[]> = {};
  for (const table of spec.tables) {
    out[table.id] = [];
    if (!seeded) continue;
    for (let n = 1; n <= 3; n += 1) {
      const row: DataRow = { id: `${table.id}_${n}`, created_at: `2026-02-0${n}T00:00:00.000Z`, updated_at: `2026-02-0${n}T00:00:00.000Z` };
      for (const f of table.fields) {
        if (f.type === 'integer') row[f.id] = n;
        else if (f.type === 'real') row[f.id] = n / 2;
        else if (f.type === 'boolean') row[f.id] = n % 2 === 0;
        else if (f.type === 'date') row[f.id] = '2026-03-01';
        else if (f.type === 'datetime') row[f.id] = '2026-03-01T09:00:00.000Z';
        else if (f.type === 'select') row[f.id] = f.options[n % f.options.length];
        else if (f.type === 'reference') row[f.id] = null;
        else row[f.id] = `${f.id} ${n}`;
      }
      out[table.id].push(row);
    }
  }
  return out;
}

const settle = (): Promise<void> =>
  act(async () => {
    // setImmediate, not setTimeout(0): on Windows a zero timeout waits for the next 15 ms clock tick (see specRendererParity.test.tsx).
    await new Promise<void>((r) => (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate(r));
  });

let errors: unknown[][] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('A1.5 the runtime renders every accepted spec', () => {
  // First, so the cold start of React and the router is not charged to the first seed.
  it('control: a part that throws is caught by the same checks (boundary text and console.error)', async () => {
    const Broken = (): never => {
      throw new Error('broken part');
    };
    const layer = { id: 'x', type: 'Broken', props: {}, children: [] };
    const view = render(createElement(SpecRenderer, { layer, components: { Broken } }));
    await settle();
    expect(view.container.textContent).toContain(BOUNDARY_TEXT);
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(SEED_LIST)('renders every page of the spec of seed %i, empty and with rows', async (seed) => {
    const rand = mulberry32(seed);
    const filled = fillLayouts(rand, genSpec(rand));
    const spec = accepted(filled.spec);
    if (spec === null) return;
    seen.depth = Math.max(seen.depth, filled.stats.maxDepth);
    seen.layers = Math.max(seen.layers, filled.stats.maxLayers);
    seen.specs += 1;
    for (const seeded of [false, true]) {
      const data = sampleDataSource(rowsFor(spec, seeded), spec);
      for (const page of spec.pages) {
        const recordTable = page.sources.find((s) => s.mode === 'record')?.table;
        const recordId = recordTable !== undefined && seeded ? `${recordTable}_1` : null;
        let view;
        try {
          view = render(
            createElement(
              MemoryRouter,
              { initialEntries: [page.route.replace(':id', recordId ?? 'none')] },
              createElement(AppMenuFrame, { spec, pageId: page.id }, createElement(SpecPage, { spec, pageId: page.id, dataSource: data, navigate: () => {}, recordId })),
            ),
          );
          await settle();
        } catch (err) {
          throw new Error(`seed ${seed} page ${page.id} (${seeded ? 'rows' : 'empty'}): render threw ${err instanceof Error ? err.message : String(err)}`);
        }
        const text = view.container.textContent ?? '';
        expect(text, `seed ${seed} page ${page.id}: an error boundary showed`).not.toContain(BOUNDARY_TEXT);
        expect(errors, `seed ${seed} page ${page.id}: console.error was called`).toEqual([]);
        seen.pages += 1;
        seen.parts += view.container.querySelectorAll('[data-layer-id]').length;
        view.unmount();
      }
    }
  });

  // Relies on file order: it reads the tally the tests above fill, so it fails closed under shuffle or -t.
  it(`rendered ${SEEDS} generated specs with enough pages, parts, depth and layers`, () => {
    expect(seen.specs).toBeGreaterThan(SEEDS * 0.9);
    expect(seen.pages).toBeGreaterThan(SEEDS * 2);
    expect(seen.parts).toBeGreaterThan(500);
    expect(seen.depth).toBeGreaterThanOrEqual(8);
    expect(seen.layers).toBeGreaterThanOrEqual(100);
  });

  it('names its seed when a render fails', () => {
    expect(() =>
      forSeeds(1, () => {
        throw new Error('boom');
      }),
    ).toThrow(/^seed 1: boom/);
  });
});
