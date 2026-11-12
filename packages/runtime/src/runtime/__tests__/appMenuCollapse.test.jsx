// The collapsible side menu: the control (name, aria-expanded, aria-controls, keyboard), icons only with titles and
// aria-labels when collapsed, the letter badge without icons, the choice kept per app in this browser, broken stored values,
// the slot boxes behind "More", and the md: only classes that leave the stacked narrow-screen menu alone. Synthetic data.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import * as menuClasses from '../../catalog/parts/menuClasses.ts';
import { readMenuCollapsed, writeMenuCollapsed } from '../menuCollapsed.js';
import { SpecApp } from '../index.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const KEY = 'app.menu.collapsed.menu-app';
const layer = (id, type, props = {}, children = []) => ({ id, type, props, children });
const spec = (menu, slug = 'menu-app') => ({
  specVersion: 1,
  app: { name: 'Menu App', slug, identifier: 'com.example.menu', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [
    { id: 'home', title: 'Home', route: '/', sources: [], layout: layer('root', 'Page', {}, [layer('h', 'Heading', {}, 'Welcome')]) },
    { id: 'about', title: 'About', route: '/about', sources: [], layout: layer('root2', 'Page', {}, [layer('h2', 'Heading', {}, 'About us')]) },
  ],
  nav: [
    { pageId: 'home', label: 'Start', icon: 'home' },
    { pageId: 'about', label: 'about us' },
  ],
  theme: { preset: 'aurora', radius: 'md' },
  menu,
});
const app = (value) => (
  <MemoryRouter initialEntries={['/']}>
    <SpecApp spec={value} />
  </MemoryRouter>
);
const mount = (value) => render(app(value));
const toggle = () => screen.getByRole('button', { name: 'Side menu' });
const link = (name) => screen.getByRole('link', { name });
const classes = (el) => (el?.className ?? '').split(' ');

describe('the side menu collapse control', () => {
  it('expanded by default: icons and labels as before, the control at the top of the rail', () => {
    mount(spec({ position: 'side' }));
    const nav = screen.getByRole('navigation', { name: 'App menu' });
    const button = toggle();
    expect(button.getAttribute('aria-label')).toBe('Side menu');
    expect(button.getAttribute('title')).toBe('Collapse menu');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(nav.id);
    expect(nav.firstElementChild).toBe(button);
    expect(nav.className).toContain('md:w-56');
    expect(link('Start').textContent).toBe('Start');
    expect(link('Start').getAttribute('title')).toBeNull();
    expect(link('Start').querySelector('svg')).not.toBeNull();
    expect(button.className).toContain('focus-visible:ring-2');
  });

  it('collapsed: icons only, labels as titles and aria-labels, a letter badge where there is no icon, the page keeps the width', async () => {
    const { container } = mount(spec({ position: 'side' }));
    await userEvent.click(toggle());
    const nav = screen.getByRole('navigation', { name: 'App menu' });
    expect(toggle().getAttribute('aria-label')).toBe('Side menu');
    expect(toggle().getAttribute('title')).toBe('Expand menu');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(classes(nav)).toContain('md:w-auto');
    expect(classes(nav)).not.toContain('md:w-56');
    for (const name of ['Start', 'about us']) {
      expect(link(name).getAttribute('title')).toBe(name);
      expect(link(name).getAttribute('aria-label')).toBe(name);
      const label = [...link(name).querySelectorAll('span')].find((s) => classes(s).includes(menuClasses.LABEL_COLLAPSED));
      expect(label?.textContent).toBe(name);
    }
    expect(link('Start').querySelector('svg')).not.toBeNull();
    expect(link('Start').querySelector('.rounded-full')).toBeNull();
    const badge = link('about us').querySelector('.rounded-full');
    expect(badge?.textContent).toBe('A');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(container.firstElementChild?.lastElementChild?.className).toBe('min-w-0 flex-1');
    expect(window.localStorage.getItem(KEY)).toBe('1');
  });

  it('labels style without icons: every link gets its first letter in a round badge', async () => {
    const { container } = mount(spec({ position: 'side', style: 'labels' }));
    await userEvent.click(toggle());
    expect([...container.querySelectorAll('a .rounded-full')].map((b) => b.textContent)).toEqual(['S', 'A']);
    expect(container.querySelector('a svg')).toBeNull();
  });

  it('Enter and Space toggle it from the keyboard and it stays in the tab order when collapsed', async () => {
    mount(spec({ position: 'side' }));
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(toggle());
    await user.keyboard('{Enter}');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
    await user.tab();
    expect(document.activeElement).toBe(link('Start'));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(toggle());
    await user.keyboard(' ');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('a top menu has no control', () => {
    mount(spec({ position: 'top' }));
    expect(screen.queryByRole('button', { name: 'Side menu' })).toBeNull();
  });
});

describe('the stored choice', () => {
  it('is read back per app; a second app is unaffected', () => {
    window.localStorage.setItem(KEY, '1');
    mount(spec({ position: 'side' }));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    cleanup();
    mount(spec({ position: 'side' }, 'other-app'));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('switching apps in the same frame reads the other app, and expanding removes the key', () => {
    window.localStorage.setItem(KEY, '1');
    const view = mount(spec({ position: 'side' }, 'other-app'));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    view.rerender(app(spec({ position: 'side' })));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem('app.menu.collapsed.other-app')).toBeNull();
  });

  it('a broken value, a missing slug or blocked storage reads as expanded', () => {
    for (const bad of ['true', 'yes', '{', '', '0']) {
      window.localStorage.setItem(KEY, bad);
      expect(readMenuCollapsed('menu-app'), bad).toBe(false);
    }
    window.localStorage.setItem(KEY, 'yes');
    mount(spec({ position: 'side' }));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    for (const slug of [undefined, '', 7]) {
      writeMenuCollapsed(slug, true);
      expect(readMenuCollapsed(slug)).toBe(false);
    }
    expect(Object.keys(window.localStorage).filter((k) => k !== KEY)).toEqual([]);
  });
});

describe('menu slots when collapsed', () => {
  const slotted = () =>
    spec({ position: 'side', start: [layer('t1', 'Text', {}, 'Top part')], end: [layer('t2', 'Text', {}, 'Bottom part')] });

  it('hide behind a visible "More" button, stay mounted, and "More" expands the rail', async () => {
    const { container } = mount(slotted());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'More menu parts' })).toBeNull();
    fireEvent.click(toggle());
    const boxes = [...container.querySelectorAll('[data-menu-slot]')];
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(classes(box)).toContain('md:hidden');
    expect(container.textContent).toContain('Top part');
    const more = screen.getByRole('button', { name: 'More menu parts' });
    // It sits inside the rail it expands, so it claims neither aria-expanded nor aria-controls; its text is still More.
    expect(more.hasAttribute('aria-expanded')).toBe(false);
    expect(more.hasAttribute('aria-controls')).toBe(false);
    expect(more.textContent).toBe('More');
    expect(classes(more)).toEqual(expect.arrayContaining(['hidden', 'md:flex']));
    fireEvent.click(more);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'More menu parts' })).toBeNull();
    for (const box of container.querySelectorAll('[data-menu-slot]')) expect(classes(box)).not.toContain('md:hidden');
  });
});

describe('focus after More (V5-8)', () => {
  const withSearch = () =>
    spec({ position: 'side', start: [layer('s1', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, 'Start action')], end: [layer('t2', 'Text', {}, 'Bottom part')] });

  it('moves to the first control in the start slot instead of dropping to the page', async () => {
    mount(withSearch());
    await act(async () => {});
    fireEvent.click(toggle());
    const more = screen.getByRole('button', { name: 'More menu parts' });
    more.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'More menu parts' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start action' }));
  });

  it('moves to the side menu button when the start slot holds nothing to focus', async () => {
    mount(spec({ position: 'side', start: [layer('t1', 'Text', {}, 'Top part')] }));
    await act(async () => {});
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'More menu parts' }));
    expect(document.activeElement).toBe(toggle());
  });
});

describe('narrow screens', () => {
  it('the control is hidden below md and every collapsed class applies from md up only', () => {
    mount(spec({ position: 'side' }));
    expect(classes(toggle())).toEqual(expect.arrayContaining(['hidden', 'md:flex']));
    const mdOnly = (value) => value.split(' ').every((token) => token.startsWith('md:'));
    expect(mdOnly(menuClasses.LINK_COLLAPSED)).toBe(true);
    expect(mdOnly(menuClasses.LABEL_COLLAPSED)).toBe(true);
    expect(mdOnly(menuClasses.SLOT_COLLAPSED)).toBe(true);
    expect(menuClasses.LETTER_BADGE.split(' ')).toEqual(expect.arrayContaining(['hidden', 'md:inline-flex']));
    const added = (a, b) => a.split(' ').filter((t) => !b.split(' ').includes(t));
    expect(added(menuClasses.SIDE_NAV_COLLAPSED, menuClasses.SIDE_NAV).every((t) => t.startsWith('md:'))).toBe(true);
    expect(added(menuClasses.SIDE_RAIL_COLLAPSED, menuClasses.SIDE_RAIL).every((t) => t.startsWith('md:'))).toBe(true);
  });
});

describe('the entry trail in a side rail', () => {
  const trail = <button type="button">Assistant</button>;
  const withTrail = () =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <SpecApp spec={spec({ position: 'side' })} menuTrail={trail} />
      </MemoryRouter>,
    );
  const trailBox = () => screen.getByRole('button', { name: 'Assistant' }).parentElement;

  it('stays in a row while the rail is expanded and stacks when it is folded', () => {
    withTrail();
    expect(classes(trailBox())).not.toContain('md:flex-col');
    fireEvent.click(toggle());
    expect(classes(trailBox())).toContain('md:flex-col');
  });
});
