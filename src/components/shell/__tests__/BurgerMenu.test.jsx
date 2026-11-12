import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Boxes, FileText, LayoutDashboard, Settings, Wrench } from 'lucide-react';
import BurgerMenu from '../BurgerMenu';
import { NAV_GROUPS } from '../navItems';

vi.mock('../../../hooks/useProfile', () => ({
  useProfile: () => ({ displayName: null, onboarded: true, isLoading: false, save: vi.fn() }),
}));

// NAV_GROUPS ships only direct links. BurgerMenu also supports drill-down categories (a group with a
// `section`), so these groups exercise that path: one category (labels in alphabetical order, as navItems.js
// requires) with an excluded child route.
const CATEGORY_GROUPS = [
  { section: null, id: 'home', items: [{ to: '/', label: 'Home', icon: LayoutDashboard, end: true }] },
  {
    section: 'Tools',
    id: 'tools',
    icon: Wrench,
    items: [
      { to: '/items/archive', label: 'Archive', icon: FileText },
      { to: '/items', label: 'Items', icon: Boxes, exclude: ['/items/archive'] },
    ],
  },
  { section: null, id: 'settings', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
];

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function setup(route = '/', groups = CATEGORY_GROUPS) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
      <BurgerMenu groups={groups} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return user;
}

const visibleGroups = () => CATEGORY_GROUPS.filter((g) => g.items.length > 0);
const categoriesFor = () => visibleGroups().filter((g) => g.section);

const burger = () => screen.getByRole('button', { name: 'Navigation menu' });
const openMenu = async (user) => {
  await user.click(burger());
  return screen.getByRole('dialog');
};
const rowName = (section) => (n) => n === section || n.startsWith(`${section},`);
const categoryRow = (g) => screen.getByRole('button', { name: rowName(g.section) });

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('BurgerMenu', () => {
  it('renders a collapsed burger with no dialog', () => {
    setup();
    expect(burger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggles aria-expanded and aria-controls matches the dialog id', async () => {
    const user = setup();
    expect(burger()).not.toHaveAttribute('aria-controls');

    const dialog = await openMenu(user);
    const controls = burger().getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(burger()).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveAttribute('id', controls);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('shows the direct links and one row per non-empty category, in config order', async () => {
    const user = setup();
    const dialog = await openMenu(user);
    const nav = within(dialog).getByRole('navigation', { name: 'Main' });

    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    const cats = categoriesFor();
    expect(cats.length).toBeGreaterThan(0);
    for (const g of cats) expect(categoryRow(g)).toBeInTheDocument();
    expect(within(nav).getAllByRole('button')).toHaveLength(cats.length);
    // Category links are not visible until drilled in; only the direct links show.
    const direct = visibleGroups().filter((g) => !g.section).flatMap((g) => g.items);
    expect(within(nav).getAllByRole('link')).toHaveLength(direct.length);
    // Home first, then the categories, then Settings last.
    const labels = [...nav.querySelectorAll('a, button')].map((el) => el.textContent.replace(/[0-9]+$/, '').replace(/, .*$/, '').trim());
    expect(labels).toEqual(['Home', 'Tools', 'Settings']);
  });

  it('drills into a category: shows its links and Back button with focus', async () => {
    const user = setup();
    await openMenu(user);
    const group = categoriesFor()[0];
    await user.click(categoryRow(group));

    const back = screen.getByRole('button', { name: 'Back to categories' });
    await waitFor(() => expect(back).toHaveFocus());
    for (const item of group.items) {
      expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to);
    }
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('Back returns to categories with focus on the originating row', async () => {
    const user = setup();
    await openMenu(user);
    const cats = categoriesFor();
    const group = cats[cats.length - 1];
    await user.click(categoryRow(group));
    await user.click(screen.getByRole('button', { name: 'Back to categories' }));

    expect(screen.queryByRole('button', { name: 'Back to categories' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    await waitFor(() => expect(categoryRow(group)).toHaveFocus());
  });

  it("lists each category's links alphabetically by label", async () => {
    const user = setup();
    await openMenu(user);
    for (const g of categoriesFor()) {
      await user.click(categoryRow(g));
      const labels = within(screen.getByRole('dialog'))
        .getAllByRole('link')
        .map((a) => a.textContent.trim());
      const sorted = [...labels].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      );
      expect(labels).toEqual(sorted);
      expect(labels).toHaveLength(g.items.length);
      await user.click(screen.getByRole('button', { name: 'Back to categories' }));
    }
  });

  // Tests run in studio mode, so the Studio module's Apps and Features links sit between Home and the kit's Settings (src/modules/studio.jsx).
  it('ships the kit pages and the Studio pages as direct links and nothing else', () => {
    expect(NAV_GROUPS.every((g) => g.section === null)).toBe(true);
    expect(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))).toEqual(['Home', 'Apps', 'Features', 'Settings']);
    expect(NAV_GROUPS.at(-1).id).toBe('settings');
  });

  it('renders the shipped nav as direct links with no category rows', async () => {
    const user = setup('/', NAV_GROUPS);
    const dialog = await openMenu(user);
    const nav = within(dialog).getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent.trim())).toEqual(['Home', 'Apps', 'Features', 'Settings']);
    expect(within(nav).queryAllByRole('button')).toHaveLength(0);
  });

  it('shows the privacy footer', async () => {
    const user = setup();
    const dialog = await openMenu(user);
    expect(within(dialog).getByText('Private, on this device')).toBeInTheDocument();
  });

  it('every NAV item path is reachable via some category', async () => {
    const user = setup();
    await openMenu(user);
    const reached = new Set();
    // Direct (section-less) items are on the first level.
    for (const g of visibleGroups().filter((x) => !x.section)) {
      for (const item of g.items) {
        expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to);
        reached.add(item.to);
      }
    }
    for (const g of categoriesFor()) {
      await user.click(categoryRow(g));
      for (const item of g.items) {
        const link = screen.getByRole('link', { name: item.label });
        expect(link).toHaveAttribute('href', item.to);
        reached.add(item.to);
      }
      await user.click(screen.getByRole('button', { name: 'Back to categories' }));
    }
    const all = CATEGORY_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect([...reached].sort()).toEqual([...all].sort());
  });

  it('clicking a link navigates and closes the menu', async () => {
    const user = setup('/');
    await openMenu(user);
    const group = categoriesFor()[0];
    const target = group.items[0];
    await user.click(categoryRow(group));
    await user.click(screen.getByRole('link', { name: target.label }));

    expect(screen.getByTestId('pathname')).toHaveTextContent(target.to);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(burger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape closes the menu and returns focus to the burger', async () => {
    const user = setup();
    await openMenu(user);
    await user.keyboard('{Escape}');

    expect(burger()).toHaveFocus();
    expect(burger()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not trap Tab when focus is outside the panel and burger', async () => {
    const user = setup();
    await openMenu(user);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('Escape with defaultPrevented or focus in another dialog does not close', async () => {
    const user = setup();
    await openMenu(user);
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.addEventListener('keydown', (e) => e.preventDefault(), { once: true, capture: true });
    window.dispatchEvent(prevented);
    expect(burger()).toHaveAttribute('aria-expanded', 'true');

    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    other.appendChild(input);
    document.body.appendChild(other);
    input.focus();
    await user.keyboard('{Escape}');
    expect(burger()).toHaveAttribute('aria-expanded', 'true');
    other.remove();
  });

  it('closes when the command palette opens', async () => {
    const user = setup();
    await openMenu(user);
    act(() => {
      window.dispatchEvent(new CustomEvent('palette:open'));
    });
    expect(burger()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clicking the overlay closes the menu', async () => {
    const user = setup();
    const dialog = await openMenu(user);
    const overlay = dialog.previousElementSibling;
    expect(overlay).toBeTruthy();
    await user.click(overlay);

    expect(burger()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clicking the burger again closes the menu', async () => {
    const user = setup();
    await openMenu(user);
    await user.click(burger());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('marks the active route link with aria-current="page"', async () => {
    const user = setup('/items');
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: rowName('Tools') }));
    expect(screen.getByRole('link', { name: 'Items' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Archive' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a parent route inactive when an excluded child route matches', async () => {
    const user = setup('/items/archive');
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: rowName('Tools') }));
    expect(screen.getByRole('link', { name: 'Items' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Archive' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Home active only at the root route', async () => {
    const user = setup('/');
    await openMenu(user);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark Home active on another route', async () => {
    const user = setup('/settings');
    await openMenu(user);
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
});
