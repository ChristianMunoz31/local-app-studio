// Parts side by side on the Design canvas (DESIGN-phase9.md 5.5 and 8): the Width setting with Undo, Grow to fill, where Width,
// Shrink and Widen are offered, the resize handle on the keyboard, side drops, and the canvas rows drawn with the runtime's classes.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { makeFakeData } from '@/catalog/__tests__/fakeData';
import { CatalogPageProvider } from '@/catalog/context';
import { ROW_CLASS, itemClass } from '@local-app-studio/runtime/catalog/parts/sizingClasses';
import { SpecRenderer } from '@local-app-studio/runtime/runtime/SpecRenderer.jsx';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import type { WorkspaceValue } from '../../types';
import DesignTab from '../../pages/DesignTab';

/** The handlers Design gave its DndContext last, so a test can finish a drag without a pointer (jsdom has no layout). */
const dnd = vi.hoisted(() => ({ onDragStart: null as null | ((e: DragStartEvent) => void), onDragEnd: null as null | ((e: DragEndEvent) => void) }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>();
  const { useEffect } = await import('react');
  function DndContext(props: ComponentProps<typeof real.DndContext>) {
    const { onDragStart, onDragEnd } = props;
    useEffect(() => {
      dnd.onDragStart = onDragStart ?? null;
      dnd.onDragEnd = onDragEnd ?? null;
    });
    return <real.DndContext {...props} />;
  }
  return { ...real, DndContext };
});

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

const half = { width: 'half', grow: false } as const;
const text = (id: string, words: string): LayoutLayer => layer(id, 'Text', {}, words);

/** The crew page: a number tile and a table side by side, a heading, and one text in each parent that has no widths. */
const LAYOUT: LayoutLayer = layer('root', 'Page', {}, [
  { ...layer('s1', 'StatCard', { source: 'open_crews', stat: 'count', label: 'Crews' }), sizing: half },
  { ...layer('t1', 'DataTable', { source: 'open_crews', columns: ['name'] }), sizing: half },
  layer('h1', 'Heading', { size: 'lg' }, 'Crew page'),
  layer('g1', 'Grid', { columns: 2 }, [text('gt', 'In the grid')]),
  layer('r1', 'Row', {}, [text('rt', 'In the row')]),
  layer('tabs', 'Tabs', {}, [layer('tab1', 'Tab', { label: 'One' }, [text('tt', 'In the tab')])]),
  layer('cols', 'Columns', {}, [layer('col1', 'Column', {}, [text('ct', 'In the column')]), layer('col2', 'Column', {}, [])]),
]);

const saves: AppSpec[] = [];

function Workspace({ layout, children }: { layout: LayoutLayer; children: ReactNode }) {
  const [current, setCurrent] = useState<AppSpec>(() => AppSpecSchema.parse(exampleSpec(layout)));
  const record = (revision: number, s: AppSpec) => ({ id: 'app-1', name: 'Crew Roster', slug: 'crew-roster', revision, spec: s, issues: [], createdAt: '', updatedAt: '' });
  const value: WorkspaceValue = {
    record: record(1, current),
    spec: current,
    revision: 1,
    save: async (next) => {
      saves.push(next);
      setCurrent(next);
      return { ok: true, record: record(2, next) };
    },
    reload: async () => {},
    setDirty: () => {},
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

async function openCrewPage(layout: LayoutLayer = LAYOUT): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace layout={layout}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Page');
  fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'crew' } });
  await screen.findByRole('group', { name: 'Page canvas' });
}

const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (!el) throw new Error(`no block ${id}`);
  return el;
};
const selectBlock = (id: string): HTMLElement => {
  fireEvent.click(block(id));
  return screen.getByRole('toolbar');
};
const openSettings = (id: string): HTMLElement => {
  fireEvent.click(within(selectBlock(id)).getByRole('button', { name: 'Settings' }));
  return screen.getByRole('dialog');
};
/** The status line of Design, found by the message it shows (parts on the page have status roles of their own). */
const notice = (text: string): HTMLElement => {
  const el = screen.getByText(text).closest<HTMLElement>('[role="status"]');
  if (el === null) throw new Error(`no status line with: ${text}`);
  return el;
};
const rowClasses = (scope: ParentNode): string[][] =>
  Array.from(scope.querySelectorAll<HTMLElement>('div')).filter((el) => el.className === ROW_CLASS).map((row) => [row.className, ...Array.from(row.children).map((c) => (c as HTMLElement).className)]);

beforeEach(() => {
  saves.length = 0;
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }));
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the Width setting', () => {
  it('says how much of the row a block takes, applies a new width at once and Undo restores it', async () => {
    await openCrewPage();
    const dialog = openSettings('s1');
    expect(within(dialog).getByText('Takes half the row')).toBeTruthy();
    const width = within(dialog).getByLabelText('Width') as HTMLSelectElement;
    expect(Array.from(width.options).map((o) => o.textContent)).toEqual(['Whole row', 'Three quarters', 'Two thirds', 'Half', 'A third', 'A quarter', 'Only what it needs']);
    fireEvent.change(width, { target: { value: 'third' } });
    const changed = notice('Number tile now takes a third of the row.');
    expect(within(screen.getByRole('dialog')).getByText('Takes a third of the row')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(changed).getByRole('button', { name: 'Undo' }));
    });
    expect(within(screen.getByRole('dialog')).getByText('Takes half the row')).toBeTruthy();
  });

  it('Grow to fill is announced, and a Whole row width saves without a sizing block', async () => {
    await openCrewPage();
    openSettings('s1');
    fireEvent.click(within(screen.getByRole('dialog')).getByLabelText('Grow to fill'));
    expect(notice('Number tile now takes at least half the row and fills the rest.')).toBeTruthy();
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Width'), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    const saved = saves[0].pages.find((p) => p.id === 'crew')?.layout;
    const s1 = Array.isArray(saved?.children) ? saved.children.find((c) => c.id === 's1') : undefined;
    expect(s1 !== undefined && Object.hasOwn(s1, 'sizing')).toBe(false);
  });

  it('turns Grow to fill off at Whole row', async () => {
    await openCrewPage();
    const dialog = openSettings('h1');
    expect(within(dialog).getByText('Takes the whole row')).toBeTruthy();
    expect((within(dialog).getByLabelText('Grow to fill') as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText('Fills any room left in the row.')).toBeTruthy();
  });

  it.each(['s1', 't1', 'h1', 'g1', 'r1', 'tabs', 'cols', 'tt', 'ct'])('is offered with Shrink and Widen on %s, which can sit side by side', async (id) => {
    await openCrewPage();
    const toolbar = selectBlock(id);
    expect(within(toolbar).queryByRole('button', { name: 'Shrink' }), id).toBeTruthy();
    expect(within(toolbar).queryByRole('button', { name: 'Widen' }), id).toBeTruthy();
    expect(within(toolbar).queryByRole('button', { name: /^Put a part beside / }), id).toBeTruthy();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Settings' }));
    expect(within(screen.getByRole('dialog')).queryByLabelText('Width'), id).toBeTruthy();
  });

  it.each(['gt', 'rt', 'tab1', 'col1'])('is not offered with Shrink and Widen on %s, which cannot', async (id) => {
    await openCrewPage();
    const toolbar = selectBlock(id);
    expect(within(toolbar).queryByRole('button', { name: 'Shrink' }), id).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: 'Widen' }), id).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: /^Put a part beside / }), id).toBeNull();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Settings' }));
    expect(within(screen.getByRole('dialog')).queryByLabelText('Width'), id).toBeNull();
  });

  it('gives the page itself no toolbar', async () => {
    await openCrewPage();
    // The page itself has no toolbar at all.
    fireEvent.click(block('root'));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

describe('Shrink, Widen and the handle', () => {
  it('Widen and Shrink move the handle of the pair, with Undo', async () => {
    await openCrewPage();
    fireEvent.click(within(selectBlock('s1')).getByRole('button', { name: 'Widen' }));
    expect(notice('Number tile now takes two thirds of the row and Table of records a third of the row.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Shrink' }));
    expect(notice('Number tile now takes half the row and Table of records half the row.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Shrink' }));
    const shrunk = notice('Number tile now takes a third of the row and Table of records two thirds of the row.');
    await act(async () => {
      fireEvent.click(within(shrunk).getByRole('button', { name: 'Undo' }));
    });
    expect(screen.getByRole('separator', { name: 'Resize Number tile and Table of records' }).getAttribute('aria-valuetext')).toBe('Half and half');
  });

  it('the handle steps both widths with the arrow keys and says when it is at the end', async () => {
    await openCrewPage();
    const handle = screen.getByRole('separator', { name: 'Resize Number tile and Table of records' });
    expect(handle.getAttribute('aria-valuetext')).toBe('Half and half');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(notice('Number tile now takes two thirds of the row and Table of records a third of the row.')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(screen.getByRole('separator').getAttribute('aria-valuetext')).toBe('Three quarters and a quarter');
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(notice('The handle cannot go further this way.')).toBeTruthy();
  });

  it('draws no handle for three thirds, which has nowhere to go, and keeps Shrink and Widen', async () => {
    const third = { width: 'third', grow: false } as const;
    await openCrewPage(
      layer('root', 'Page', {}, [
        { ...text('a', 'One'), sizing: third },
        { ...text('b', 'Two'), sizing: third },
        { ...text('c', 'Three'), sizing: third },
      ]),
    );
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    const toolbar = within(selectBlock('b'));
    expect(toolbar.getByRole('button', { name: 'Shrink' })).toBeTruthy();
    expect(toolbar.getByRole('button', { name: 'Widen' })).toBeTruthy();
  });

  it('a whole-row block alone widens to the whole row from three quarters', async () => {
    await openCrewPage();
    fireEvent.click(within(selectBlock('h1')).getByRole('button', { name: 'Widen' }));
    expect(notice('This already takes the whole row.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Shrink' }));
    expect(notice('Heading now takes three quarters of the row.')).toBeTruthy();
  });
});

describe('side drops', () => {
  /** Drags a block onto a side of another block through Design's own drag handlers. */
  const dropBeside = (id: string, targetId: string, side: 'left' | 'right'): void => {
    const active = { id: `block:${id}`, data: { current: { kind: 'block', id } } };
    const over = { id: `zone:side:${targetId}:${side}`, data: { current: { kind: 'side', targetId, side } } };
    act(() => dnd.onDragStart?.({ active } as unknown as DragStartEvent));
    act(() => dnd.onDragEnd?.({ active, over } as unknown as DragEndEvent));
  };
  const third = { width: 'third', grow: false } as const;
  const THIRDS = layer('root', 'Page', {}, [
    { ...layer('s1', 'StatCard', { source: 'open_crews', stat: 'count', label: 'Crews' }), sizing: third },
    { ...layer('t1', 'DataTable', { source: 'open_crews', columns: ['name'] }), sizing: third },
    layer('h1', 'Heading', { size: 'lg' }, 'Crew page'),
  ]);

  it('a drop that changes nothing offers no Undo, and the edit before it survives', async () => {
    await openCrewPage(THIRDS);
    fireEvent.click(within(selectBlock('h1')).getByRole('button', { name: 'Shrink' }));
    expect(notice('Heading now takes three quarters of the row.')).toBeTruthy();
    // The number tile is already left of the table, at the table's width: nothing moves, nothing is resized.
    dropBeside('s1', 't1', 'left');
    expect(screen.queryByText(/^Put Number tile beside/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    expect(within(openSettings('h1')).getByText('Takes three quarters of the row')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // The one Undo step left is the Shrink.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
    expect(within(openSettings('h1')).getByText('Takes the whole row')).toBeTruthy();
  });

  it('a drop that changes the order announces with Undo', async () => {
    await openCrewPage(THIRDS);
    dropBeside('s1', 't1', 'right');
    const put = notice('Put Number tile beside Table of records. It takes a third of the row.');
    expect(within(put).getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('canvas rows', () => {
  it('draw with the same classes as the runtime renderer', async () => {
    const runtime = render(
      <CatalogPageProvider value={{ apiBase: '/api', spec: AppSpecSchema.parse(exampleSpec(LAYOUT)), pageId: 'crew', recordId: 'c1', dataSource: makeFakeData() }}>
        <SpecRenderer layer={LAYOUT} />
      </CatalogPageProvider>,
    );
    const expected = rowClasses(runtime.container);
    runtime.unmount();
    expect(expected).toEqual([[ROW_CLASS, itemClass(half), itemClass(half)]]);
    await openCrewPage();
    expect(rowClasses(screen.getByTestId('design-canvas'))).toEqual(expected);
  });

  it('a page with nothing side by side has no row wrapper', async () => {
    await openCrewPage(layer('root', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Crew page'), layer('t1', 'DataTable', { source: 'open_crews', columns: ['name'] })]));
    expect(rowClasses(screen.getByTestId('design-canvas'))).toEqual([]);
    expect(document.querySelector('[data-sizing-row]')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    // The blocks sit straight in the page, as before rows existed.
    expect(block('h1').parentElement).toBe(block('t1').parentElement);
  });
});

describe('Beside', () => {
  const sizingOf = (id: string): unknown => {
    const page = saves[saves.length - 1].pages.find((p) => p.id === 'crew');
    const find = (l: LayoutLayer): LayoutLayer | null => (l.id === id ? l : (Array.isArray(l.children) ? l.children : []).reduce<LayoutLayer | null>((hit, c) => hit ?? find(c), null));
    return page === undefined ? null : find(page.layout)?.sizing;
  };

  it('puts the next part picked on the shelf to the right of the selected one, with the side drop words and Undo', async () => {
    await openCrewPage();
    fireEvent.click(within(selectBlock('h1')).getByRole('button', { name: 'Put a part beside Heading' }));
    expect(screen.getByText('Pick a part to put beside Heading. Press Escape to cancel.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search parts and features' })));
    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }));
    expect(notice('Put Text beside Heading. Both take half the row.')).toBeTruthy();
    expect(screen.queryByText(/Press Escape to cancel/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(sizingOf('h1')).toEqual(half);
    expect(sizingOf('text_1')).toEqual(half);
  });

  it('Undo takes the part and the widths away together', async () => {
    await openCrewPage();
    fireEvent.click(within(selectBlock('h1')).getByRole('button', { name: 'Put a part beside Heading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }));
    expect(block('text_1')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(notice('Put Text beside Heading. Both take half the row.')).getByRole('button', { name: 'Undo' }));
    });
    expect(document.querySelector('[data-canvas-block][data-layer-id="text_1"]')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Escape cancels Beside', async () => {
    await openCrewPage();
    fireEvent.click(within(selectBlock('h1')).getByRole('button', { name: 'Put a part beside Heading' }));
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search parts and features' }), { key: 'Escape' });
    expect(screen.queryByText(/Press Escape to cancel/)).toBeNull();
  });

  it('says where a plain Add goes while a part is selected: after it, or inside a container', async () => {
    await openCrewPage();
    fireEvent.click(block('h1'));
    expect(screen.getByText('Add puts it after Heading.')).toBeTruthy();
    fireEvent.click(block('r1'));
    expect(screen.getByText('Add puts it inside Row.')).toBeTruthy();
  });
});
