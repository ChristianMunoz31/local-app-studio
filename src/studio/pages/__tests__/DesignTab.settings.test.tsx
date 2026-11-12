// Split from DesignTab.test.tsx by describe block (phase 27): settings, the chrome and Move to, Save as feature, opening from Features. The mocks, builders and hooks are in designTabHarness.tsx.
import { layer, makeSpec, dataSpec, mount, harness, saveButton, block, select, toolbar, order, installDesignTabHooks } from './designTabHarness';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';

installDesignTabHooks();

describe('DesignTab', () => {
  describe('settings', () => {
    it('edits a text in plain words from a popover and closes it with Escape back to the Settings button', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('h1');
      const settings = within(toolbar()).getByRole('button', { name: 'Settings' });
      fireEvent.click(settings);
      const popover = screen.getByRole('dialog', { name: 'Settings for Heading' });
      const box = within(popover).getByLabelText('Text') as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: 'Welcome' } });
      fireEvent.click(within(popover).getByRole('button', { name: 'Apply' }));
      expect(await screen.findByText('Welcome')).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'Settings for Heading' })).toBeNull();
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings for Heading' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Settings for Heading' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(within(toolbar()).getByRole('button', { name: 'Settings' })));
    });

    it('picks a table list by the table name, never by its id, and shows the problem when a value is refused', async () => {
      mount(harness(), undefined, dataSpec);
      await screen.findAllByRole('group', { name: 'Table of records' });
      select('t1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Table of records' });
      const list = within(popover).getByLabelText('Table') as HTMLSelectElement;
      expect([...list.options].map((o) => o.textContent)).toEqual(['Crews', 'People', 'Crews (another list)', 'People (another list)']);
      expect(popover.textContent).not.toMatch(/all_crews|all_people|className/);
      fireEvent.change(list, { target: { value: 'all_people' } });
      fireEvent.click(within(popover).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says when a part has no settings', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Divider line' });
      expect(within(popover).getByText('Width')).toBeTruthy();
      expect(within(popover).getByText('No other settings.')).toBeTruthy();
      expect(within(popover).queryByText('Nothing to set for this part.')).toBeNull();
    });

    it('still says a part that cannot be sized has nothing to set', async () => {
      const spec = makeSpec();
      spec.pages[0] = {
        ...spec.pages[0],
        layout: layer('root_home', 'Page', {}, [
          layer('h1', 'Heading', { size: 'lg' }, 'Home heading'),
          layer('grid', 'Grid', { columns: 2 }, [layer('d1', 'Divider', {})]),
        ]),
      };
      mount(harness(), undefined, () => spec);
      await screen.findByText('Home heading');
      select('d1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Divider line' });
      expect(within(popover).getByText('Nothing to set for this part.')).toBeTruthy();
      expect(within(popover).queryByText('Width')).toBeNull();
    });
  });

  describe('chrome and Move to', () => {
    const nested = (): AppSpec => {
      const spec = makeSpec();
      spec.pages[0] = {
        ...spec.pages[0],
        layout: layer('root_home', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Home heading'), layer('sec', 'Section', {}, [layer('h2', 'Heading', { size: 'md' }, 'Inner heading')])]),
      };
      return spec;
    };

    it('draws the toolbar, the settings popover and Add here outside the theme scope, so they keep the kit theme', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      const scope = screen.getByTestId('design-canvas');
      const chrome = screen.getByTestId('design-chrome');
      const popover = await screen.findByRole('dialog', { name: 'Settings for Heading' });
      const addHere = screen.getByRole('button', { name: 'Add here: Page, place 2' });
      for (const el of [toolbar(), popover, addHere]) {
        expect(scope.contains(el)).toBe(false);
        expect(chrome.contains(el)).toBe(true);
      }
      expect(scope.contains(block('h1'))).toBe(true);
    });

    it('moves a block into another container with Move to..., in plain words, and returns the focus to it', async () => {
      mount(harness(), undefined, nested);
      await screen.findByText('Inner heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Move to...' }));
      const menu = screen.getByRole('group', { name: 'Move Heading to' });
      expect(within(menu).getByRole('button', { name: 'Section, place 1' })).toBeTruthy();
      expect(within(menu).getByRole('button', { name: 'Section, place 2' })).toBeTruthy();
      fireEvent.click(within(menu).getByRole('button', { name: 'Section, place 2' }));
      expect(order()).toEqual(['root_home', 'sec', 'h2', 'h1']);
      expect(screen.getByText('Moved Heading to Section, place 2.')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Move Heading to' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(block('h1')));
    });

    it('Move to... is a button that opens a group: haspopup true, controls and expanded', async () => {
      mount(harness(), undefined, nested);
      await screen.findByText('Inner heading');
      select('h1');
      const button = within(toolbar()).getByRole('button', { name: 'Move to...' });
      expect(button.getAttribute('aria-haspopup')).toBe('true');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBeNull();
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const group = screen.getByRole('group', { name: 'Move Heading to' });
      expect(button.getAttribute('aria-controls')).toBe(group.id);
    });

    it('closes the Move to... list with Escape and puts the focus back on its button', async () => {
      mount(harness(), undefined, nested);
      await screen.findByText('Inner heading');
      select('h1');
      const button = within(toolbar()).getByRole('button', { name: 'Move to...' });
      fireEvent.click(button);
      fireEvent.keyDown(screen.getByRole('group', { name: 'Move Heading to' }), { key: 'Escape' });
      expect(screen.queryByRole('group', { name: 'Move Heading to' })).toBeNull();
      expect(document.activeElement).toBe(button);
      expect(order()).toEqual(['root_home', 'h1', 'sec', 'h2']);
    });

    it('Move to... numbers the places without gaps, marks the current one (here), and opens with Enter and with Space (P-30)', async () => {
      mount(harness(), undefined, nested);
      await screen.findByText('Inner heading');
      select('h1');
      for (const key of ['Enter', ' ']) {
        fireEvent.keyDown(screen.getByRole('button', { name: 'Drag to move Heading' }), { key });
        const menu = screen.getByRole('group', { name: 'Move Heading to' });
        expect(within(menu).getByText('Moving Heading. Pick a place.')).toBeTruthy();
        expect(within(menu).getByText('Page, place 1 (here)')).toBeTruthy();
        expect(within(menu).getByRole('button', { name: 'Page, place 2' })).toBeTruthy();
        expect(within(menu).queryByRole('button', { name: 'Page, place 1' })).toBeNull();
        fireEvent.keyDown(menu, { key: 'Escape' });
        expect(screen.queryByRole('group', { name: 'Move Heading to' })).toBeNull();
      }
    });

    it('says what a move did, and Undo and Redo say it again with the way back, once each (P-23)', async () => {
      mount(harness(), undefined, nested);
      await screen.findByText('Inner heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Move down' }));
      expect(screen.getByText('Moved Heading down.')).toBeTruthy();
      fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
      expect(screen.getByText('Undid: moved Heading down.')).toBeTruthy();
      expect(screen.queryByText('Moved Heading down.')).toBeNull();
      const status = screen.getByText('Undid: moved Heading down.').closest<HTMLElement>('[role="status"]');
      if (status === null) throw new Error('no status line');
      fireEvent.click(within(status).getByRole('button', { name: 'Redo' }));
      expect(screen.getByText('Redid: moved Heading down.')).toBeTruthy();
      expect(screen.getAllByText(/^Redid: /)).toHaveLength(1);
    });

    it('offers no Move to... when there is nowhere else to go', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
      await screen.findByText('About heading');
      select('h3');
      expect(within(toolbar()).queryByRole('button', { name: 'Move to...' })).toBeNull();
    });
  });

  describe('Save as feature', () => {
    it('is on for a selected part and off for the page itself', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      const save = screen.getByRole('button', { name: 'Save as feature' }) as HTMLButtonElement;
      // Always on: with nothing selected it says what to do in the status line.
      expect(save.disabled).toBe(false);
      fireEvent.click(save);
      expect(screen.getByText('Select a part on the page first, then press Save as feature.')).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'Save as feature' })).toBeNull();
      select('root_home');
      fireEvent.click(save);
      expect(screen.queryByRole('dialog', { name: 'Save as feature' })).toBeNull();
      select('h1');
      fireEvent.click(save);
      expect(await screen.findByRole('dialog', { name: 'Save as feature' })).toBeTruthy();
    });
  });

  describe('opening from the Features page', () => {
    it('selects the tile it came with and says how to place it', async () => {
      mount(harness(), undefined, undefined, { addEntry: 'part:StatCard' });
      await screen.findByText('Home heading');
      expect(screen.getByText('Drag Number tile onto the page, or use Add here.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Select Number tile' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('ignores a key it does not know', async () => {
      mount(harness(), undefined, undefined, { addEntry: 'part:Nope' });
      await screen.findByText('Home heading');
      expect(screen.queryByText(/onto the page, or use Add here/)).toBeNull();
    });
  });

});
