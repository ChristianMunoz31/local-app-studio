// Split from DesignTab.test.tsx by describe block (phase 27): moving between pages, the blank sheet and the folding shelf. The mocks, builders and hooks are in designTabHarness.tsx.
import { layer, makeSpec, announced, mount, harness, openPageActions, saveButton, block, select, order, installDesignTabHooks } from './designTabHarness';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { lsKey } from '@/utils/storageKeys.js';

installDesignTabHooks();

describe('DesignTab moving between pages and page actions', () => {
  it('saves a changed page first, then opens the other one', async () => {
    const h = harness();
    mount(h);
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
    expect(await screen.findByText('About heading')).toBeTruthy();
    expect(h.saves).toHaveLength(1);
    expect((h.saves[0].pages[0].layout.children as LayoutLayer[]).map((c) => c.id)).toEqual(['h1', 'h2', 'divider_1']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks first when the changes cannot be saved, with the reason; Stay keeps the page and the work', async () => {
    const h = harness();
    const issue: SpecIssue = { path: 'pages.0.layout', code: 'invalid_props', message: 'Heading: bad size.' };
    mount(h, () => ({ ok: false, code: 'invalid_spec', message: 'Heading: bad size.', issues: [issue] }));
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Home cannot be saved yet' });
    expect(within(dialog).getByText('Heading: bad size.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(order()).toContain('divider_1');
    expect((screen.getByLabelText('Page') as HTMLSelectElement).value).toBe('home');
  });

  it('lists the pages by title, a page that opens from a list with those words, and never a route', async () => {
    mount(harness(), undefined, () => {
      const spec = makeSpec();
      spec.pages.push({ id: 'crew', title: 'Crew', route: '/crews/:id', sources: [], layout: layer('root_crew', 'Page', {}, []) });
      return spec;
    });
    await screen.findByText('Home heading');
    const options = [...(screen.getByLabelText('Page') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Home', 'About', 'Crew (opens from a list)']);
  });

  it('keeps the page picker and the Page actions on while there are unsaved changes', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    expect((screen.getByLabelText('Page') as HTMLSelectElement).disabled).toBe(false);
    openPageActions();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Add a page', 'Page settings', 'Show one record on this page', 'Delete this page']);
    expect(screen.getByRole('menu', { name: 'Page actions for Home' })).toBeTruthy();
  });

  it('saves first when Page settings is chosen with unsaved changes, then opens the dialog', async () => {
    const h = harness();
    mount(h);
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Page settings' }));
    expect(await screen.findByRole('dialog', { name: 'Page settings' })).toBeTruthy();
    expect(h.saves).toHaveLength(1);
  });

  it('opens on the Look tab when it comes from Change look', async () => {
    mount(harness(), undefined, undefined, { stepFocus: true, shelfTab: 'look' });
    await screen.findByText('Home heading');
    expect(screen.getByRole('tab', { name: 'Look' }).getAttribute('aria-selected')).toBe('true');
  });

  it('puts the picked tile first when it comes from Use in app: its name is in the search and the tile is selected', async () => {
    mount(harness(), undefined, undefined, { stepFocus: true, addEntry: 'feature:kpi_row' });
    const box = (await screen.findByRole('searchbox', { name: 'Search parts and features' })) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe('Number row'));
    const first = document.querySelector<HTMLElement>('[data-testid="feature-tile"]');
    expect(first?.dataset.entryKey).toBe('feature:kpi_row');
    expect(screen.getByRole('button', { name: 'Select Number row' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('speaks notices through the announcer and keeps the shelf note, the notice box and the problem count out of live regions', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    select('h1');
    expect(screen.getByText('Add puts it after Heading.').closest('[role="status"]')).toBeNull();
    fireEvent.keyDown(block('h1'), { key: 'Delete' });
    expect(announced).toContain('Removed Heading.');
    const notice = screen.getByText('Removed Heading.').closest<HTMLElement>('[role="status"]');
    expect(notice?.getAttribute('aria-live')).toBe('off');
  });

  it('lists the shelf tiles in real lists, one per group', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    const tiles = Array.from(document.querySelectorAll('[data-testid="feature-tile"]'));
    expect(tiles.length).toBeGreaterThan(3);
    expect(tiles.every((li) => li.parentElement?.tagName === 'UL' && li.parentElement.getAttribute('role') === null)).toBe(true);
  });

  it('removes a part with Delete and brings it back with Undo, and Alt+Arrow moves it', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.focus(block('h1'));
    fireEvent.keyDown(block('h1'), { key: 'ArrowDown', altKey: true });
    expect(order()).toEqual(['root_home', 'h2', 'h1']);
    fireEvent.keyDown(block('h1'), { key: 'Delete' });
    expect(order()).toEqual(['root_home', 'h2']);
    const status = screen.getByText('Removed Heading.').closest<HTMLElement>('[role="status"]');
    expect(status).not.toBeNull();
    fireEvent.click(within(status as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(order()).toContain('h1');
  });
});

describe('DesignTab: a blank sheet and the folding shelf', () => {
  const emptySpec = (theme: AppSpec['theme'] = { preset: 'solid', radius: 'md' }): AppSpec => {
    const spec = makeSpec();
    spec.theme = theme;
    spec.pages[0] = { ...spec.pages[0], layout: layer('root_home', 'Page', {}, []) };
    return spec;
  };
  const SHELF_KEY = lsKey('studio.shelfFolded.app-1');

  it('shows the plain theme as a light sheet with no mesh, and an empty page says only "Drop a feature here"', async () => {
    mount(harness(), undefined, () => emptySpec());
    const canvas = await screen.findByTestId('design-canvas');
    expect(canvas.getAttribute('data-theme-mode')).toBe('light');
    expect(canvas.style.getPropertyValue('--body-bg')).toBe('rgb(251, 249, 246)');
    expect(canvas.getAttribute('style') ?? '').not.toContain('--mesh-');
    expect(canvas.style.background).toContain('var(--body-bg)');
    expect(canvas.style.backgroundImage).not.toContain('radial-gradient');
    expect(within(canvas).getByText('Drop a feature here')).toBeTruthy();
    expect(screen.getAllByText('Drop a feature here')).toHaveLength(1);
    // The one hint also describes the Add here button.
    const hintId = within(canvas).getByTestId('empty-page-hint').id;
    expect(hintId).not.toBe('');
    expect(screen.getByRole('button', { name: 'Add here: Page, place 1' }).getAttribute('aria-describedby')).toBe(hintId);
    expect(screen.queryByText(/Add parts from the shelf/)).toBeNull();
    // The keyboard way stays: the Add here button is in the page order and the shelf Add buttons work.
    expect(screen.getByRole('button', { name: 'Add here: Page, place 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    expect(order()).toEqual(['root_home', 'divider_1']);
    expect(screen.queryByText('Drop a feature here')).toBeNull();
  });

  it('folds the shelf to a strip with Add parts, and opens it again', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    const hide = screen.getByRole('button', { name: 'Hide the shelf' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    const shelfId = hide.getAttribute('aria-controls') ?? '';
    expect(document.getElementById(shelfId)?.getAttribute('aria-label')).toBe('Features');
    fireEvent.click(hide);
    expect(screen.queryByRole('searchbox', { name: 'Search parts and features' })).toBeNull();
    const show = screen.getByRole('button', { name: 'Add parts' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    expect(show.getAttribute('aria-controls')).toBe(shelfId);
    expect(window.localStorage.getItem(SHELF_KEY)).toBe('1');
    await waitFor(() => expect(document.activeElement).toBe(show));
    fireEvent.click(show);
    expect(screen.getByRole('searchbox', { name: 'Search parts and features' })).toBeTruthy();
    expect(window.localStorage.getItem(SHELF_KEY)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide the shelf' })));
    // The skip link still reaches the page.
    fireEvent.click(screen.getByRole('link', { name: 'Go to the page' }));
    expect(document.activeElement).toBe(block('h1'));
  });

  it('reads the stored choice back for this app only', async () => {
    window.localStorage.setItem(SHELF_KEY, '1');
    mount(harness());
    await screen.findByText('Home heading');
    expect(screen.getByRole('button', { name: 'Add parts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide the shelf' })).toBeNull();
    cleanup();
    window.localStorage.clear();
    window.localStorage.setItem(lsKey('studio.shelfFolded.other-app'), '1');
    mount(harness());
    await screen.findByText('Home heading');
    expect(screen.getByRole('button', { name: 'Hide the shelf' })).toBeTruthy();
  });

  it('/ opens a folded shelf and focuses its search', async () => {
    window.localStorage.setItem(SHELF_KEY, '1');
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.keyDown(document.body, { key: '/' });
    const search = await screen.findByRole('searchbox', { name: 'Search parts and features' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(window.localStorage.getItem(SHELF_KEY)).toBeNull();
  });

  it('a folded shelf is named hidden, and / still puts the keyboard in the search box', async () => {
    window.localStorage.setItem(SHELF_KEY, '1');
    mount(harness());
    await screen.findByText('Home heading');
    const strip = screen.getByRole('button', { name: 'Add parts' });
    expect(strip.closest('aside')?.getAttribute('aria-label')).toBe('Features, hidden');
    expect(strip.className).toContain('forced-colors:border');
    document.body.focus();
    fireEvent.keyDown(document.body, { key: '/' });
    const search = await screen.findByRole('searchbox', { name: 'Search parts and features' });
    expect(document.activeElement).toBe(search);
    expect(search.closest('aside')?.getAttribute('aria-label')).toBe('Features');
  });

  it('Add here opens a folded shelf', async () => {
    window.localStorage.setItem(SHELF_KEY, '1');
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Page, place 1' }));
    const search = await screen.findByRole('searchbox', { name: 'Search parts and features' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByText('Pick a part to add in Page. Press Escape to cancel.')).toBeTruthy();
    expect(window.localStorage.getItem(SHELF_KEY)).toBeNull();
  });

  it('puts Show as in the canvas toolbar of the Page layout region, outside the page itself, with no Enlarge', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    const region = screen.getByRole('region', { name: 'Page layout' });
    const group = within(region).getByRole('group', { name: 'Show as' });
    const page = document.getElementById('design-page');
    expect(page).not.toBeNull();
    expect(region.contains(page)).toBe(true);
    expect(page?.contains(group)).toBe(false);
    expect(within(region).getByText('Crew Roster')).toBeTruthy();
    expect(screen.getAllByRole('group', { name: 'Show as' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Enlarge' })).toBeNull();
    fireEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('design-canvas').getAttribute('data-theme-mode')).toBe('dark');
  });
});
