// A free Grid on the Design canvas (DESIGN-phase21.md 6.1 to 6.9): the wrappers with the runtime's classes, the dotted cells and the
// target while dragging, the placed block (toolbar, description, Move to...) and the two resize handles on the keyboard.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleCtx, exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { gridItemClass } from '@local-app-studio/runtime/catalog/parts/gridClasses';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import { libraryOf } from '../../hooks/useFeatures';
import { showcaseRows } from '../../showcase/samples';
import { sampleDataSource } from '../../lib/sampleDataSource';
import type { TreeResult } from '../../lib/layoutTree';
import DesignCanvas from '../DesignCanvas';
import { DesignContext } from '../DesignContext';
import type { DesignContextValue, GridHover, GridPreview } from '../DesignContext';
import { blockName } from '../designLabels';
import { gridReach } from '../gridSteps';

const metrics = vi.hoisted(() => ({ narrow: false, rows: null as number[] | null }));
vi.mock('../gridMetrics', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gridMetrics')>();
  return {
    ...real,
    narrowGrid: () => metrics.narrow,
    measureGrid: () => (metrics.rows === null ? null : { left: 0, top: 0, cols: [], rows: metrics.rows, colGap: 16, rowGap: 16 }),
  };
});

const at = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });
const part = (id: string, type: string, grid?: GridPlace, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = id): LayoutLayer => ({
  ...layer(id, type, props, children),
  ...(grid === undefined ? {} : { grid }),
});
const freeGrid = (children: LayoutLayer[], rows = 1): LayoutLayer => layer('g', 'Grid', { placement: 'free', columns: 12, rows }, children);
const page = (...children: LayoutLayer[]): LayoutLayer => layer('root', 'Page', {}, children);

interface Spies {
  announceGrid: ReturnType<typeof vi.fn>;
  openSettings: ReturnType<typeof vi.fn>;
  tell: ReturnType<typeof vi.fn>;
  focusBlock: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
}
interface Options {
  selected?: string | null;
  drag?: boolean;
  zones?: string[];
  hover?: GridHover | null;
  preview?: GridPreview | null;
}
let spies: Spies;
const latest = { root: page() };

function Stage({ initial, options }: { initial: LayoutLayer; options: Options }) {
  const [root, setRoot] = useState(initial);
  const [selectedId, setSelected] = useState<string | null>(options.selected ?? null);
  useEffect(() => {
    latest.root = root;
  });
  const spec = AppSpecSchema.parse(exampleSpec(root));
  const rows = showcaseRows(spec);
  const value = {
    tree: 'page',
    menu: null,
    menuPosition: 'top',
    root,
    spec,
    page: spec.pages[1],
    ctx: exampleCtx(),
    library: libraryOf([]),
    data: { apiBase: '/api/preview', spec, pageId: spec.pages[1].id, recordId: null, dataSource: sampleDataSource(rows, spec) },
    selectedId,
    select: setSelected,
    drag: options.drag === true ? { type: 'Text', movingId: null, tree: 'page' } : null,
    zones: new Set<string>(),
    sideZones: new Set<string>(),
    gridZones: new Set(options.zones ?? []),
    gridHover: options.hover ?? null,
    gridPreview: options.preview ?? null,
    previewGrid: vi.fn(),
    resizing: null,
    previewResize: vi.fn(),
    pending: null,
    addHere: vi.fn(),
    beside: vi.fn(),
    settingsId: null,
    openSettings: spies.openSettings,
    settingsFocus: null,
    appId: 'app-1',
    apply: (result: TreeResult): string | null => {
      if (!result.ok) return result.message;
      setRoot(result.root);
      return null;
    },
    askTable: vi.fn(),
    tell: spies.tell,
    focusBlock: spies.focusBlock,
    announceGrid: spies.announceGrid,
    remove: vi.fn(),
    move: spies.move,
    otherPlaces: () => [],
    moveAcross: vi.fn(),
  } as unknown as DesignContextValue;
  return (
    <DesignContext.Provider value={value}>
      <DesignCanvas theme={spec.theme} />
    </DesignContext.Provider>
  );
}

const mount = (initial: LayoutLayer, options: Options = {}): void => {
  render(<Stage initial={initial} options={options} />);
};
const item = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-grid-item="${id}"]`);
  if (el === null) throw new Error(`no grid item ${id}`);
  return el;
};
const handle = (axis: 'width' | 'height'): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-grid-handle="${axis}"]`);
  if (el === null) throw new Error(`no ${axis} handle`);
  return el;
};

beforeEach(() => {
  metrics.narrow = false;
  metrics.rows = null;
  spies = { announceGrid: vi.fn(), openSettings: vi.fn(), tell: vi.fn(), focusBlock: vi.fn(), move: vi.fn() };
});
afterEach(cleanup);

describe('a free Grid on the canvas', () => {
  it('wraps each part in reading order with the runtime classes and its place', () => {
    mount(page(freeGrid([part('b', 'Text', at(1, 3, 2, 1)), part('a', 'Text', at(5, 4, 1, 2))])));
    const wrappers = Array.from(document.querySelectorAll<HTMLElement>('[data-grid-item]'));
    expect(wrappers.map((w) => w.getAttribute('data-grid-item'))).toEqual(['a', 'b']);
    expect(item('a').className).toBe(gridItemClass(at(5, 4, 1, 2)));
    expect(item('a').getAttribute('data-grid-place')).toBe('5:4:1:2');
    expect(item('b').getAttribute('data-grid-place')).toBe('1:3:2:1');
  });

  it('shows no dotted cells and no target at rest', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])));
    expect(document.querySelector('[data-grid-cell]')).toBeNull();
    expect(document.querySelector('[data-grid-target]')).toBeNull();
    expect(document.querySelector('[data-grid-area]')).toBeNull();
  });

  it('offers no drop bar between its parts and a drop box of its own while dragging', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { drag: true, zones: ['g'] });
    expect(document.querySelector('[data-grid-area="g"]')).not.toBeNull();
    expect(document.querySelector('[data-zone^="g:"]')).toBeNull();
  });

  it('stretches the drop box over the empty row below the Grid, so a drop on that row lands', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { drag: true, zones: ['g'] });
    const area = document.querySelector<HTMLElement>('[data-grid-area="g"]');
    expect(area).not.toBeNull();
    expect(area?.hasAttribute('data-grid-area-extra')).toBe(true);
    expect(area?.style.bottom).toContain('var(--spacing)');
    expect(area?.style.bottom).toContain('-1');
  });

  it('draws 12 x (rows + 1) dotted cells with both dotted layers while a part is dragged over it', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 2))], 2)), { drag: true, zones: ['g'] });
    const cells = document.querySelectorAll<HTMLElement>('[data-grid-cell]');
    expect(cells).toHaveLength(12 * 3);
    expect(document.querySelector('[data-grid-cell="g:12:3"]')).not.toBeNull();
    for (const cell of cells) {
      expect(cell.getAttribute('aria-hidden')).toBe('true');
      expect(cell.className).toContain('border-dotted');
      expect(cell.className).toContain('outline-dotted');
    }
  });

  it('lines the dotted rows up with the measured rows plus one empty row, and keeps one row of space below the Grid while dragging', () => {
    metrics.rows = [40, 120];
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 2))], 2)), { drag: true, zones: ['g'] });
    const layer = document.querySelector<HTMLElement>('[data-grid-cells]') as HTMLElement;
    expect(layer.getAttribute('style')).toContain('grid-template-rows: 40px 120px calc(var(--spacing)*10)');
    expect(layer.className).toContain('top-0');
    expect(layer.className).not.toContain('inset-0');
    expect(document.querySelectorAll('[data-grid-cell]')).toHaveLength(12 * 3);
    expect(document.querySelector('[data-grid-cell="g:1:3"]')).not.toBeNull();
    expect(layer.parentElement?.getAttribute('style')).toContain('margin-bottom: calc(var(--spacing) * 10 + 1rem)');
  });

  it('keeps no extra space below the Grid at rest', () => {
    metrics.rows = [40];
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])));
    expect(document.querySelector('[data-grid-item="a"]')?.parentElement?.getAttribute('style') ?? '').not.toContain('margin-bottom');
  });

  it('draws the cells in their own layer, out of the content grid, with the same columns and gap', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { drag: true, zones: ['g'] });
    const layer = document.querySelector<HTMLElement>('[data-grid-cells]') as HTMLElement;
    expect(layer.className).toContain('absolute');
    expect(layer.className).toContain('md:grid-cols-12');
    expect(layer.className).toContain('gap-4');
    expect(document.querySelectorAll('[data-grid-cell]')).toHaveLength(24);
    expect(Array.from(document.querySelectorAll('[data-grid-cell]')).every((c) => c.parentElement === layer)).toBe(true);
  });

  it('draws the dotted cells while a handle is dragged, with no drop box', () => {
    const grid = freeGrid([part('a', 'Text', at(1, 3, 1, 1))]);
    mount(page(grid), { preview: { gridId: 'g', id: 'a', place: at(1, 5, 1, 1) } });
    expect(document.querySelectorAll('[data-grid-cell]')).toHaveLength(24);
    expect(document.querySelector('[data-grid-area]')).toBeNull();
    expect(item('a').getAttribute('data-grid-place')).toBe('1:5:1:1');
  });

  it('shows a solid free target with Drop here, and a taken one with Cells taken and no white text', async () => {
    const grid = freeGrid([part('a', 'Text', at(1, 3, 1, 1))]);
    mount(page(grid), { drag: true, zones: ['g'], hover: { gridId: 'g', place: at(4, 3, 1, 1), free: true } });
    const target = document.querySelector<HTMLElement>('[data-grid-target]');
    expect(target?.getAttribute('data-state')).toBe('free');
    expect(target?.className).toContain('outline-solid');
    expect(await screen.findByText('Drop here')).toBeTruthy();
    cleanup();
    mount(page(grid), { drag: true, zones: ['g'], hover: { gridId: 'g', place: at(1, 3, 1, 1), free: false } });
    const taken = document.querySelector<HTMLElement>('[data-grid-target]');
    expect(taken?.getAttribute('data-state')).toBe('taken');
    expect(taken?.className).toContain('outline-solid');
    const pill = await screen.findByText('Cells taken');
    const box = pill.closest<HTMLElement>('[data-grid-taken]');
    expect(box).not.toBeNull();
    expect(box?.className).toContain('bg-slate-slate800');
    expect(box?.className).toContain('text-accent-red');
    expect(box?.className).not.toContain('text-white');
    expect(box?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no motion class on the grid, its wrappers, cells, target, pills or handles', async () => {
    const grid = freeGrid([part('a', 'Text', at(1, 3, 1, 1))]);
    mount(page(grid), { drag: true, zones: ['g'], hover: { gridId: 'g', place: at(4, 3, 1, 1), free: true } });
    await screen.findByText('Drop here');
    const chrome = [
      item('a'),
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-grid-cell], [data-grid-target], [data-grid-area]')),
      screen.getByText('Drop here'),
    ];
    for (const el of chrome) expect(el.className).not.toMatch(/(^|\s)(transition|animate|duration)/);
    cleanup();
    mount(page(grid), { selected: 'a' });
    for (const axis of ['width', 'height'] as const) expect(handle(axis).className).not.toMatch(/(^|\s)(transition|animate|duration)/);
  });
});

describe('a placed block', () => {
  const grid = freeGrid([part('a', 'Text', at(1, 3, 1, 1)), part('b', 'Heading', at(4, 3, 1, 1), { size: 'lg' })]);

  it('has no Move up or Move down in its toolbar', () => {
    mount(page(grid), { selected: 'a' });
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).queryByRole('button', { name: 'Move up' })).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: 'Move down' })).toBeNull();
    expect(within(toolbar).getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('keeps Move up and Move down for a part of a flow Grid', () => {
    mount(page(layer('f', 'Grid', { columns: 2 }, [part('a', 'Text')])), { selected: 'a' });
    expect(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Move up' })).toBeTruthy();
  });

  it('carries its place in its accessible description', () => {
    mount(page(grid));
    const block = document.querySelector<HTMLElement>('[data-canvas-block][data-layer-id="a"]');
    const id = block?.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const desc = document.getElementById(id as string);
    expect(desc?.hasAttribute('data-grid-place-desc')).toBe(true);
    expect(desc?.textContent).toBe('column 1, row 1, 3 columns wide, 1 row high');
  });

  it('lists Choose column and row... first in Move to... and opens the settings on Column', () => {
    mount(page(grid), { selected: 'a' });
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Move to...' }));
    const list = screen.getByRole('group', { name: /^Move .* to$/ });
    const buttons = within(list).getAllByRole('button');
    expect(buttons[0].textContent).toBe('Choose column and row...');
    fireEvent.click(buttons[0]);
    expect(spies.openSettings).toHaveBeenCalledWith('a', 'place.col');
  });

  it('still shows a placed data part without a table its Needs a table box', () => {
    mount(page(freeGrid([part('t', 'DataTable', at(1, 6, 1, 2), {}, [])])));
    expect(screen.getAllByText('Needs a table').length).toBeGreaterThan(0);
  });
});

describe('the resize handles', () => {
  const grid = freeGrid([part('a', 'Text', at(1, 3, 1, 1)), part('b', 'Heading', at(4, 3, 1, 1), { size: 'lg' })]);

  it('are absent until the block is selected', () => {
    mount(page(grid));
    expect(document.querySelector('[data-grid-handle]')).toBeNull();
  });

  it('are separators with names, values and the 24 px boxes', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { selected: 'a' });
    const reach = gridReach(latest.root, 'a');
    const width = screen.getByRole('separator', { name: 'Change the width of Text' });
    const height = screen.getByRole('separator', { name: 'Change the height of Text' });
    expect(width).toBe(handle('width'));
    expect(width.getAttribute('aria-orientation')).toBe('vertical');
    expect(width.getAttribute('aria-valuenow')).toBe('3');
    expect(width.getAttribute('aria-valuemin')).toBe('1');
    expect(width.getAttribute('aria-valuemax')).toBe(String(reach.span));
    expect(width.getAttribute('aria-valuetext')).toBe('3 columns wide, columns 1 to 3');
    expect(width.getAttribute('tabindex')).toBe('0');
    expect(height.getAttribute('aria-orientation')).toBe('horizontal');
    expect(height.getAttribute('aria-valuenow')).toBe('1');
    expect(height.getAttribute('aria-valuemax')).toBe(String(reach.rowSpan));
    expect(height.getAttribute('aria-valuetext')).toBe('1 row high, row 1');
    const boxes = Array.from(document.querySelectorAll<HTMLElement>('[data-canvas-block][data-layer-id="a"] > div')).map((d) => d.className);
    expect(boxes.some((c) => c.includes('w-6') && c.includes('min-h-6') && c.includes('-right-1') && c.includes('bottom-6'))).toBe(true);
    expect(boxes.some((c) => c.includes('h-6') && c.includes('min-w-6') && c.includes('-bottom-1') && c.includes('right-6'))).toBe(true);
  });

  it('ArrowRight widens by one cell and says the new extent', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { selected: 'a' });
    const ev = fireEvent.keyDown(handle('width'), { key: 'ArrowRight' });
    expect(ev).toBe(false);
    expect(spies.announceGrid).toHaveBeenCalledWith('Now 4 columns wide, columns 1 to 4.', 'step');
    expect(handle('width').getAttribute('aria-valuenow')).toBe('4');
  });

  it('ArrowDown makes it taller and ArrowUp shorter on the height handle', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { selected: 'a' });
    fireEvent.keyDown(handle('height'), { key: 'ArrowDown' });
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 2 rows high, rows 1 to 2.', 'step');
    fireEvent.keyDown(handle('height'), { key: 'ArrowUp' });
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 1 row high, row 1.', 'step');
  });

  it('Home makes it one column wide and End as wide as it can be', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { selected: 'a' });
    const reach = gridReach(latest.root, 'a');
    fireEvent.keyDown(handle('width'), { key: 'Home' });
    expect(handle('width').getAttribute('aria-valuenow')).toBe('1');
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 1 column wide, column 1.', 'step');
    fireEvent.keyDown(handle('width'), { key: 'End' });
    expect(handle('width').getAttribute('aria-valuenow')).toBe(String(reach.span));
  });

  it('Home or End that changes nothing says nothing', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 1, 1, 1))])), { selected: 'a' });
    fireEvent.keyDown(handle('width'), { key: 'Home' });
    expect(spies.announceGrid).not.toHaveBeenCalled();
  });

  it('ArrowRight into a neighbour applies nothing and names the blocker', () => {
    mount(page(grid), { selected: 'a' });
    const neighbour = blockName(latest.root.children !== undefined && Array.isArray(latest.root.children) ? (latest.root.children[0].children as LayoutLayer[])[1] : grid, grid);
    const root = latest.root;
    const ev = fireEvent.keyDown(handle('width'), { key: 'ArrowRight' });
    expect(ev).toBe(false);
    expect(latest.root).toBe(root);
    expect(spies.announceGrid).toHaveBeenCalledWith(`Cannot make it wider: ${neighbour} is in column 4.`, 'refusal');
  });

  it('adds the narrow sentence below md', () => {
    metrics.narrow = true;
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { selected: 'a' });
    fireEvent.keyDown(handle('width'), { key: 'ArrowRight' });
    expect(spies.announceGrid).toHaveBeenCalledWith('Now 4 columns wide, columns 1 to 4. The grid shows one column on a narrow screen.', 'step');
  });

  it('handles its arrow keys only on its own axis and prevents their default', () => {
    mount(page(freeGrid([part('a', 'Text', at(1, 3, 1, 1))])), { selected: 'a' });
    expect(fireEvent.keyDown(handle('width'), { key: 'ArrowUp' })).toBe(true);
    expect(spies.announceGrid).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(handle('height'), { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(handle('width'), { key: 'Home' })).toBe(false);
  });

  it('leaves Alt+Arrow on a handle to the block keys', () => {
    mount(page(freeGrid([part('a', 'Text', at(2, 3, 1, 1))])), { selected: 'a' });
    expect(fireEvent.keyDown(handle('width'), { key: 'ArrowRight', altKey: true })).toBe(true);
    expect(spies.announceGrid).not.toHaveBeenCalled();
  });

  it('prevents Alt+Arrow on a part of a free Grid with no readable place and never moves it in the flow', () => {
    mount(page(freeGrid([part('a', 'Text'), part('b', 'Text', at(1, 3, 2, 1))])), { selected: 'a' });
    const block = document.querySelector<HTMLElement>('[data-canvas-block][data-layer-id="a"]') as HTMLElement;
    expect(fireEvent.keyDown(block, { key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(fireEvent.keyDown(block, { key: 'ArrowDown', altKey: true })).toBe(false);
    expect(spies.move).not.toHaveBeenCalled();
  });

  it('Alt+Arrow on the block moves it and never lets the key through', () => {
    mount(page(freeGrid([part('a', 'Text', at(2, 3, 1, 1))])), { selected: 'a' });
    const block = document.querySelector<HTMLElement>('[data-canvas-block][data-layer-id="a"]') as HTMLElement;
    expect(fireEvent.keyDown(block, { key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Moved to column 1, row 1.', expect.any(String));
    expect(fireEvent.keyDown(block, { key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Column 1 is the first column.', 'refusal');
  });
});
