// The app menu bar (DESIGN-phase8.md 4.3): top and side, the current page, bad values, and that a spec without `menu`
// renders exactly what it did before.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORNER_PILL, TOP_BAR_TRAIL, TOP_LIST_WRAP, TOP_NAV_TRAIL, TRAIL } from '../../catalog/parts/menuClasses.ts';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { AppMenuFrame } from '../AppMenu.jsx';
import { SpecApp, SpecPage } from '../index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const layer = (id, type, props = {}, children = []) => ({ id, type, props, children });
const spec = (menu, extra = {}) => ({
  specVersion: 1,
  app: { name: 'Menu App', slug: 'menu-app', identifier: 'com.example.menu', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [
    { id: 'home', title: 'Home', route: '/', sources: [], layout: layer('root', 'Page', {}, [layer('h', 'Heading', {}, 'Welcome')]) },
    { id: 'about', title: 'About', route: '/about', sources: [], layout: layer('root2', 'Page', {}, [layer('h2', 'Heading', {}, 'About us')]) },
    { id: 'detail', title: 'Detail', route: '/about/:id', sources: [], layout: layer('root3', 'Page', {}, [layer('h3', 'Heading', {}, 'Detail')]) },
  ],
  nav: [
    { pageId: 'home', label: 'Start', icon: 'home' },
    { pageId: 'about', label: 'About us' },
  ],
  theme: { preset: 'aurora', radius: 'md' },
  ...(menu === undefined ? {} : { menu }),
  ...extra,
});

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const mount = (value, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SpecApp spec={value} />
      <Where />
    </MemoryRouter>,
  );

describe('AppMenuFrame in SpecApp', () => {
  it('top: a nav landmark above the page, one link per menu page, the current one marked', () => {
    const { container } = mount(spec({}));
    const menu = screen.getByRole('navigation', { name: 'App menu' });
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Start', 'About us']);
    expect(screen.getByRole('link', { name: 'Start' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'About us' }).getAttribute('aria-current')).toBeNull();
    expect(menu.className).toContain('overflow-x-auto');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.firstElementChild?.firstElementChild).toBe(menu);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
  });

  it('labels only: no icons', () => {
    const { container } = mount(spec({ position: 'top', style: 'labels' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('side: a column at md and up, stacked above the page below it', () => {
    const { container } = mount(spec({ position: 'side' }));
    const menu = screen.getByRole('navigation', { name: 'App menu' });
    expect(menu.className).toContain('md:w-56');
    expect(container.firstElementChild?.className).toContain('md:flex');
    expect(menu.nextElementSibling?.textContent).toContain('Welcome');
  });

  it('clicking a link goes to that page and moves aria-current; the page without a record never shows', () => {
    mount(spec({ position: 'side' }));
    expect(screen.queryByRole('link', { name: 'Detail' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'About us' }));
    expect(screen.getByTestId('where').textContent).toBe('/about');
    expect(screen.getByRole('heading', { name: 'About us' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'About us' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Start' }).getAttribute('aria-current')).toBeNull();
  });

  it('a record page shows the menu with no current item and the page body', () => {
    mount(spec({}), '/about/42');
    expect(screen.getByRole('navigation', { name: 'App menu' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Detail' })).toBeTruthy();
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(0);
  });

  it('keeps the menu on the page-not-found view', () => {
    mount(spec({}), '/nowhere');
    expect(screen.getByRole('navigation', { name: 'App menu' })).toBeTruthy();
    expect(screen.getByText('Page not found')).toBeTruthy();
  });

  it('bad stored values act as the defaults and never become a class name', () => {
    const { container } = mount(spec({ position: 'bottom; color: red', style: { x: 1 }, className: 'fixed inset-0' }));
    const menu = screen.getByRole('navigation', { name: 'App menu' });
    expect(menu.className).toContain('overflow-x-auto');
    expect(container.innerHTML).not.toContain('fixed inset-0');
    expect(container.innerHTML).not.toContain('color: red');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('a menu that is not an object adds no bar', () => {
    for (const bad of ['side', 7, [], null]) {
      cleanup();
      mount(spec(bad));
      expect(screen.queryByRole('navigation', { name: 'App menu' }), JSON.stringify(bad)).toBeNull();
    }
  });

  it('shows no bar when no menu page can be linked', () => {
    mount(spec({}, { nav: [] }));
    expect(screen.queryByRole('navigation', { name: 'App menu' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
  });

  it('joins links under a base path', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AppMenuFrame spec={spec({})} pageId="home" basePath="/app">
          <p>body</p>
        </AppMenuFrame>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'About us' }).getAttribute('href')).toBe('/app/about');
    expect(screen.getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/app');
  });
});

describe('a spec without menu', () => {
  const classic = spec(undefined);

  it('renders the page markup alone: no wrapper, no menu landmark', () => {
    const via = mount(classic).container.innerHTML;
    cleanup();
    const direct = render(
      <MemoryRouter initialEntries={['/']}>
        <SpecPage spec={classic} pageId="home" recordId={null} />
        <Where />
      </MemoryRouter>,
    ).container.innerHTML;
    expect(via).toBe(direct);
    expect(via).not.toContain('App menu');
  });

  it('keeps its markup (snapshot)', () => {
    expect(mount(classic).container.innerHTML).toMatchSnapshot();
  });

  it('the Crew Roster gets a bar only when it has a menu block', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 }))),
    );
    const without = mount(crewRoster).container.innerHTML;
    cleanup();
    const withBar = mount({ ...crewRoster, menu: {} }).container.innerHTML;
    expect(without).not.toContain('App menu');
    expect(withBar).toContain('App menu');
  });
});

describe('a menu trail (the app entry of a built app)', () => {
  const trail = (
    <>
      <button type="button">Assistant</button>
      <a href="/settings">Settings</a>
    </>
  );
  const mountTrail = (value) =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <SpecApp spec={value} menuTrail={trail} />
      </MemoryRouter>,
    );

  it('top without slots: beside the list, outside the horizontally scrolling box', () => {
    mountTrail(spec({}));
    const nav = screen.getByRole('navigation', { name: 'App menu' });
    expect(nav.querySelectorAll('li')).toHaveLength(2);
    expect(nav.className).toBe(TOP_NAV_TRAIL);
    const bar = nav.parentElement;
    expect(bar.className).toBe(TOP_BAR_TRAIL);
    expect([...bar.children].map((c) => c.tagName)).toEqual(['NAV', 'DIV']);
    expect(nav.contains(bar.lastElementChild)).toBe(false);
    expect(bar.lastElementChild.className).toBe(TRAIL);
    expect([...bar.lastElementChild.children].map((c) => c.textContent)).toEqual(['Assistant', 'Settings']);
  });

  it('four links: the list wraps (no sideways scroll) and shows every link, with and without slots', () => {
    const four = spec({}, {
      pages: [
        ...spec({}).pages,
        { id: 'board', title: 'Board', route: '/board', sources: [], layout: layer('root5', 'Page', {}, [layer('h5', 'Heading', {}, 'Board')]) },
        { id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: layer('root4', 'Page', {}, [layer('h4', 'Heading', {}, 'Extra')]) },
      ],
      nav: [
        { pageId: 'home', label: 'Overview' },
        { pageId: 'about', label: 'Jobs' },
        { pageId: 'board', label: 'Board' },
        { pageId: 'extra', label: 'Pinboard' },
      ],
    });
    const lists = (value) => {
      mountTrail(value);
      const list = screen.getByRole('navigation', { name: 'App menu' }).querySelector('ul');
      const out = { className: list.className, labels: [...list.querySelectorAll('li')].map((li) => li.textContent) };
      cleanup();
      return out;
    };
    const withTrail = lists(four);
    const withSlots = lists({ ...four, menu: { position: 'top', end: [layer('t', 'Text', {}, 'Always here')] } });
    expect(withTrail.className).toBe(TOP_LIST_WRAP);
    expect(withSlots.className).toBe(TOP_LIST_WRAP);
    expect(withTrail.labels).toEqual(withSlots.labels);
    expect(withTrail.labels).toEqual(['Overview', 'Jobs', 'Board', 'Pinboard']);
  });

  it('side without slots: the last list item, with no end margin', () => {
    mountTrail(spec({ position: 'side' }));
    const items = screen.getByRole('navigation', { name: 'App menu' }).querySelectorAll('li');
    const last = items[items.length - 1];
    expect(last.className).not.toContain('ml-auto');
    expect(last.textContent).toBe('AssistantSettings');
  });

  it('no menu block: the page and one corner pill with both controls', () => {
    const { container } = mountTrail(spec(undefined));
    expect(screen.queryByRole('navigation', { name: 'App menu' })).toBeNull();
    const pills = container.querySelectorAll('[data-runtime-corner]');
    expect(pills).toHaveLength(1);
    expect(pills[0].className).toBe(CORNER_PILL);
    expect(pills[0].getAttribute('role')).toBe('group');
    expect(pills[0].getAttribute('aria-label')).toBe('App');
    expect([...pills[0].children].map((c) => c.textContent)).toEqual(['Assistant', 'Settings']);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
  });

  it('a menu block with no linkable page and no slots also gets the corner pill', () => {
    const { container } = mountTrail({ ...spec({}), nav: [] });
    expect(container.querySelectorAll('[data-runtime-corner]')).toHaveLength(1);
  });

  it('passing no trail leaves the markup of a bar byte for byte as it was', () => {
    const plain = mount(spec({})).container.innerHTML;
    cleanup();
    const explicitNull = render(
      <MemoryRouter initialEntries={['/']}>
        <SpecApp spec={spec({})} menuTrail={null} />
        <Where />
      </MemoryRouter>,
    ).container.innerHTML;
    expect(explicitNull).toBe(plain);
    expect(plain).not.toContain('data-runtime-corner');
  });
});
