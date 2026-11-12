// The menu slots at run time (docs/APP_SPEC.md, "Menu slots"): both positions, the parts of a slot reaching the page's own
// search, form host and tables, a menu SearchBox that hides itself without a list, links that never remount, raw versus
// parsed specs, and that a menu with no slot layers renders exactly what phase 9 did (copied below). Synthetic data.
import { createElement, useContext } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { menuEntries, menuLook, navIcon } from '../../catalog/parts/navItems.ts';
import { TRAIL, TRAIL_END } from '../../catalog/parts/menuClasses.ts';
import { validateAppSpec } from '../../spec/schema.ts';
import { makeFakeData } from '@/catalog/__tests__/fakeData.ts';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { AppMenuFrame } from '../AppMenu.jsx';
import { MenuSlotContext } from '../menuSlots.jsx';
import { SpecPage } from '../index.js';
import { joinPath, routeFor } from '../routing.js';

afterEach(cleanup);

// ---- The phase 9 AppMenuFrame, verbatim (renamed). ----
const LINK =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';
const CURRENT = 'bg-accent-indigo/15 text-accent-indigo';
const OTHER = 'text-slate-slate300 hover:bg-slate-slate700/40 hover:text-slate-slate100';

function LegacyAppMenuFrame({ spec, pageId, basePath = '/', children }) {
  const { side, labelsOnly } = menuLook(spec?.menu);
  const entries = menuEntries(spec).flatMap((entry) => {
    const route = routeFor(spec, entry.pageId);
    return route === null ? [] : [{ ...entry, to: joinPath(basePath, route) }];
  });
  if (entries.length === 0) return children;
  const items = entries.map((entry) => {
    const Icon = labelsOnly ? undefined : navIcon(entry.icon);
    const current = entry.pageId === pageId;
    return createElement(
      'li',
      { key: entry.pageId },
      createElement(
        Link,
        { to: entry.to, 'aria-current': current ? 'page' : undefined, className: `${LINK} ${current ? CURRENT : OTHER}` },
        Icon ? createElement(Icon, { size: 16, 'aria-hidden': 'true' }) : null,
        entry.label,
      ),
    );
  });
  if (side) {
    return createElement(
      'div',
      { className: 'md:flex md:items-start' },
      createElement(
        'nav',
        { 'aria-label': 'App menu', className: 'border-b border-slate-slate700/60 p-2 md:w-56 md:shrink-0 md:border-b-0 md:border-r md:self-stretch' },
        createElement('ul', { className: 'flex flex-wrap gap-1 md:flex-col md:flex-nowrap' }, items),
      ),
      createElement('div', { className: 'min-w-0 flex-1' }, children),
    );
  }
  return createElement(
    'div',
    null,
    createElement(
      'nav',
      { 'aria-label': 'App menu', className: 'overflow-x-auto border-b border-slate-slate700/60 p-2' },
      createElement('ul', { className: 'flex w-max min-w-full gap-1' }, items),
    ),
    children,
  );
}
// ---- end of the copy ----

const layer = (id, type, props = {}, children = []) => ({ id, type, props, children });
const go = { action: 'navigate', pageId: 'about', withRecord: false };
const create = { action: 'open-form', table: 'crews', mode: 'create' };

/** Crew Roster plus an About page with no list; `menu` is whatever the test needs. */
const specWith = (menu) => ({
  ...crewRoster,
  pages: [
    {
      ...crewRoster.pages[0],
      sources: [...crewRoster.pages[0].sources, { id: 'all_people', table: 'people' }],
      layout: { ...crewRoster.pages[0].layout, children: [...crewRoster.pages[0].layout.children, layer('t2', 'DataTable', { source: 'all_people', columns: ['name'] })] },
    },
    { id: 'about', title: 'About', route: '/about', sources: [], layout: layer('about_root', 'Page', {}, [layer('about_h', 'Heading', {}, 'About us')]) },
  ],
  nav: [
    { pageId: 'home', label: 'Home', icon: 'home' },
    { pageId: 'about', label: 'About' },
  ],
  ...(menu === undefined ? {} : { menu }),
});

const PAGE_OF = { '/': 'home', '/about': 'about' };
function Harness({ spec, data }) {
  const pageId = PAGE_OF[useLocation().pathname] ?? 'home';
  return createElement(AppMenuFrame, { spec, pageId }, createElement(SpecPage, { spec, pageId, dataSource: data, navigate: () => {} }));
}
const mount = (spec, data = makeFakeData(), path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness spec={spec} data={data} />
    </MemoryRouter>,
  );
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('a menu with no slot layers renders exactly what phase 9 did', () => {
  const frame = (Frame, spec) =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <Frame spec={spec} pageId="home" basePath="/app">
          <p>body</p>
        </Frame>
      </MemoryRouter>,
    ).container.innerHTML;

  it.each([
    ['empty block', {}],
    ['side', { position: 'side' }],
    ['labels', { position: 'top', style: 'labels' }],
    ['empty slots', { position: 'top', start: [], end: [] }],
    ['empty slots on the side', { position: 'side', style: 'labels', start: [], end: [] }],
  ])('%s', (_name, menu) => {
    const spec = specWith(menu);
    const next = frame(AppMenuFrame, spec);
    cleanup();
    // The side menu adds its collapse control and the id it controls; the rest is phase 9 markup.
    const side = menu.position === 'side';
    const withoutToggle = next.replace(/<button type="button"[^>]*aria-controls="[^"]*"[^>]*>.*?<\/button>/, '').replace(/ id="[^"]*"/, '');
    expect(withoutToggle !== next).toBe(side);
    expect(withoutToggle).toBe(frame(LegacyAppMenuFrame, spec));
    expect(next).not.toContain('data-menu-slot');
  });

  it('no pages to link and no slots: the children alone', () => {
    const spec = { ...specWith({}), nav: [] };
    const next = frame(AppMenuFrame, spec);
    cleanup();
    expect(next).toBe(frame(LegacyAppMenuFrame, spec));
    expect(next).toBe('<p>body</p>');
  });
});

describe('slots in the top bar', () => {
  const menu = { position: 'top', start: [layer('title', 'Text', {}, 'Crew desk')], end: [layer('add', 'Button', { action: create }, 'New record')] };

  it('start before the page links, end after them, each in its own box', async () => {
    const { container } = mount(specWith(menu));
    await settle();
    const bar = screen.getByRole('navigation', { name: 'App menu' }).parentElement;
    expect([...bar.children].map((c) => c.getAttribute('data-menu-slot') ?? c.tagName)).toEqual(['start', 'NAV', 'end']);
    expect(bar.className).toContain('md:flex-row');
    expect(bar.firstElementChild.textContent).toBe('Crew desk');
    expect(bar.lastElementChild.className).toContain('md:ml-auto');
    expect(bar.lastElementChild.textContent).toBe('New record');
    expect(container.querySelector('[data-menu-slot="end"] button')).not.toBeNull();
  });

  it('a slot with no layers draws no box, and the bar shows even with no page links', async () => {
    const spec = { ...specWith({ end: [layer('add', 'Button', { action: create }, 'New record')] }), nav: [] };
    const { container } = mount(spec);
    await settle();
    expect(container.querySelector('[data-menu-slot="start"]')).toBeNull();
    expect(container.querySelector('[data-menu-slot="end"]')?.textContent).toBe('New record');
    expect(screen.queryByRole('navigation', { name: 'App menu' })).toBeNull();
  });

  it('a Row holds small parts in a slot', async () => {
    const row = layer('r', 'Row', {}, [layer('b1', 'Button', { action: go }, 'One'), layer('b2', 'Button', { action: go }, 'Two')]);
    const { container } = mount(specWith({ end: [row] }));
    await settle();
    expect([...container.querySelectorAll('[data-menu-slot="end"] button')].map((b) => b.textContent)).toEqual(['One', 'Two']);
  });
});

describe('slots in the side rail', () => {
  it('start above the page links, end below them, the page beside the rail', async () => {
    const { container } = mount(specWith({ position: 'side', start: [layer('t', 'Text', {}, 'Top')], end: [layer('t2', 'Text', {}, 'Bottom')] }));
    await settle();
    const rail = screen.getByRole('navigation', { name: 'App menu' }).parentElement;
    expect([...rail.children].map((c) => c.getAttribute('data-menu-slot') ?? c.tagName)).toEqual(['BUTTON', 'start', 'NAV', 'end']);
    expect(rail.className).toContain('md:w-56');
    expect(container.firstElementChild.className).toContain('md:flex');
    expect(rail.nextElementSibling.textContent).toContain('Open crews');
  });
});

describe('slot parts work inside the page', () => {
  it('a menu SearchBox searches the first list source of the open page', async () => {
    const data = makeFakeData();
    mount(specWith({ start: [layer('s', 'SearchBox', { placeholder: 'Find a crew' })] }), data);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('Find a crew'), { target: { value: 'alp' } });
    await waitFor(() => expect(data.calls.some((c) => c.method === 'list' && c.arg.search?.term === 'alp')).toBe(true));
    const call = data.calls.filter((c) => c.method === 'list').at(-1);
    expect(call.table).toBe('crews');
    expect(call.arg.source).toBe('open_crews');
    expect(call.arg.search).toEqual({ term: 'alp', fields: ['name'] });
  });

  it('a menu SearchBox renders nothing on a page with no list, and says nothing', async () => {
    const data = makeFakeData();
    mount(specWith({ start: [layer('s', 'SearchBox', { placeholder: 'Find a crew' }), layer('t', 'Text', {}, 'Still here')] }), data, '/about');
    await settle();
    expect(screen.queryByPlaceholderText('Find a crew')).toBeNull();
    expect(screen.getByText('Still here')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(data.calls).toEqual([]);
  });

  it('the SearchBox comes back when the person moves to a page with a list', async () => {
    mount(specWith({ start: [layer('s', 'SearchBox', { placeholder: 'Find a crew' })] }), makeFakeData(), '/about');
    await settle();
    expect(screen.queryByPlaceholderText('Find a crew')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    await settle();
    expect(screen.getByPlaceholderText('Find a crew')).toBeTruthy();
  });

  it('a menu Button opens the form dialog of the page and a save refreshes the list', async () => {
    const data = makeFakeData();
    mount(specWith({ end: [layer('add', 'Button', { action: create }, 'New record')] }), data);
    await settle();
    expect(screen.getByText('Alpha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New record' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Add to/);
    fireEvent.change(dialog.querySelector('input[type="text"], input:not([type])'), { target: { value: 'Delta' } });
    fireEvent.submit(dialog.querySelector('form'));
    await waitFor(() => expect(data.calls.some((c) => c.method === 'create' && c.table === 'crews')).toBe(true));
  });

  it('a menu QuickAdd adds a record and the DataTable of the page fetches again', async () => {
    const data = makeFakeData();
    mount(specWith({ start: [layer('q', 'QuickAdd', { table: 'people', field: 'name', placeholder: 'New person' })] }), data);
    await settle();
    const lists = () => data.calls.filter((c) => c.method === 'list' && c.table === 'people').length;
    const before = lists();
    fireEvent.change(screen.getByPlaceholderText('New person'), { target: { value: 'Epsilon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(data.calls.filter((c) => c.method === 'create')).toHaveLength(1));
    // The write bumps the people table of the page: its DataTable fetches again.
    await waitFor(() => expect(lists()).toBeGreaterThan(before));
  });

  it('the page links are the same elements after a navigation: nothing remounts', async () => {
    mount(specWith({ end: [layer('t', 'Text', {}, 'Always here')] }));
    await settle();
    const home = screen.getByRole('link', { name: 'Home' });
    const slot = document.querySelector('[data-menu-slot="end"]');
    fireEvent.click(screen.getByRole('link', { name: 'About' }));
    await settle();
    expect(screen.getByRole('heading', { name: 'About us' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' })).toBe(home);
    expect(document.querySelector('[data-menu-slot="end"]')).toBe(slot);
    expect(slot.textContent).toBe('Always here');
  });
});

describe('raw and parsed specs', () => {
  const menu = {
    position: 'top',
    start: [layer('s', 'SearchBox', { placeholder: 'Find' })],
    end: [layer('row', 'Row', {}, [layer('b', 'Button', { action: create }, 'New record'), layer('q', 'QuickAdd', { table: 'crews', field: 'name' })])],
  };

  it('render the same markup', async () => {
    const raw = specWith(menu);
    const parsed = validateAppSpec(raw);
    expect(parsed.ok).toBe(true);
    const html = async (spec) => {
      const view = mount(spec);
      await settle();
      const out = view.container.innerHTML.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID');
      view.unmount();
      return out;
    };
    const a = await html(raw);
    expect(a).toContain('data-menu-slot="end"');
    expect(a).toContain('Find');
    expect(await html(parsed.value)).toBe(a);
  });
});

describe('the slot context while a slot is empty', () => {
  it('keeps the same layers array for an empty slot across renders, so the context value is stable', () => {
    const seen = [];
    const Probe = () => {
      seen.push(useContext(MenuSlotContext));
      return null;
    };
    const spec = { ...specWith({ position: 'top', end: [layer('add', 'Button', { action: create }, 'New record')] }) };
    const tree = createElement(MemoryRouter, null, createElement(AppMenuFrame, { spec, pageId: 'crew' }, createElement(Probe)));
    const { rerender } = render(tree);
    rerender(createElement(MemoryRouter, null, createElement(AppMenuFrame, { spec, pageId: 'crew' }, createElement(Probe))));
    const last = seen[seen.length - 1];
    expect(last.start.layers).toHaveLength(0);
    expect(Object.isFrozen(last.start.layers)).toBe(true);
    expect(seen.filter((v) => v !== null).every((v) => v.start.layers === last.start.layers)).toBe(true);
    expect(seen[seen.length - 1]).toBe(seen[seen.length - 2]);
  });
});

describe('a menu trail with slots', () => {
  const trail = createElement('button', { type: 'button' }, 'Assistant');
  const withTrail = (spec) =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppMenuFrame spec={spec} pageId="home" trail={trail}>
          <p>body</p>
        </AppMenuFrame>
      </MemoryRouter>,
    );
  const end = [layer('add', 'Button', { action: create }, 'New record')];

  it('top bar: after the end box, with no end margin of its own', () => {
    withTrail(specWith({ position: 'top', end }));
    const bar = screen.getByRole('navigation', { name: 'App menu' }).parentElement;
    expect([...bar.children].map((c) => c.getAttribute('data-menu-slot') ?? c.tagName)).toEqual(['NAV', 'end', 'DIV']);
    expect(bar.lastElementChild.textContent).toBe('Assistant');
    expect(bar.lastElementChild.className).toBe(TRAIL);
  });

  it('top bar with no end box: the trail takes the end margin', () => {
    withTrail(specWith({ position: 'top', start: [layer('title', 'Text', {}, 'Crew desk')] }));
    const bar = screen.getByRole('navigation', { name: 'App menu' }).parentElement;
    expect(bar.lastElementChild.className).toBe(TRAIL_END);
    expect(bar.lastElementChild.textContent).toBe('Assistant');
  });

  it('side rail: after the end box', () => {
    withTrail(specWith({ position: 'side', end }));
    const rail = screen.getByRole('navigation', { name: 'App menu' }).parentElement;
    expect([...rail.children].map((c) => c.getAttribute('data-menu-slot') ?? c.tagName)).toEqual(['BUTTON', 'NAV', 'end', 'DIV']);
    expect(rail.lastElementChild.textContent).toBe('Assistant');
  });
});
