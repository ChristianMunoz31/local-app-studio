// The menu bar on the Design canvas (DESIGN-phase10.md 2.6): the bar shows only while the menu is on, the shelf marks the parts that fit,
// keyboard Add here in a slot, Settings with What it does, Move to... across the page and the bar, Undo, refusals in the status line,
// the SearchBox words, and what Save writes. Drags go through Design's own handlers (jsdom has no layout).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { MENU_CURRENT, MENU_OTHER, TOP_LIST_WRAP } from '@local-app-studio/runtime/catalog/parts/menuClasses';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer, Menu } from '@local-app-studio/runtime/spec/schema';
import { SEED_FEATURES } from '@/catalog/features';
import { recordOf, seedRecords } from '../../components/__tests__/featureFixtures';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import type { WorkspaceValue } from '../../types';
import DesignTab from '../../pages/DesignTab';

/** The handlers Design gave its DndContext last, so a test can finish a drag without a pointer. */
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

const goHome = (id: string): LayoutLayer => layer(id, 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go home');
const newRecord = (id: string): LayoutLayer => layer(id, 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, 'New record');
const text = (id: string, words: string): LayoutLayer => layer(id, 'Text', {}, words);

/** The crew page: a heading, a table, a button that goes home and a row. */
const CREW: LayoutLayer = layer('root', 'Page', {}, [
  layer('h1', 'Heading', { size: 'lg' }, 'Crew page'),
  layer('t1', 'DataTable', { source: 'open_crews', columns: ['name'] }),
  goHome('b1'),
]);

const saves: AppSpec[] = [];
/** True: the blank page holds a Heading whose id (row_1) is also the id of a Row in the menu, and the crew page a Row holding a DataTable. */
let clash = false;
/** True: the stored nav gives both pages the "file" icon. */
let navIcons = false;
/** True: a fourth page and a stored nav of four links, to see how a long top menu is drawn. */
let navFour = false;

function specWith(menu: Menu | null): AppSpec {
  const crew = clash ? layer('root', 'Page', {}, [...(CREW.children as LayoutLayer[]), layer('prow', 'Row', {}, [layer('pt', 'DataTable', { source: 'open_crews', columns: ['name'] })])]) : CREW;
  const base = exampleSpec(crew);
  const blank = [layer('hb', 'Heading', { size: 'lg' }, 'Blank page'), ...(clash ? [layer('row_1', 'Heading', { size: 'md' }, 'Same id')] : [])];
  const input = {
    ...base,
    pages: [
      ...base.pages,
      { id: 'blank', title: 'Blank', route: '/blank', sources: [], layout: layer('root_blank', 'Page', {}, blank) },
      ...(navFour
        ? ['extra', 'more'].map((id) => ({ id, title: id, route: `/${id}`, sources: [], layout: layer(`root_${id}`, 'Page', {}, [layer(`h_${id}`, 'Heading', { size: 'lg' }, id)]) }))
        : []),
    ],
    ...(menu === null ? {} : { menu }),
    ...(navFour
      ? { nav: [{ pageId: 'home', label: 'Overview' }, { pageId: 'blank', label: 'Jobs' }, { pageId: 'extra', label: 'Board' }, { pageId: 'more', label: 'Pinboard' }] }
      : {}),
    ...(navIcons ? { nav: [{ pageId: 'home', label: 'Home', icon: 'file' }, { pageId: 'blank', label: 'Blank', icon: 'file' }] } : {}),
  };
  return AppSpecSchema.parse(input);
}

function Workspace({ menu, children }: { menu: Menu | null; children: ReactNode }) {
  const [current, setCurrent] = useState<AppSpec>(() => specWith(menu));
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

async function openPage(menu: Menu | null, pageId = 'crew'): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace menu={menu}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Page');
  fireEvent.change(screen.getByLabelText('Page'), { target: { value: pageId } });
  await screen.findByRole('group', { name: 'Page canvas' });
}

const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (!el) throw new Error(`no block ${id}`);
  return el;
};
const slotBox = (name: 'start' | 'end'): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-menu-slot="${name}"]`);
  if (!el) throw new Error(`no slot ${name}`);
  return el;
};
const inSlot = (name: 'start' | 'end'): string[] => Array.from(slotBox(name).querySelectorAll<HTMLElement>('[data-canvas-block]')).map((el) => el.dataset.layerId ?? '');
const selectBlock = (id: string): HTMLElement => {
  fireEvent.click(block(id));
  return screen.getByRole('toolbar');
};
const openSettings = (id: string): HTMLElement => {
  fireEvent.click(within(selectBlock(id)).getByRole('button', { name: 'Settings' }));
  return screen.getByRole('dialog');
};
const notice = (words: string): HTMLElement => {
  const el = screen.getByText(words).closest<HTMLElement>('[role="status"]');
  if (el === null) throw new Error(`no status line with: ${words}`);
  return el;
};
const undoFromNotice = async (words: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(within(notice(words)).getByRole('button', { name: 'Undo' }));
  });
};

const dragPalette = (key: string, over: { kind?: string; parentId: string; index?: number; tree: 'menu' | 'page' }): void => {
  const active = { id: `palette:${key}`, data: { current: { kind: 'palette', key } } };
  act(() => dnd.onDragStart?.({ active } as unknown as DragStartEvent));
  act(() => dnd.onDragEnd?.({ active, over: { id: 'over', data: { current: over } } } as unknown as DragEndEvent));
};
const dragBlock = (id: string, tree: 'menu' | 'page', over: { kind?: string; parentId: string; index?: number; tree: 'menu' | 'page' }): void => {
  const active = { id: `${tree === 'menu' ? 'menu-block' : 'block'}:${id}`, data: { current: { kind: 'block', id, tree } } };
  act(() => dnd.onDragStart?.({ active } as unknown as DragStartEvent));
  act(() => dnd.onDragEnd?.({ active, over: { id: 'over', data: { current: over } } } as unknown as DragEndEvent));
};

const TOP: Menu = { position: 'top', style: 'labels' };
const WITH_PARTS: Menu = { ...TOP, end: [newRecord('m_b'), text('m_t', 'Hello')] };

beforeEach(() => {
  saves.length = 0;
  clash = false;
  navIcons = false;
  navFour = false;
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

describe('the bar on the canvas', () => {
  it('shows only while the menu is on, above the page across the top, with both sides named', async () => {
    await openPage(null);
    expect(document.querySelector('[data-menu-slot]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Across the top' }));
    expect(slotBox('start')).toBeTruthy();
    expect(slotBox('end')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Menu bar, left' })).toBe(slotBox('start'));
    expect(screen.getByRole('group', { name: 'Menu bar, right' })).toBe(slotBox('end'));
    expect(within(slotBox('start')).getByText('You can put a button or a search box here.')).toBeTruthy();
    const bar = document.querySelector('[data-menu-canvas]');
    expect(bar?.getAttribute('data-menu-position')).toBe('top');
    fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
    expect(document.querySelector('[data-menu-slot]')).toBeNull();
  });

  it('draws the bar beside the page for Down the side', async () => {
    await openPage({ position: 'side', style: 'labels' });
    expect(document.querySelector('[data-menu-canvas]')?.getAttribute('data-menu-position')).toBe('side');
    expect(slotBox('start')).toBeTruthy();
  });

  it('draws the link of the page being designed as the current one, not the first', async () => {
    navIcons = true;
    await openPage(TOP, 'blank');
    const bar = within(document.querySelector<HTMLElement>('[data-menu-canvas]')!);
    expect(bar.getByText('Blank').className).toContain(MENU_CURRENT);
    expect(bar.getByText('Home').className).toContain(MENU_OTHER);
  });

  it('draws an icon in each link for Icons and words, and none for Words only', async () => {
    navIcons = true;
    await openPage({ position: 'top', style: 'icons-and-labels' });
    const links = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-menu-canvas] li span'));
    expect(links().map((el) => el.querySelectorAll('svg').length)).toEqual([1, 1]);
    cleanup();
    await openPage({ position: 'top', style: 'labels' });
    expect(links().map((el) => el.querySelectorAll('svg').length)).toEqual([0, 0]);
  });

  it('wraps the links onto a second line instead of scrolling, and draws every link of a four link menu', async () => {
    navFour = true;
    await openPage(TOP);
    const list = document.querySelector<HTMLElement>('[data-menu-canvas] ul');
    expect(list?.className).toBe(TOP_LIST_WRAP);
    expect(list?.className).not.toContain('w-max');
    expect(Array.from(list?.querySelectorAll('li span') ?? []).map((el) => el.textContent)).toEqual(['Overview', 'Jobs', 'Board', 'Pinboard']);
  });

  it('draws the collapse button as a picture first in the side bar, and none across the top', async () => {
    await openPage({ position: 'side', style: 'labels' });
    const toggle = document.querySelector<HTMLElement>('[data-menu-toggle]');
    expect(toggle?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-menu-canvas]')?.firstElementChild).toBe(toggle);
    cleanup();
    await openPage(TOP);
    expect(document.querySelector('[data-menu-toggle]')).toBeNull();
  });

  it('shows the parts of the stored menu in their slots, and the page links as a picture', async () => {
    await openPage(WITH_PARTS);
    expect(inSlot('end')).toEqual(['m_b', 'm_t']);
    expect(inSlot('start')).toEqual([]);
    expect(within(document.querySelector<HTMLElement>('[data-menu-canvas]')!).getByText('Home')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'App menu' })).toBeNull();
  });

  it('says what the Look tab does with the parts: where the other parts come from, and what saving with no bar removes', async () => {
    await openPage(WITH_PARTS);
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    expect(screen.getByText('Other parts go on the menu bar from Features: press Add here on the bar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
    expect(screen.getByText('Saving with no menu bar removes the 2 parts on it.')).toBeTruthy();
    // The parts stay in the session: the bar back on brings them back before Save.
    fireEvent.click(screen.getByRole('radio', { name: 'Across the top' }));
    expect(inSlot('end')).toEqual(['m_b', 'm_t']);
  });
});

describe('the shelf mark', () => {
  it('says Fits the menu on exactly the six menu parts and on no saved feature', async () => {
    await openPage(TOP);
    await waitFor(() => expect(document.querySelectorAll('[data-entry-key]').length).toBeGreaterThan(10));
    const marked = Array.from(document.querySelectorAll<HTMLElement>('[data-entry-key]'))
      .filter((el) => within(el).queryByText('Fits the menu') !== null)
      .map((el) => el.dataset.entryKey)
      .sort();
    expect(marked).toEqual(['part:Button', 'part:Link', 'part:QuickAdd', 'part:Row', 'part:SearchBox', 'part:Text']);
  });
});

describe('putting parts on the bar', () => {
  it('adds a Button with Add here and Add by keyboard, as a button that opens a form', async () => {
    await openPage(TOP);
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Menu bar, left, place 1' }));
    expect(screen.getByText('Pick a part to add in Menu bar, left. Press Escape to cancel.')).toBeTruthy();
    // The chosen place says "Adding here", and its name starts with that visible word.
    expect(screen.getByRole('button', { name: 'Adding here: Menu bar, left, place 1' }).textContent).toBe('Adding here');
    fireEvent.click(screen.getByRole('button', { name: 'Add Button' }));
    expect(inSlot('start')).toEqual(['button_1']);
    expect(within(block('button_1')).getByText(/^Add to /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].menu).toMatchObject({ position: 'top', style: 'labels', start: [{ id: 'button_1', type: 'Button', props: { action: { action: 'open-form', mode: 'create' } }, children: expect.stringMatching(/^Add to /) }] });
  });

  it('takes a part dropped from the shelf on a place of the bar', async () => {
    await openPage(TOP);
    dragPalette('part:Text', { parentId: '@menu-end', index: 0, tree: 'menu' });
    expect(inSlot('end')).toHaveLength(1);
  });

  it('refuses a part the bar does not take in plain words (no type names), and a saved feature with its own', async () => {
    await openPage(TOP);
    dragPalette('part:DataTable', { kind: 'refuse', parentId: '@menu-end', tree: 'menu' });
    expect(screen.getByText('The menu bar takes buttons, links, search boxes, quick adds, text and rows.').closest('[role="status"]')).toBeTruthy();
    expect(inSlot('end')).toEqual([]);
    expect(screen.queryByText(/SearchBox|QuickAdd/)).toBeNull();
    const feature = seedRecords()[0];
    dragPalette(`feature:${feature.id}`, { kind: 'refuse', parentId: '@menu-end', tree: 'menu' });
    expect(screen.getByText('Saved features cannot go on the menu bar.')).toBeTruthy();
  });

  it('refuses a page block the bar does not take, and keeps it on the page', async () => {
    await openPage(TOP);
    dragBlock('t1', 'page', { parentId: '@menu-end', index: 0, tree: 'menu' });
    expect(notice('The menu bar takes buttons, links, search boxes, quick adds, text and rows.')).toBeTruthy();
    expect(inSlot('end')).toEqual([]);
    expect(block('t1')).toBeTruthy();
  });

  it('moves a page button onto the bar by drag as one step, and Undo from the status line puts it back', async () => {
    await openPage(TOP);
    dragBlock('b1', 'page', { parentId: '@menu-end', index: 0, tree: 'menu' });
    expect(notice('Moved Button to the menu bar.')).toBeTruthy();
    expect(inSlot('end')).toEqual(['b1']);
    expect(document.querySelector('[data-menu-canvas]')?.contains(block('b1'))).toBe(true);
    await undoFromNotice('Moved Button to the menu bar.');
    expect(inSlot('end')).toEqual([]);
    expect(document.querySelector('[data-menu-canvas]')?.contains(block('b1'))).toBe(false);
  });

  it('moves a part of the bar back to the page by drag', async () => {
    await openPage(WITH_PARTS);
    dragBlock('m_t', 'menu', { parentId: 'root', index: 1, tree: 'page' });
    expect(notice('Moved Text to the page.')).toBeTruthy();
    expect(inSlot('end')).toEqual(['m_b']);
    expect(document.querySelector('[data-menu-canvas]')?.contains(block('m_t'))).toBe(false);
  });

  it('reorders inside a slot by drag', async () => {
    await openPage(WITH_PARTS);
    dragBlock('m_t', 'menu', { parentId: '@menu-end', index: 0, tree: 'menu' });
    expect(inSlot('end')).toEqual(['m_t', 'm_b']);
  });
});

describe('keyboard, Move to... and Undo', () => {
  it('moves a part of a slot with Alt and the arrow keys, and Delete removes it with Undo', async () => {
    await openPage(WITH_PARTS);
    block('m_b').focus();
    fireEvent.keyDown(block('m_b'), { key: 'ArrowDown', altKey: true });
    expect(inSlot('end')).toEqual(['m_t', 'm_b']);
    fireEvent.keyDown(block('m_b'), { key: 'ArrowUp', altKey: true });
    expect(inSlot('end')).toEqual(['m_b', 'm_t']);
    fireEvent.keyDown(block('m_t'), { key: 'Delete' });
    expect(inSlot('end')).toEqual(['m_b']);
    await undoFromNotice('Removed Text.');
    expect(inSlot('end')).toEqual(['m_b', 'm_t']);
  });

  it('Move up and Move down work in the toolbar of a slot part', async () => {
    await openPage(WITH_PARTS);
    fireEvent.click(within(selectBlock('m_b')).getByRole('button', { name: 'Move down' }));
    expect(inSlot('end')).toEqual(['m_t', 'm_b']);
  });

  it('the toolbar of a block scrolls sideways instead of being clipped in a narrow block', async () => {
    await openPage(WITH_PARTS);
    selectBlock('m_b');
    expect(screen.getAllByRole('toolbar').some((t) => t.className.includes('overflow-x-auto') && t.className.includes('max-w-[calc(100%-1rem)]'))).toBe(true);
  });

  it('Move to... lists the places of the bar for a page part and moves it in one Undo step', async () => {
    await openPage(WITH_PARTS);
    fireEvent.click(within(selectBlock('b1')).getByRole('button', { name: 'Move to...' }));
    const places = within(screen.getByRole('group', { name: 'Move Button to' }));
    const labels = places.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toContain('Menu bar, left, place 1');
    expect(labels).toContain('Menu bar, right, place 3');
    expect(labels).toContain('Page, place 1');
    fireEvent.click(places.getByRole('button', { name: 'Menu bar, left, place 1' }));
    expect(notice('Moved Button to the menu bar.')).toBeTruthy();
    expect(inSlot('start')).toEqual(['b1']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    expect(inSlot('start')).toEqual([]);
    expect(document.querySelector('[data-menu-canvas]')?.contains(block('b1'))).toBe(false);
  });

  it('Move to... from the bar lists the page places and moves the part to the page', async () => {
    await openPage(WITH_PARTS);
    fireEvent.click(within(selectBlock('m_t')).getByRole('button', { name: 'Move to...' }));
    const places = within(screen.getByRole('group', { name: 'Move Text to' }));
    expect(places.getAllByRole('button').map((b) => b.textContent)).toContain('Page, place 2');
    fireEvent.click(places.getByRole('button', { name: 'Page, place 2' }));
    expect(notice('Moved Text to the page.')).toBeTruthy();
    expect(inSlot('end')).toEqual(['m_b']);
    expect(document.querySelector('[data-menu-canvas]')?.contains(block('m_t'))).toBe(false);
  });

  it('offers no places of the bar while the bar is off', async () => {
    await openPage(null);
    fireEvent.click(within(selectBlock('b1')).getByRole('button', { name: 'Move to...' }));
    const labels = within(screen.getByRole('group', { name: 'Move Button to' })).getAllByRole('button').map((b) => b.textContent);
    expect(labels.some((l) => l?.startsWith('Menu bar'))).toBe(false);
  });

  it('keeps one history for the page and the bar: Undo and Redo walk both', async () => {
    await openPage(TOP);
    fireEvent.click(within(selectBlock('b1')).getByRole('button', { name: 'Delete' }));
    dragPalette('part:Text', { parentId: '@menu-start', index: 0, tree: 'menu' });
    expect(inSlot('start')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    expect(inSlot('start')).toEqual([]);
    expect(document.querySelector('[data-canvas-block][data-layer-id="b1"]')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    expect(block('b1')).toBeTruthy();
    // The toolbar's Redo comes first; the status line after an Undo has one too.
    fireEvent.click(screen.getAllByRole('button', { name: /Redo/ })[0]);
    expect(document.querySelector('[data-canvas-block][data-layer-id="b1"]')).toBeNull();
  });
});

describe('Settings of a part on the bar', () => {
  it('opens the settings of a slot part with What it does, and changing it applies at once with Undo', async () => {
    await openPage(WITH_PARTS);
    const dialog = openSettings('m_b');
    const select = within(dialog).getByLabelText('What it does') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Goes to a page', 'Opens a form to add a record']);
    expect(select.value).toBe('open-form');
    fireEvent.change(select, { target: { value: 'navigate' } });
    expect(notice('This button now goes to a page.')).toBeTruthy();
    expect((within(screen.getByRole('dialog')).getByLabelText('What it does') as HTMLSelectElement).value).toBe('navigate');
    expect(within(screen.getByRole('dialog')).getByLabelText('Page')).toBeTruthy();
    await undoFromNotice('This button now goes to a page.');
    expect((within(screen.getByRole('dialog')).getByLabelText('What it does') as HTMLSelectElement).value).toBe('open-form');
  });

  it('has What it does on a page button too, and Save writes the form action', async () => {
    await openPage(TOP);
    const dialog = openSettings('b1');
    fireEvent.change(within(dialog).getByLabelText('What it does'), { target: { value: 'open-form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    const saved = saves[0].pages.find((p) => p.id === 'crew')?.layout.children as LayoutLayer[];
    expect(saved.find((c) => c.id === 'b1')?.props.action).toMatchObject({ action: 'open-form', mode: 'create' });
  });

  it('shows no What it does on a button that deletes the record', async () => {
    const del = layer('b_del', 'Button', { action: { action: 'delete-record', table: 'crews' } }, 'Remove');
    await openPage({ ...TOP, end: [del] });
    const dialog = openSettings('b_del');
    expect(within(dialog).queryByLabelText('What it does')).toBeNull();
  });

  it('changes the hint text of a search box on the bar and says what it searches', async () => {
    await openPage({ ...TOP, start: [layer('m_sb', 'SearchBox', { placeholder: 'Find' }, [])] });
    const dialog = openSettings('m_sb');
    expect(within(dialog).getByText('Searches the first list on the page that is open. On a page with no list it is hidden.')).toBeTruthy();
    const hint = within(dialog).getByLabelText('Hint text') as HTMLInputElement;
    expect(hint.value).toBe('Find');
    expect(within(dialog).queryByLabelText('Table')).toBeNull();
    fireEvent.change(hint, { target: { value: 'Search crews' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].menu?.start?.[0]).toMatchObject({ type: 'SearchBox', props: { placeholder: 'Search crews' } });
  });

  it('explains a search box with nothing to say about a list when the page has none', async () => {
    await openPage({ ...TOP, start: [layer('m_sb', 'SearchBox', {}, [])] }, 'blank');
    expect(within(block('m_sb')).getByText('Hidden on this page: it has no list.')).toBeTruthy();
    const dialog = openSettings('m_sb');
    expect(within(dialog).getByText('Searches the first list on the page that is open. On a page with no list it is hidden.')).toBeTruthy();
  });

  it('draws the search box on a page that has a list', async () => {
    await openPage({ ...TOP, start: [layer('m_sb', 'SearchBox', {}, [])] });
    expect(within(block('m_sb')).queryByText('Hidden on this page: it has no list.')).toBeNull();
    expect(within(block('m_sb')).getByRole('searchbox')).toBeTruthy();
  });
});

describe('what Save writes', () => {
  it('writes the parts with the look, and the bar is not dirty until a part moves', async () => {
    await openPage(WITH_PARTS);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(selectBlock('m_b')).getByRole('button', { name: 'Move down' }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].menu).toMatchObject({ position: 'top', style: 'labels', end: [{ id: 'm_t' }, { id: 'm_b' }] });
    expect(Object.hasOwn(saves[0].menu ?? {}, 'start')).toBe(false);
  });

  it('removes the parts with the bar when it is saved off', async () => {
    await openPage(WITH_PARTS);
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(Object.hasOwn(saves[0], 'menu')).toBe(false);
  });
});

describe('a menu part and a page block that share an id (ids are unique only within one tree)', () => {
  const MENU_ROW: Menu = { ...TOP, end: [layer('row_1', 'Row', {}, [])] };
  const menuBlocks = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('[data-menu-canvas] [data-canvas-block]')).map((el) => el.dataset.layerId ?? '');

  it('drops a shelf part into the menu Row, not into the page block with the same id, and Undo restores', async () => {
    clash = true;
    await openPage(MENU_ROW, 'blank');
    dragPalette('part:Text', { parentId: 'row_1', index: 0, tree: 'menu' });
    expect(notice('Added Text to the menu bar.')).toBeTruthy();
    expect(menuBlocks()).toHaveLength(2);
    expect(block('row_1').closest('[data-menu-canvas]')).not.toBeNull();
    expect(document.querySelectorAll('[data-canvas-block]')).toHaveLength(5);
    await undoFromNotice('Added Text to the menu bar.');
    expect(menuBlocks()).toEqual(['row_1']);
  });

  it('Add here in the menu Row names the Row and lands in the menu', async () => {
    clash = true;
    await openPage(MENU_ROW, 'blank');
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Row, place 1' }));
    expect(screen.getByText('Pick a part to add in Row. Press Escape to cancel.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }));
    expect(menuBlocks()).toHaveLength(2);
    expect(notice('Added Text to the menu bar.')).toBeTruthy();
  });
});

describe('what a refused drag says', () => {
  const startBlock = (id: string): void => {
    const active = { id: `block:${id}`, data: { current: { kind: 'block', id, tree: 'page' } } };
    act(() => dnd.onDragStart?.({ active } as unknown as DragStartEvent));
  };

  it('gives the real reason for a page Row holding a table, never "full"', async () => {
    clash = true;
    await openPage(TOP);
    startBlock('prow');
    const box = slotBox('end').parentElement as HTMLElement;
    expect(box.textContent).not.toContain('This side of the menu bar is full.');
    expect(box.textContent).not.toContain('Fits here:');
    expect(box.textContent).toMatch(/menu/i);
  });

  it('says full only when the part fits the bar and nothing is wrong with it', async () => {
    await openPage(TOP);
    startBlock('b1');
    expect(slotBox('end').textContent).not.toContain('This side of the menu bar is full.');
  });

  it('gives a saved feature no menu places, whatever type its fragment has, and says why', async () => {
    const feature = recordOf({ ...SEED_FEATURES[0], id: 'btn_feat', label: 'Button feature', params: [], bindings: [], fragment: goHome('fb') });
    vi.spyOn(featuresApi, 'list').mockResolvedValue([feature]);
    await openPage(TOP);
    const active = { id: `palette:feature:${feature.id}`, data: { current: { kind: 'palette', key: `feature:${feature.id}` } } };
    act(() => dnd.onDragStart?.({ active } as unknown as DragStartEvent));
    expect(document.querySelectorAll('[data-menu-canvas] [data-zone]')).toHaveLength(0);
    expect(screen.getAllByText('Saved features cannot go on the menu bar.').length).toBeGreaterThan(0);
  });
});

describe('the Look tab and the sides of the bar in plain words', () => {
  const SIDE: Menu = { position: 'side', style: 'labels' };

  it('has the Menu bar section above the themes', async () => {
    await openPage(TOP);
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    const picker = screen.getByTestId('menu-picker');
    const themes = screen.getByTestId('theme-picker');
    expect(picker.compareDocumentPosition(themes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the sides of a bar down the side top and bottom', async () => {
    await openPage(SIDE);
    expect(screen.getByRole('group', { name: 'Menu bar, top' })).toBe(slotBox('start'));
    expect(screen.getByRole('group', { name: 'Menu bar, bottom' })).toBe(slotBox('end'));
    expect(screen.getByRole('button', { name: 'Add here: Menu bar, top, place 1' })).toBeTruthy();
  });

  it('adds a button to the menu bar in one click: Add to the table, on the right, with Undo', async () => {
    await openPage(TOP);
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a button to the menu bar' }));
    expect(inSlot('end')).toHaveLength(1);
    expect(inSlot('start')).toEqual([]);
    expect(within(slotBox('end')).getByText(/^Add to /)).toBeTruthy();
    expect(within(slotBox('end')).queryByText('New record')).toBeNull();
    expect(notice('Added Button to the menu bar.')).toBeTruthy();
    await undoFromNotice('Added Button to the menu bar.');
    expect(inSlot('end')).toEqual([]);
  });

  it('offers no button to add while the bar is off', async () => {
    await openPage(null);
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    expect(screen.queryByRole('button', { name: 'Add a button to the menu bar' })).toBeNull();
  });

  it('Show the parts switches to the Features tab', async () => {
    await openPage(TOP);
    fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show the parts' }));
    expect(screen.getByRole('tab', { name: 'Features' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('searchbox', { name: 'Search parts and features' })).toBeTruthy();
  });
});
