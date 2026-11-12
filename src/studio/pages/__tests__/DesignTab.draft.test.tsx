// Split from DesignTab.test.tsx by describe block (phase 27): feature blocks, the draft Design registers, Ctrl+S and the slash key. The mocks, builders and hooks are in designTabHarness.tsx.
import { layer, makeSpec, draft, nextBlocked, announced, mount, harness, saveButton, block, select, toolbar, order, installDesignTabHooks } from './designTabHarness';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppSpec, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { featuresApi } from '../../services/studioApi';
import { recordOf as featureRecord, seedRecords } from '../../components/__tests__/featureFixtures';
import { boardDef, boardLibrary } from '../../lib/__tests__/boardFeature';
import { expandFeature } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';

installDesignTabHooks();

describe('DesignTab', () => {
  describe('feature blocks', () => {
    const withBlock = (): AppSpec => {
      const spec = makeSpec();
      const blockLayer: LayoutLayer = { ...layer('blk', 'Section', {}, [layer('blk_h', 'Heading', {}, 'Inside')]), name: 'Number row', feature: { id: 'kpi_row', version: 1, params: {} } };
      spec.pages[0] = { ...spec.pages[0], layout: layer('root_home', 'Page', {}, [blockLayer]) };
      return spec;
    };

    it('is one block: its parts cannot be picked, and the page cannot be dropped into it', async () => {
      mount(harness(), undefined, withBlock);
      await screen.findByText('Inside');
      expect(order()).toEqual(['root_home', 'blk']);
      select('blk');
      expect(screen.queryByRole('button', { name: /Add here: Number row/ })).toBeNull();
    });

    it('offers Update to latest when outdated, and Detach keeps the parts', async () => {
      const newer = seedRecords().map((r) => (r.id === 'kpi_row' ? { ...r, version: 2 } : r));
      vi.spyOn(featuresApi, 'list').mockResolvedValue(newer);
      mount(harness(), undefined, withBlock);
      await screen.findByText('Inside');
      select('blk');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      const popover = await screen.findByRole('dialog', { name: 'Settings for Number row' });
      await within(popover).findByRole('button', { name: 'Update to latest' });
      expect(within(popover).getByText('A newer version is in your library.')).toBeTruthy();
      fireEvent.click(within(popover).getByRole('button', { name: 'Turn into plain parts' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings for Number row' })).toBeNull());
      expect(screen.getByText('Inside')).toBeTruthy();
      await waitFor(() => expect(saveButton().disabled).toBe(false));
    });

    describe('a block of an older version of a feature with a new words setting (P17-06, P17-07, P17-26)', () => {
      /** Crews (Name, Status) with a list on the home page, and the Status board at version 1 placed on it with its own values. */
      const boardApp = (): AppSpec => {
        const spec = makeSpec();
        spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', required: false, options: ['Open', 'Closed'] }] }];
        spec.pages[0] = { ...spec.pages[0], sources: [{ id: 'all_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }] };
        const ctx = partContextFor(spec, spec.pages[0]);
        const values = { things: 'crews', things_list: 'all_crews', status: 'status', title_field: 'name', board_title: 'Status board' };
        const placed = expandFeature(boardDef(1), values, ctx, boardLibrary(boardDef(1)), { rootId: 'board' });
        if (!placed.ok) throw new Error(JSON.stringify(placed.issues));
        spec.pages[0] = { ...spec.pages[0], layout: layer('root_home', 'Page', {}, [placed.value]) };
        return spec;
      };
      const newest = () => vi.spyOn(featuresApi, 'list').mockResolvedValue([featureRecord(boardDef(2, true))]);

      it('shows a Newer version pill on the block and a line in the page strip, and the pill opens its settings', async () => {
        newest();
        mount(harness(), undefined, boardApp);
        const pill = await screen.findByRole('button', { name: 'Newer version. Open settings' });
        expect(screen.getByText('1 feature on this page has a newer version.')).toBeTruthy();
        fireEvent.click(pill);
        expect(await screen.findByRole('dialog', { name: 'Settings for Status board' })).toBeTruthy();
      });

      it('shows one choice for the slot, in the app words, and Update to latest fills the new words, places version 2 and says so', async () => {
        newest();
        mount(harness(), undefined, boardApp);
        await screen.findByRole('button', { name: 'Newer version. Open settings' });
        select('board');
        fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
        const popover = await screen.findByRole('dialog', { name: 'Settings for Status board' });
        expect(within(popover).queryByLabelText('Things to track list')).toBeNull();
        expect(Array.from((within(popover).getByLabelText('Things to track') as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Crews']);
        expect((within(popover).getByLabelText('Chart title') as HTMLInputElement).value).toBe('Crews by Status');
        fireEvent.click(within(popover).getByRole('button', { name: 'Update to latest' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings for Status board' })).toBeNull());
        expect(screen.getByText('Updated Status board to the latest version.')).toBeTruthy();
        expect(screen.queryByText(/needs a value/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Newer version. Open settings' })).toBeNull();
        expect(screen.queryByText('1 feature on this page has a newer version.')).toBeNull();
      });

      it('says "Fill in <label>." in plain words, never an id, when a setting is empty (P17-07)', async () => {
        newest();
        mount(harness(), undefined, boardApp);
        await screen.findByRole('button', { name: 'Newer version. Open settings' });
        select('board');
        fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
        const popover = await screen.findByRole('dialog', { name: 'Settings for Status board' });
        fireEvent.change(within(popover).getByLabelText('Chart title'), { target: { value: '' } });
        fireEvent.click(within(popover).getByRole('button', { name: 'Apply' }));
        expect(within(popover).getByRole('alert').textContent).toContain('Fill in: Chart title.');
        expect(popover.textContent).not.toMatch(/chart_title|needs a value/);
      });
    });

    it('says when the feature is gone from the library, and its parts still work', async () => {
      vi.spyOn(featuresApi, 'list').mockResolvedValue([]);
      mount(harness(), undefined, withBlock);
      await screen.findByText('Inside');
      select('blk');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      expect(await screen.findByText('This feature is not in your library. Its parts still work.')).toBeTruthy();
    });
  });

  describe('the draft Design registers with the workspace', () => {
    it('registers on mount and clears when Design goes away', async () => {
      const view = mount(harness());
      await screen.findByText('Home heading');
      expect(draft).not.toBeNull();
      expect(draft?.saveBlocked).toBeNull();
      expect(nextBlocked()).toBeNull();
      view.unmount();
      expect(draft).toBeNull();
    });

    it('Discard: reset() throws the unsaved Design edits away, so the screen shows what is saved (V-5)', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      expect(order()).toEqual(['root_home', 'h2']);
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      expect(draft?.reset).toBeTypeOf('function');
      act(() => draft?.reset?.());
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
      await waitFor(() => expect(saveButton().disabled).toBe(true));
      await expect(draft?.save()).resolves.toEqual({ ok: true });
      expect(h.saves).toHaveLength(0);
    });

    it('Discard goes back to the last save, not to how the page was first opened', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      await waitFor(() => expect(saveButton().disabled).toBe(true));
      select('h2');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      expect(order()).toEqual(['root_home']);
      act(() => draft?.reset?.());
      expect(order()).toEqual(['root_home', 'h2']);
    });

    it('saves from the values it captured after Design has gone, and sets no state then', async () => {
      const h = harness();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const view = mount(h);
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      const kept = draft;
      view.unmount();
      expect(draft).toBeNull();
      await expect(kept?.save()).resolves.toEqual({ ok: true });
      expect(h.saves).toHaveLength(1);
      expect(h.saves[0].pages[0].layout.children).toHaveLength(1);
      // reset() on a session that is gone does nothing.
      expect(() => kept?.reset?.()).not.toThrow();
      expect(errors).not.toHaveBeenCalled();
    });

    it('a refused save after Design has gone answers the reason and sets no state', async () => {
      const h = harness();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const view = mount(h, () => ({ ok: false, code: 'error', message: 'The server said no.', issues: [] }));
      await screen.findByText('Home heading');
      select('h1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      const kept = draft;
      view.unmount();
      await expect(kept?.save()).resolves.toEqual({ ok: false, reason: 'The server said no.' });
      expect(errors).not.toHaveBeenCalled();
    });

    it('a save that throws ends as a failed save: the session is not stuck on Saving and the next save works (V4-7)', async () => {
      let thrown = false;
      const h = harness();
      mount(h, () => {
        if (thrown) return null;
        thrown = true;
        throw new Error('boom');
      });
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      let outcome: unknown;
      await act(async () => {
        outcome = await draft?.save();
      });
      expect(outcome).toEqual({ ok: false, reason: 'Could not save. Your changes are still here. Try again.' });
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      await act(async () => {
        outcome = await draft?.save();
      });
      expect(outcome).toEqual({ ok: true });
    });

    it('saves nothing when nothing changed', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      await expect(draft?.save()).resolves.toEqual({ ok: true });
      expect(h.saves).toHaveLength(0);
    });

    it('saves the edited page layout when asked, and says it is done', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      let outcome: unknown;
      await act(async () => {
        outcome = await draft?.save();
      });
      expect(outcome).toEqual({ ok: true });
      expect(h.saves).toHaveLength(1);
      expect((h.saves[0].pages[0].layout.children as LayoutLayer[]).map((c) => c.id)).toEqual(['h1', 'h2', 'divider_1']);
      await waitFor(() => expect(saveButton().disabled).toBe(true));
    });

    it('answers with the reason and shows the issues when the save is refused', async () => {
      const issue: SpecIssue = { path: 'pages.0.layout', code: 'invalid_props', message: 'Heading: bad size.' };
      mount(harness(), () => ({ ok: false, code: 'invalid_spec', message: 'Heading: bad size.', issues: [issue] }));
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      let outcome: unknown;
      await act(async () => {
        outcome = await draft?.save();
      });
      expect(outcome).toEqual({ ok: false, reason: 'Heading: bad size.' });
      expect(await screen.findByText('Page Home: Heading: bad size.', { selector: 'li' })).toBeTruthy();
    });

    it('has no Next button and a secondary Save: the rail owns moving on', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
      expect(saveButton().className).not.toContain('bg-slate-brand');
      expect(saveButton().title).toBe('No changes to save.');
    });

    it('has no status text of its own: the header says the save state', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      expect(screen.queryByText('Unsaved changes')).toBeNull();
      expect(screen.queryByText('Saved')).toBeNull();
    });
  });

  describe('Ctrl+S, the slash key and the skip link', () => {
    it('Ctrl+S saves the page, also while typing in the shelf search', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      const search = screen.getByRole('searchbox', { name: 'Search parts and features' });
      search.focus();
      fireEvent.keyDown(search, { key: 's', ctrlKey: true });
      await waitFor(() => expect(h.saves).toHaveLength(1));
    });

    it('Ctrl+S and Ctrl+Z work with the focus on the page body (after a step change it is on the heading)', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      expect(order()).toHaveLength(4);
      (document.activeElement as HTMLElement | null)?.blur();
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
      fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
      expect(order()).toHaveLength(4);
      fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
      await waitFor(() => expect(h.saves).toHaveLength(1));
    });

    it('Ctrl+S never opens the browser Save page dialog, also while a modal dialog is open (V2-8)', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      const modal = document.createElement('div');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);
      expect(fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })).toBe(false);
      expect(h.saves).toHaveLength(0);
      modal.remove();
    });

    it('Ctrl+S says why when it does nothing', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
      expect(h.saves).toHaveLength(0);
      expect(announced).toContain('Nothing to save.');
    });

    it('the keys wait while a dialog is open: Ctrl+Z on its button does not undo the page behind it', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      select('h1');
      fireEvent.click(screen.getByRole('button', { name: 'Save as feature' }));
      const dialog = await screen.findByRole('dialog');
      const before = order();
      fireEvent.keyDown(within(dialog).getAllByRole('button')[0], { key: 'z', ctrlKey: true });
      expect(order()).toEqual(before);
    });

    it('Ctrl+S does nothing when nothing changed', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.keyDown(block('h1'), { key: 's', ctrlKey: true });
      expect(h.saves).toHaveLength(0);
    });

    it('/ goes to the search of the shelf, from the Look tab too, but not while typing', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
      fireEvent.keyDown(document.body, { key: '/' });
      const search = await screen.findByRole('searchbox', { name: 'Search parts and features' });
      await waitFor(() => expect(document.activeElement).toBe(search));
      // Typing a slash in the box stays a slash.
      const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
      search.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('after /, switching the shelf tab with the arrow keys keeps the focus on the tabs', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.keyDown(document.body, { key: '/' });
      const search = await screen.findByRole('searchbox', { name: 'Search parts and features' });
      await waitFor(() => expect(document.activeElement).toBe(search));
      const features = screen.getByRole('tab', { name: 'Features' });
      features.focus();
      fireEvent.keyDown(features, { key: 'ArrowRight' });
      const look = await screen.findByRole('tab', { name: 'Look' });
      await waitFor(() => expect(document.activeElement).toBe(look));
      fireEvent.keyDown(look, { key: 'ArrowLeft' });
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Features' }).getAttribute('aria-selected')).toBe('true'));
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Features' }));
    });

    it('Go to the page comes first and sends the focus to the first part', async () => {
      // With a table the page has no "Start with your tables on Data" line above the toolbar.
      const withTable = (): AppSpec => {
        const spec = makeSpec();
        spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
        return spec;
      };
      mount(harness(), undefined, withTable);
      await screen.findByText('Home heading');
      const skip = screen.getByRole('link', { name: 'Go to the page' });
      const everything = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex="0"]'));
      expect(everything[0]).toBe(skip);
      fireEvent.click(skip);
      expect(document.activeElement).toBe(block('h1'));
    });

    it('says what to do on a page with one part, and not on a full page', async () => {
      const lone = (): AppSpec => {
        const spec = makeSpec();
        spec.pages[0] = { ...spec.pages[0], layout: layer('root_home', 'Page', {}, [layer('h1', 'Heading', {}, 'Only')]) };
        return spec;
      };
      mount(harness(), undefined, lone);
      await screen.findByText('Only');
      expect(screen.getByText('Add parts from the shelf: drag one onto the page, or press its Add button.')).toBeTruthy();
      cleanup();
      mount(harness());
      await screen.findByText('Home heading');
      expect(screen.queryByText('Add parts from the shelf: drag one onto the page, or press its Add button.')).toBeNull();
    });
  });

});
