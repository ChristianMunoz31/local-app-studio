// The canvas is memoized (phase 31, WP-3): a width preview, a new selection, an edit of one part and a drag moving over the page must
// not draw every part again (a page of 66 parts cost 790 renders per commit before). Each test counts the renders of the Text parts
// (and of the chrome portal, which every block, drop zone and side zone draws once) and says which ones may change.
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleCtx, exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { itemClass } from '@local-app-studio/runtime/catalog/parts/sizingClasses';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { libraryOf } from '../../hooks/useFeatures';
import { sampleDataSource } from '../../lib/sampleDataSource';
import { replaceLayer } from '../../lib/layoutTree';
import type { TreeResult } from '../../lib/layoutTree';
import { showcaseRows } from '../../showcase/samples';
import DesignCanvas from '../DesignCanvas';
import { DesignContext, LiveContext, createLiveStore } from '../DesignContext';
import type { DesignContextValue, LiveStore } from '../DesignContext';

const counts = vi.hoisted(() => {
  const text = new Map<string, number>();
  const portal = { n: 0 };
  return { text, portal, countText: (key: string): void => void text.set(key, (text.get(key) ?? 0) + 1), countPortal: (): void => void (portal.n += 1) };
});

vi.mock('@/catalog/components', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/catalog/components')>();
  const Text = real.PART_COMPONENTS.Text as ComponentType<{ children?: unknown }>;
  const Counted = (props: { children?: unknown }) => {
    counts.countText(String(props.children));
    return <Text {...props} />;
  };
  return { ...real, PART_COMPONENTS: { ...real.PART_COMPONENTS, Text: Counted } };
});

vi.mock('../ChromeLayer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ChromeLayer')>();
  const ChromePortal = (props: Parameters<typeof real.ChromePortal>[0]) => {
    counts.countPortal();
    return <real.ChromePortal {...props} />;
  };
  return { ...real, ChromePortal };
});

const half = { width: 'half', grow: false } as const;
const text = (id: string, words: string): LayoutLayer => layer(id, 'Text', {}, words);
/** Two Text parts side by side, then two Grids of two Text parts each: every container below the page is a sibling subtree. */
const LAYOUT: LayoutLayer = layer('root', 'Page', {}, [
  { ...text('e', 'row e'), sizing: half },
  { ...text('f', 'row f'), sizing: half },
  layer('g1', 'Grid', { columns: 2 }, [text('a', 'text a'), text('b', 'text b')]),
  layer('g2', 'Grid', { columns: 3 }, [text('c', 'text c'), text('d', 'text d')]),
]);
const WORDS = ['row e', 'row f', 'text a', 'text b', 'text c', 'text d'];

const noop = (): void => undefined;
let store: LiveStore;
const handles = { select: noop as (id: string | null) => void, setRoot: noop as (root: LayoutLayer) => void };

function Stage() {
  const [root, setRootState] = useState(LAYOUT);
  const [selectedId, setSelected] = useState<string | null>(null);
  useEffect(() => {
    handles.setRoot = setRootState;
    handles.select = setSelected;
  }, []);
  const spec = AppSpecSchema.parse(exampleSpec(root));
  const value = {
    tree: 'page',
    menu: null,
    menuPosition: 'top',
    root,
    spec,
    page: spec.pages[1],
    ctx: exampleCtx(),
    library: libraryOf([]),
    data: STAGE_DATA.current,
    selectedId,
    select: setSelected,
    drag: null,
    zones: new Set<string>(),
    sideZones: new Set<string>(),
    gridZones: new Set<string>(),
    gridHover: null,
    gridPreview: null,
    previewGrid: noop,
    resizing: null,
    previewResize: noop,
    pending: null,
    addHere: noop,
    beside: noop,
    settingsId: null,
    openSettings: noop,
    settingsFocus: null,
    appId: 'app-1',
    apply: (result: TreeResult): string | null => (result.ok ? null : result.message),
    askTable: noop,
    tell: noop,
    focusBlock: noop,
    announceGrid: noop,
    remove: noop,
    move: noop,
    otherPlaces: () => [],
    moveAcross: noop,
  } as unknown as DesignContextValue;
  return (
    <DndContext>
      <LiveContext.Provider value={store}>
        <DesignContext.Provider value={value}>
          <DesignCanvas theme={spec.theme} />
        </DesignContext.Provider>
      </LiveContext.Provider>
    </DndContext>
  );
}

// One `data` for the whole test, as the session keeps one until the spec changes.
const STAGE_DATA = { current: null as unknown as DesignContextValue['data'] };

beforeEach(() => {
  const spec = AppSpecSchema.parse(exampleSpec(LAYOUT));
  STAGE_DATA.current = { apiBase: '/api/preview', spec, pageId: spec.pages[1].id, recordId: null, dataSource: sampleDataSource(showcaseRows(spec), spec) };
  store = createLiveStore();
  counts.text.clear();
  counts.portal.n = 0;
});
afterEach(cleanup);

const snapshot = (): Map<string, number> => new Map(counts.text);
const changed = (before: Map<string, number>): string[] => [...new Set([...counts.text.keys(), ...before.keys()])].filter((k) => counts.text.get(k) !== before.get(k)).sort();

describe('the canvas draws only what changed', () => {
  it('draws every part once on the first render', () => {
    render(<Stage />);
    expect(WORDS.map((w) => counts.text.get(w))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('follows a width preview in the row without drawing a single part again', () => {
    render(<Stage />);
    const before = snapshot();
    act(() => store.set('resizing', { leftId: 'e', rightId: 'f', left: { width: 'third', grow: false }, right: { width: 'two-thirds', grow: false } }));
    const wrapper = document.querySelector('[data-layer-id="e"]')?.parentElement;
    expect(wrapper?.className).toBe(itemClass({ width: 'third', grow: false }));
    expect(changed(before)).toEqual([]);
    act(() => store.set('resizing', null));
    expect(document.querySelector('[data-layer-id="e"]')?.parentElement?.className).toBe(itemClass(half));
    expect(changed(before)).toEqual([]);
  });

  it('shows a new selection without drawing a single part again', () => {
    render(<Stage />);
    const before = snapshot();
    act(() => handles.select('g1'));
    expect(document.querySelector('[data-layer-id="g1"]')?.className).toContain('outline-slate-brandLight');
    expect(changed(before)).toEqual([]);
  });

  it('draws the edited part and the parts that share its parent, but not the subtree of any other container', () => {
    render(<Stage />);
    const before = snapshot();
    const edited = replaceLayer(LAYOUT, 'c', text('c', 'text c edited'));
    if (!edited.ok) throw new Error(edited.message);
    act(() => handles.setRoot(edited.root));
    // The edited part and the parts next to it (the path to the page is new objects, so the parts under a new parent draw again) ...
    expect(changed(before)).toEqual(['row e', 'row f', 'text c edited', 'text d']);
    expect(counts.text.get('text c edited')).toBe(1);
    // ... but the Grid g1 is the same layer, so nothing under it does.
    expect(counts.text.get('text a')).toBe(1);
    expect(counts.text.get('text b')).toBe(1);
  });

  it('keeps the unchanged layers of a tree the same objects, so the memo can tell', () => {
    const edited = replaceLayer(LAYOUT, 'c', text('c', 'text c edited'));
    if (!edited.ok) throw new Error(edited.message);
    const kids = (l: LayoutLayer): LayoutLayer[] => l.children as LayoutLayer[];
    expect(kids(edited.root)[0]).toBe(kids(LAYOUT)[0]);
    expect(kids(edited.root)[2]).toBe(kids(LAYOUT)[2]);
    expect(kids(kids(edited.root)[3])[1]).toBe(kids(kids(LAYOUT)[3])[1]);
    expect(kids(edited.root)[3]).not.toBe(kids(LAYOUT)[3]);
  });

  it('keeps the blocks and drop places out of it while a drag starts and moves over the page', () => {
    render(<Stage />);
    act(() => handles.select('a'));
    const grip = document.querySelector<HTMLElement>('[aria-label="Drag to move Text"]');
    if (grip === null) throw new Error('no drag handle');
    const portals = counts.portal.n;
    const before = snapshot();
    act(() => {
      fireEvent.pointerDown(grip, { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 40, clientY: 40 });
    });
    expect(document.querySelector('[data-layer-id="a"]')?.className).toContain('opacity-40');
    act(() => {
      for (let i = 1; i <= 5; i += 1) fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 40 + i * 20, clientY: 40 + i * 30 });
    });
    // The block being dragged draws again (it dims); the other 8 blocks and every part do not.
    expect(counts.portal.n - portals).toBeLessThanOrEqual(2);
    expect(changed(before)).toEqual([]);
  });

  it('keeps a part with state (the open tab) when a sibling gets a width and its container turns into rows', () => {
    render(<Stage />);
    const tabs = layer('tabs1', 'Tabs', {}, [layer('t1', 'Tab', { label: 'First' }, [text('p1', 'panel one')]), layer('t2', 'Tab', { label: 'Second' }, [text('p2', 'panel two')])]);
    const plain = layer('root', 'Page', {}, [tabs, text('x', 'text x'), text('y', 'text y')]);
    act(() => handles.setRoot(plain));
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('true');
    const rows = layer('root', 'Page', {}, [tabs, { ...text('x', 'text x'), sizing: half }, { ...text('y', 'text y'), sizing: half }]);
    act(() => handles.setRoot(rows));
    expect(document.querySelector('[data-sizing-row]')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('true');
    act(() => handles.setRoot(plain));
    expect(document.querySelector('[data-sizing-row]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('true');
  });
});
