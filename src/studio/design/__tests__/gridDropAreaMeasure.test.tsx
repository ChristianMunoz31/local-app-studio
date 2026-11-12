// A free Grid sets a bottom margin when a drag starts, which moves everything below it: dnd-kit measures its droppables again after
// that (G-03), and the dotted rows follow the Grid when it is resized while the drag is on (R-4).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import GridDropArea from '../GridDropArea';
import { DesignContext } from '../DesignContext';
import type { DesignContextValue } from '../DesignContext';

const dnd = vi.hoisted(() => ({ measure: vi.fn(), margins: [] as string[] }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...real,
    useDndContext: () => ({
      ...real.useDndContext(),
      measureDroppableContainers: (ids: unknown[]) => {
        dnd.measure(ids, document.querySelector<HTMLElement>('[data-grid-host]')?.style.marginBottom ?? '');
      },
      droppableContainers: { toArray: () => [{ id: 'grid:g' }, { id: 'zone:below' }] },
    }),
  };
});
const metrics = vi.hoisted(() => ({ rows: [20, 20] as number[] }));
vi.mock('../gridMetrics', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gridMetrics')>();
  return { ...real, measureGrid: () => ({ left: 0, top: 0, cols: [], rows: metrics.rows, colGap: 16, rowGap: 16 }) };
});

const grid: LayoutLayer = { id: 'g', type: 'Grid', props: { placement: 'free', columns: 12, rows: 2 }, children: [] };
const value = { drag: { type: 'Text', movingId: null, tree: 'page' }, gridZones: new Set(['g']), gridHover: null, gridPreview: null } as unknown as DesignContextValue;

const observers: Array<{ fire(): void; disconnected: boolean }> = [];
beforeEach(() => {
  dnd.measure.mockClear();
  metrics.rows = [20, 20];
  observers.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: () => void;
      private readonly entry = { fire: () => this.cb(), disconnected: false };
      constructor(cb: () => void) {
        this.cb = cb;
        observers.push(this.entry);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        this.entry.disconnected = true;
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () =>
  render(
    <DesignContext.Provider value={value}>
      <div data-grid-host="">
        <GridDropArea grid={grid} />
      </div>
    </DesignContext.Provider>,
  );

describe('GridDropArea measuring', () => {
  it('G-03: measures the droppables again after the bottom margin is on, with every droppable id', () => {
    mount();
    expect(dnd.measure).toHaveBeenCalled();
    const [ids, marginWhenCalled] = dnd.measure.mock.calls[0] as [unknown[], string];
    expect(ids).toEqual(['grid:g', 'zone:below']);
    expect(marginWhenCalled).toContain('var(--spacing)');
  });

  it('R-4: follows a Grid that changes size while the drag is on, and stops when it ends', () => {
    const view = mount();
    expect(document.querySelectorAll('[data-grid-cell]')).toHaveLength(12 * 3);
    metrics.rows = [20, 20, 20];
    const before = dnd.measure.mock.calls.length;
    act(() => observers[0].fire());
    expect(document.querySelectorAll('[data-grid-cell]')).toHaveLength(12 * 4);
    expect(dnd.measure.mock.calls.length).toBeGreaterThan(before);
    view.unmount();
    expect(observers[0].disconnected).toBe(true);
  });
});
