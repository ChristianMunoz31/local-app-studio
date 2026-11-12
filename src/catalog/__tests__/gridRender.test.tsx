// A free Grid in the component and in SpecRenderer (DESIGN-phase21.md 5.2, 5.3).
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Grid } from '@local-app-studio/runtime/catalog/parts/Grid.tsx';
import { FREE_GRID_CLASS, gridItemClass } from '@local-app-studio/runtime/catalog/parts/gridClasses.ts';
import { SpecRenderer } from '@local-app-studio/runtime/runtime/SpecRenderer.jsx';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';

afterEach(cleanup);

const text = (id: string, grid?: unknown): Record<string, unknown> => ({
  id,
  type: 'Text',
  ...(grid === undefined ? {} : { grid }),
  props: { text: id },
  children: [],
});
const free = (children: Record<string, unknown>[], props: Record<string, unknown> = { columns: 12, placement: 'free', rows: 3 }): LayoutLayer =>
  ({ id: 'g', type: 'Grid', props, children }) as unknown as LayoutLayer;

describe('Grid component', () => {
  it('renders the free classes and never lets rows or placement reach the DOM', () => {
    const { container } = render(<Grid placement="free" columns={12} gap="lg" rows={5} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toBe(`${FREE_GRID_CLASS} gap-6`);
    expect(el.getAttribute('rows')).toBeNull();
    expect(el.getAttribute('placement')).toBeNull();
  });

  it('renders a flow grid exactly as before', () => {
    expect(renderToStaticMarkup(<Grid columns={3} gap="sm" />)).toBe('<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"></div>');
    expect(renderToStaticMarkup(<Grid />)).toBe('<div class="grid grid-cols-1 sm:grid-cols-2 gap-4"></div>');
    expect(renderToStaticMarkup(<Grid placement="flow" />)).toBe(renderToStaticMarkup(<Grid />));
  });
});

describe('SpecRenderer with a free Grid', () => {
  it('wraps each child in its grid classes in reading order (row, then column), not array order', () => {
    const layer = free([
      text('c', { col: 1, span: 3, row: 2, rowSpan: 1 }),
      text('b', { col: 7, span: 3, row: 1, rowSpan: 2 }),
      text('a', { col: 1, span: 3, row: 1, rowSpan: 1 }),
      text('u'),
    ]);
    const { container } = render(<SpecRenderer layer={layer} />);
    const grid = container.querySelector('[data-layer-id="g"]') as HTMLElement;
    expect(grid.className).toContain('md:grid-cols-12');
    const wrappers = [...grid.children] as HTMLElement[];
    expect(wrappers.map((w) => (w.firstElementChild as HTMLElement).getAttribute('data-layer-id'))).toEqual(['a', 'b', 'c', 'u']);
    expect(wrappers[0].className).toBe(gridItemClass({ col: 1, span: 3, row: 1, rowSpan: 1 }));
    expect(wrappers[1].className).toContain('md:col-start-7 md:col-span-3 md:row-start-1 md:row-span-2');
    expect(wrappers[3].className).toBe('min-w-0 md:col-span-12');
  });

  it('leaves a flow Grid and its children unwrapped', () => {
    const layer = free([text('a', { col: 1, span: 3, row: 1, rowSpan: 1 }), text('b')], { columns: 2 });
    const { container } = render(<SpecRenderer layer={layer} />);
    const grid = container.querySelector('[data-layer-id="g"]') as HTMLElement;
    expect([...grid.children].map((c) => c.getAttribute('data-layer-id'))).toEqual(['a', 'b']);
  });
});
