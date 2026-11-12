// Split from DesignTab.test.tsx by describe block (phase 27): the canvas basics, moving and removing, tabs. The mocks, builders and hooks are in designTabHarness.tsx.
import { layer, makeSpec, dataSpec, mount, harness, saveButton, block, select, toolbar, order, installDesignTabHooks } from './designTabHarness';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';

installDesignTabHooks();

describe('DesignTab', () => {
  it('draws the first page on the canvas with nothing to save, and shows no layers panel, props panel or class control', async () => {
    mount(harness());
    expect(await screen.findByText('Home heading')).toBeTruthy();
    expect(order()).toEqual(['root_home', 'h1', 'h2']);
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByTestId('component-editor')).toBeNull();
    expect(screen.queryByText(/className/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /advanced/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a feature' })).toBeNull();
  });

  it('P-12: with no tables it says to start on Data and links there, and with tables it does not', async () => {
    mount(harness());
    expect(await screen.findByText('Start with your tables on Data.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Data' })).toBeTruthy();
    // The skip link is the first Tab stop: it comes before the hint and its button.
    const skip = screen.getByRole('link', { name: 'Go to the page' });
    const toData = screen.getByRole('button', { name: 'Go to Data' });
    expect(skip.compareDocumentPosition(toData) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const firstStop = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, [tabindex="0"]'))[0];
    expect(firstStop).toBe(skip);
    cleanup();
    mount(harness(), undefined, dataSpec);
    await screen.findAllByRole('group', { name: 'Table of records' });
    expect(screen.queryByText('Start with your tables on Data.')).toBeNull();
  });

  it('shows the other page when it is picked', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
    expect(await screen.findByText('About heading')).toBeTruthy();
    expect(order()).toEqual(['root_about', 'h3']);
  });

  it('adds a part with Add here and Add, in plain words, and saves only the edited page', async () => {
    const h = harness();
    mount(h);
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Page, place 2' }));
    expect(screen.getByText('Pick a part to add in Page. Press Escape to cancel.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search parts and features' })));
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    expect(order()).toEqual(['root_home', 'h1', 'divider_1', 'h2']);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect((h.saves[0].pages[0].layout.children as LayoutLayer[]).map((c) => c.id)).toEqual(['h1', 'divider_1', 'h2']);
    expect(h.saves[0].pages[1]).toEqual(makeSpec().pages[1]);
    expect(h.saves[0].theme).toEqual({ preset: 'aurora', radius: 'md' });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(h.dirty.some(([tab, d]) => tab === 'design' && d)).toBe(true);
  });

  it('adds at the end of the selected container, else after the selected part, else at the end of the page', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    expect(order()).toEqual(['root_home', 'h1', 'h2', 'divider_1']);
    select('h1');
    fireEvent.click(screen.getByRole('button', { name: 'Add Section' }));
    expect(order()).toEqual(['root_home', 'h1', 'section_1', 'text_1', 'h2', 'divider_1']);
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    // The new section is selected, so the divider goes inside it.
    expect(order()).toEqual(['root_home', 'h1', 'section_1', 'text_1', 'divider_2', 'h2', 'divider_1']);
  });

  it('places a part this page cannot feed as not connected, says why in plain words, and keeps Save off', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    expect((await screen.findAllByText(/This app has no table yet\./)).length).toBeGreaterThan(0);
    expect(order()).toEqual(['root_home', 'h1', 'h2', 'datatable_1']);
    expect(saveButton().disabled).toBe(true);
  });

  it('Escape in the shelf cancels the chosen place', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Page, place 1' }));
    const search = screen.getByRole('searchbox', { name: 'Search parts and features' });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByText(/Press Escape to cancel/)).toBeNull();
  });

  it.each([
    ['a block', () => block('h2')],
    ['the Undo button', () => screen.getByRole('button', { name: 'Undo' })],
    ['the shelf search', () => screen.getByRole('searchbox', { name: 'Search parts and features' })],
  ] as const)('Escape on %s cancels the chosen place', async (_label, target) => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Page, place 1' }));
    expect(screen.getByText(/Press Escape to cancel/)).toBeTruthy();
    fireEvent.keyDown(target(), { key: 'Escape' });
    expect(screen.queryByText(/Press Escape to cancel/)).toBeNull();
  });

  it('filters the shelf by search and category', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search parts and features' }), { target: { value: 'form' } });
    expect(screen.getByRole('button', { name: 'Add Form' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Divider line' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search parts and features' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: /^Actions \(\d/ }));
    expect(screen.getByRole('button', { name: 'Add Link' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Divider line' })).toBeNull();
  });

  it('shelf: finds a part by a keyword, shows counts and Escape clears the search first', async () => {
    mount(harness());
    await screen.findByText('Home heading');
    expect(screen.getByRole('radio', { name: /^Navigation \(\d/ })).toBeTruthy();
    const box = screen.getByRole('searchbox', { name: 'Search parts and features' }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'spreadsheet' } });
    expect(screen.getByRole('button', { name: 'Add Table of records' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: /^Records \(1\)$/ })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
  });

  describe('moving and removing', () => {
    it('moves a block with the toolbar and with Alt+Arrow, and keeps the focus on it', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Move down' }));
      expect(order()).toEqual(['root_home', 'h2', 'h1']);
      await waitFor(() => expect(document.activeElement).toBe(block('h1')));
      fireEvent.keyDown(block('h1'), { key: 'ArrowUp', altKey: true });
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
      fireEvent.keyDown(block('h1'), { key: 'ArrowUp', altKey: true });
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
    });

    it('deletes with the toolbar or the Delete key, announces it, and Undo brings it back', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      expect(order()).toEqual(['root_home', 'h2']);
      const status = screen.getByText('Removed Heading.');
      expect(status.closest('[role=status]')).toBeTruthy();
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(within(status.closest('[role=status]') as HTMLElement).getByRole('button', { name: 'Undo' }));
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
      await waitFor(() => expect(saveButton().disabled).toBe(true));
      select('h2');
      fireEvent.keyDown(block('h2'), { key: 'Delete' });
      expect(order()).toEqual(['root_home', 'h1']);
    });

    it('never offers to move or remove the page itself', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('root_home');
      expect(screen.queryByRole('toolbar')).toBeNull();
      fireEvent.keyDown(block('root_home'), { key: 'Delete' });
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
    });

    it('Escape clears the selection', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('h1');
      expect(screen.queryByRole('toolbar')).toBeTruthy();
      fireEvent.keyDown(block('h1'), { key: 'Escape' });
      expect(screen.queryByRole('toolbar')).toBeNull();
    });

    it('undoes and redoes through the toolbar', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
      const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
      expect(undo.disabled).toBe(true);
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Move down' }));
      expect(order()).toEqual(['root_home', 'h2', 'h1']);
      fireEvent.click(undo);
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
      expect(redo.disabled).toBe(false);
      fireEvent.click(redo);
      expect(order()).toEqual(['root_home', 'h2', 'h1']);
    });
  });

  describe('tabs', () => {
    const tabsSpec = (): AppSpec => {
      const spec = makeSpec();
      spec.pages[0].layout = layer('root_home', 'Page', {}, [layer('tabs_a', 'Tabs', {}, [layer('tab_a', 'Tab', { label: 'First' }, [layer('t_a', 'Text', {}, 'Hello')])])]);
      return spec;
    };

    it('adds a tab from the Tabs toolbar, selects it, and Undo takes it back', async () => {
      mount(harness(), undefined, tabsSpec);
      await waitFor(() => block('tabs_a'));
      select('tabs_a');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Add a tab' }));
      await waitFor(() => expect(order()).toContain('tab_1'));
      expect(order().slice(0, 3)).toEqual(['root_home', 'tabs_a', 'tab_a']);
      await waitFor(() => expect(document.activeElement).toBe(block('tab_1')));
      // The toolbar's Undo comes first; the status line has one too.
      fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
      expect(order()).not.toContain('tab_1');
    });

    it('offers no Add a tab on other parts', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('h1');
      expect(within(toolbar()).queryByRole('button', { name: 'Add a tab' })).toBeNull();
    });
  });

});
