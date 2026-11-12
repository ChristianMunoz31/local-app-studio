// Split from DesignTab.test.tsx by describe block (phase 27): data parts, canvas rows of an example, after a Save, connections to tables. The mocks, builders and hooks are in designTabHarness.tsx.
import { preview, source, sampleApi, layer, makeSpec, dataSpec, draft, nextBlocked, Workspace, mount, harness, saveButton, block, select, toolbar, order, installDesignTabHooks } from './designTabHarness';
import type { Harness } from './designTabHarness';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { PreviewStatus } from '../../types';
import DesignTab from '../DesignTab';

installDesignTabHooks();

describe('DesignTab', () => {
  describe('data parts', () => {
    it('shows the preview rows while the preview runs this revision of this app', async () => {
      preview.status = { state: 'running', appId: 'app-1', revision: 1, startedAt: null, message: null, data: null };
      mount(harness(), undefined, dataSpec);
      expect(await screen.findByText('Alpha crew')).toBeTruthy();
      expect(source.list).toHaveBeenCalled();
    });

    it('draws sample rows of the app tables while the preview is stopped, running another app or an older revision', async () => {
      for (const status of [
        null,
        { state: 'stopped', appId: null, revision: null, startedAt: null, message: null, data: null },
        { state: 'running', appId: 'other', revision: 1, startedAt: null, message: null, data: null },
        { state: 'running', appId: 'app-1', revision: 0, startedAt: null, message: null, data: null },
      ] as Array<PreviewStatus | null>) {
        preview.status = status;
        const view = mount(harness(), undefined, dataSpec);
        expect((await screen.findAllByText(/^Name \d$/)).length).toBeGreaterThan(0);
        view.unmount();
      }
      expect(source.list).not.toHaveBeenCalled();
    });

    it('B5: the canvas swaps sample rows for the preview rows when the status turns running, without a page switch', async () => {
      const view = mount(harness(), undefined, dataSpec);
      expect((await screen.findAllByText(/^Name \d$/)).length).toBeGreaterThan(0);
      expect(screen.getByTestId('data-note').textContent).toBe('Showing sample rows. Your Preview data shows here while Preview runs.');
      preview.status = { state: 'running', appId: 'app-1', revision: 1, startedAt: null, message: null, data: null };
      view.rerender(
        <MemoryRouter initialEntries={[{ pathname: '/apps/app-1/design' }]}>
          <Workspace h={harness()} initial={dataSpec}>
            <DesignTab />
          </Workspace>
        </MemoryRouter>,
      );
      expect(await screen.findByText('Alpha crew')).toBeTruthy();
      expect(screen.getByTestId('data-note').textContent).toBe('Showing your Preview data (read only).');
    });
  });

  describe('canvas rows of an example', () => {
    const recordSpec = (): AppSpec => {
      const spec = dataSpec();
      spec.pages[0] = {
        ...spec.pages[0],
        route: '/crews/:id',
        sources: [{ id: 'one_crew', table: 'crews', mode: 'record', where: [], orderBy: [], limit: 1 }],
        layout: layer('root_home', 'Page', {}, [layer('d1', 'RecordDetail', { source: 'one_crew' })]),
      };
      return spec;
    };

    it('G-06: shows the stored sample records while Preview shows none, and says so', async () => {
      sampleApi.get.mockResolvedValue({ v: 1, tables: { crews: [{ name: 'Mara Quill' }] } });
      mount(harness(), undefined, dataSpec);
      expect(await screen.findByText('Mara Quill')).toBeTruthy();
      expect(within(document.getElementById('design-page') as HTMLElement).queryByText('Name 1')).toBeNull();
      expect(screen.getByTestId('data-note').textContent).toBe('Showing the sample records of this example. Your Preview data shows here while Preview runs.');
    });

    it('G-06: the live Preview rows win over the sample, and a record page asks for the first real id', async () => {
      sampleApi.get.mockResolvedValue({ v: 1, tables: { crews: [{ name: 'Mara Quill' }] } });
      preview.status = { state: 'running', appId: 'app-1', revision: 1, startedAt: null, message: null, data: null };
      mount(harness(), undefined, recordSpec);
      await waitFor(() => expect(source.get).toHaveBeenCalledWith('crews', 'r1'));
      expect(source.get).not.toHaveBeenCalledWith('crews', 'crews_1');
      expect(screen.queryByText('Mara Quill')).toBeNull();
    });

    it('G-06: a Save that restarts Preview keeps the last rows instead of the made-up ones', async () => {
      preview.status = { state: 'running', appId: 'app-1', revision: 1, startedAt: null, message: null, data: null };
      const view = mount(harness(), undefined, dataSpec);
      expect(await screen.findByText('Alpha crew')).toBeTruthy();
      preview.status = { state: 'starting', appId: 'app-1', revision: 2, startedAt: null, message: null, data: null };
      view.rerender(
        <MemoryRouter initialEntries={[{ pathname: '/apps/app-1/design' }]}>
          <Workspace h={harness()} initial={dataSpec}>
            <DesignTab />
          </Workspace>
        </MemoryRouter>,
      );
      expect(within(document.getElementById('design-page') as HTMLElement).queryAllByText(/^Name \d$/)).toHaveLength(0);
      expect(screen.getByText('Alpha crew')).toBeTruthy();
      expect(screen.getByTestId('data-note').textContent).toBe('Showing your Preview data (read only).');
    });
  });

  describe('after a Save (H-2)', () => {
    const rerenderTab = (view: ReturnType<typeof mount>): void =>
      view.rerender(
        <MemoryRouter initialEntries={[{ pathname: '/apps/app-1/design' }]}>
          <Workspace h={harness()} initial={dataSpec}>
            <DesignTab />
          </Workspace>
        </MemoryRouter>,
      );
    const running = (revision: number, startedAt: string): PreviewStatus => ({ state: 'running', appId: 'app-1', revision, startedAt, message: null, data: null });

    it('asks nothing of the old child on a stale revision, then loads again from the new child with its rows', async () => {
      preview.status = running(1, 'A');
      const view = mount(harness(), undefined, dataSpec);
      expect(await screen.findByText('Alpha crew')).toBeTruthy();
      const calls = source.list.mock.calls.length;
      // Save: the workspace is at revision 2 while Preview still reports the old child.
      preview.revision = 2;
      rerenderTab(view);
      await act(async () => {});
      expect(source.list.mock.calls.length).toBe(calls);
      expect(screen.getByText('Alpha crew')).toBeTruthy();
      // The new child comes up with new rows.
      source.list.mockImplementation(async () => ({ rows: [{ id: 'r9', name: 'Beta crew' }], total: 1 }));
      try {
        preview.status = running(2, 'B');
        rerenderTab(view);
        expect(await screen.findByText('Beta crew')).toBeTruthy();
        expect(source.list.mock.calls.length).toBeGreaterThan(calls);
        expect(screen.queryByText('Alpha crew')).toBeNull();
      } finally {
        source.list.mockImplementation(async () => ({ rows: [{ id: 'r1', name: 'Alpha crew' }], total: 1 }));
      }
    });

    it('serves the kept answer when the preview proxy says the child is down (preview_unavailable), but shows a not_found as it is', async () => {
      // An empty answer is kept, so a served kept answer shows no error line while a refused one shows its message (a table with rows keeps them either way).
      source.list.mockImplementation(async () => ({ rows: [], total: 0 }));
      preview.status = running(1, 'A');
      const view = mount(harness(), undefined, dataSpec);
      await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
      await act(async () => {});
      try {
        source.list.mockImplementation(async () => {
          throw Object.assign(new Error('Preview is not answering.'), { code: 'preview_unavailable' });
        });
        preview.status = running(1, 'B');
        rerenderTab(view);
        await waitFor(() => expect(source.list).toHaveBeenCalledTimes(2));
        await act(async () => {});
        expect(screen.queryByText('Preview is not answering.')).toBeNull();
        source.list.mockImplementation(async () => {
          throw Object.assign(new Error('Crews was not found.'), { code: 'not_found' });
        });
        preview.status = running(1, 'C');
        rerenderTab(view);
        expect(await screen.findByText('Crews was not found.')).toBeTruthy();
      } finally {
        source.list.mockImplementation(async () => ({ rows: [{ id: 'r1', name: 'Alpha crew' }], total: 1 }));
      }
    });

    it('reads as loading, not as an error, when Preview is starting and no kept answer exists', async () => {
      preview.status = running(1, 'A');
      source.list.mockImplementation(() => new Promise(() => undefined));
      const view = mount(harness(), undefined, dataSpec);
      try {
        await waitFor(() => expect(source.list).toHaveBeenCalled());
        preview.status = { state: 'starting', appId: 'app-1', revision: 2, startedAt: null, message: null, data: null };
        rerenderTab(view);
        await act(async () => {});
        expect(screen.queryByText(/Preview is starting/)).toBeNull();
        expect(screen.queryByText(/Something went wrong/)).toBeNull();
        expect(screen.queryByText(/Couldn't load/)).toBeNull();
      } finally {
        source.list.mockImplementation(async () => ({ rows: [{ id: 'r1', name: 'Alpha crew' }], total: 1 }));
      }
    });
  });

  describe('connections to tables', () => {
    const crewsTable = { id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text' as const, required: true }] };
    const peopleTable = { id: 'people', label: 'People', fields: [{ id: 'name', label: 'Name', type: 'text' as const, required: true }] };
    const crewsSource = { id: 'all_crews', table: 'crews', mode: 'list' as const, where: [], orderBy: [], limit: 50 };

    /** Two tables and a Home page with no list: a Table of records has two tables to choose from. */
    const twoTables = (): AppSpec => {
      const spec = makeSpec();
      spec.tables = [crewsTable, peopleTable];
      return spec;
    };
    /** One table: a Table of records gets a list of it made on drop. */
    const oneTable = (): AppSpec => {
      const spec = makeSpec();
      spec.tables = [crewsTable];
      return spec;
    };
    /** Home lists Crews and has a Quick add that adds to People (a part Describe could make). */
    const otherTable = (): AppSpec => {
      const spec = makeSpec();
      spec.tables = [crewsTable, peopleTable];
      spec.pages[0] = {
        ...spec.pages[0],
        sources: [crewsSource],
        layout: layer('root_home', 'Page', {}, [layer('t1', 'DataTable', { source: 'all_crews', columns: ['name'] }), layer('q1', 'QuickAdd', { table: 'people', field: 'name', placeholder: 'New person' })]),
      };
      return spec;
    };
    const undoFromNotice = (text: string): void => {
      const notice = screen.getByText(text).closest<HTMLElement>('[role="status"]');
      if (notice === null) throw new Error('no status line');
      fireEvent.click(within(notice).getByRole('button', { name: 'Undo' }));
    };
    const badgeOf = (id: string): string | null => block(id).querySelector('[data-connection-badge]')?.textContent?.replace(/\. Change table$/, '') ?? null;

    it('shows the table of a data block on the block and at the top of its settings', async () => {
      mount(harness(), undefined, dataSpec);
      await screen.findAllByRole('group', { name: 'Table of records' });
      expect(badgeOf('t1')).toBe('Connected to Crews');
      select('t1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Settings' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Table of records' });
      expect(popover.querySelector('[data-connection-badge]')?.textContent).toBe('Connected to Crews');
      expect(screen.queryByRole('region', { name: 'Data connections' })).toBeNull();
    });

    it('gives a heading no badge', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      expect(document.querySelector('[data-connection-badge]')).toBeNull();
    });

    it('with one fitting table makes a list on drop, in one step with the part, and saves it with the layout', async () => {
      const h = harness();
      mount(h, undefined, oneTable);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      expect(badgeOf('datatable_1')).toBe('Connected to Crews');
      expect(screen.getByText('Connected the Table of records to Crews. Added a list of Crews to this page.')).toBeTruthy();
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(h.saves[0].pages[0].sources).toEqual([expect.objectContaining({ id: 'crews', table: 'crews', mode: 'list' })]);
      expect((h.saves[0].pages[0].layout.children as LayoutLayer[]).at(-1)?.props.source).toBe('crews');
    });

    it('keeps a part added while the save of a new list was on its way: its own save does not start the page again (V3-4)', async () => {
      let release: () => void = () => undefined;
      const h: Harness = { ...harness(), gate: new Promise<void>((resolve) => (release = resolve)) };
      mount(h, undefined, oneTable);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(h.saves[0].pages[0].sources).toHaveLength(1);
      // Typed while the save is on its way.
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      expect(order()).toContain('divider_1');
      await act(async () => {
        release();
        await h.gate;
      });
      // The answer adds the list to the saved page; the part added since is still on the canvas and still unsaved.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).textContent).toBe('Save'));
      expect(order()).toContain('divider_1');
      expect(order()).toContain('datatable_1');
      expect(draft?.isDirty()).toBe(true);
      await waitFor(() => expect(saveButton().disabled).toBe(false));
    });

    it('Undo takes the part and the list it made away together', async () => {
      mount(harness(), undefined, oneTable);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      expect(order()).toContain('datatable_1');
      undoFromNotice('Connected the Table of records to Crews. Added a list of Crews to this page.');
      expect(order()).toEqual(['root_home', 'h1', 'h2']);
      // Nothing is left to save: the list went with the part.
      expect(saveButton().disabled).toBe(true);
    });

    it('with two fitting tables places the part not connected, opens its settings on the list and blocks Save and Next until a table is picked', async () => {
      const h = harness();
      mount(h, undefined, twoTables);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      expect(block('datatable_1').querySelector('[data-not-connected]')?.textContent).toContain('Needs a table');
      const popover = screen.getByRole('dialog', { name: 'Settings for Table of records' });
      const list = within(popover).getByLabelText('Table') as HTMLSelectElement;
      await waitFor(() => expect(document.activeElement).toBe(list));
      expect(list.selectedOptions[0].textContent).toBe('Pick one');
      expect(within(popover).getByText('Pick one below.')).toBeTruthy();
      expect(screen.getByText('Pick a table for the new Table of records.')).toBeTruthy();
      // The open page says it three times only: the box, the settings and the Save reason. No list entry (only Fix all), no red alert.
      const connections = screen.getByRole('region', { name: 'Data connections' });
      expect(within(connections).queryAllByRole('listitem')).toHaveLength(0);
      expect(within(connections).getByRole('button', { name: 'Fix all' })).toBeTruthy();
      expect(screen.queryByText(/has no source/)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(draft?.saveBlocked).toBe('Connect the parts that need a table, or delete them, to save.');
      expect(saveButton().disabled).toBe(true);
      expect(nextBlocked()).not.toBeNull();
      expect(screen.getAllByText('Connect the parts that need a table, or delete them, to save.').length).toBeGreaterThan(0);
      // The choices are words, never ids.
      expect([...list.options].map((o) => o.textContent)).toEqual(['Pick one', 'Crews', 'People']);

      // One rule (P-24): the pick is the whole job while the part has no table, so there is no Apply and no Apply sentence.
      expect(within(popover).queryByRole('button', { name: 'Apply' })).toBeNull();
      expect(within(popover).queryByText('Apply changes the page. Save keeps it.')).toBeNull();
      fireEvent.change(list, { target: { value: '@new:crews' } });
      expect(badgeOf('datatable_1')).toBe('Connected to Crews');
      expect(screen.queryByRole('region', { name: 'Data connections' })).toBeNull();
      expect(screen.getByText('Connected to Crews. Added a list of Crews to this page.')).toBeTruthy();
      await waitFor(() => expect(nextBlocked()).toBeNull());
      expect(saveButton().disabled).toBe(false);
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(h.saves[0].pages[0].sources.map((x) => x.table)).toEqual(['crews']);
    });

    it('Undo after connecting takes the list away and the part is not connected again', async () => {
      mount(harness(), undefined, twoTables);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Table of records' });
      fireEvent.change(within(popover).getByLabelText('Table'), { target: { value: '@new:crews' } });
      undoFromNotice('Connected to Crews. Added a list of Crews to this page.');
      expect(block('datatable_1').querySelector('[data-not-connected]')).not.toBeNull();
    });

    it('Connect on the block opens the settings on the list', async () => {
      mount(harness(), undefined, twoTables);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings for Table of records' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Connect Table of records to a table' }));
      const list = within(screen.getByRole('dialog', { name: 'Settings for Table of records' })).getByLabelText('Table');
      await waitFor(() => expect(document.activeElement).toBe(list));
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings for Table of records' }), { key: 'Escape' });
      // The block's own Connect works again after the popover closed.
      fireEvent.click(screen.getByRole('button', { name: 'Connect Table of records to a table' }));
      await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('dialog', { name: 'Settings for Table of records' })).getByLabelText('Table')));
    });

    it('has no Apply while nothing is chosen: Close leaves the part not connected (P-24)', async () => {
      mount(harness(), undefined, twoTables);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Table of records' });
      expect(within(popover).queryByRole('button', { name: 'Apply' })).toBeNull();
      fireEvent.click(within(popover).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Settings for Table of records' })).toBeNull();
      expect(block('datatable_1').querySelector('[data-not-connected]')).not.toBeNull();
    });

    it('takes the table at once when it is picked for a part that is not connected: one Undo step, no Apply', async () => {
      const h = harness();
      mount(h, undefined, twoTables);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      const popover = screen.getByRole('dialog', { name: 'Settings for Table of records' });
      fireEvent.change(within(popover).getByLabelText('Table'), { target: { value: '@new:crews' } });
      expect(badgeOf('datatable_1')).toBe('Connected to Crews');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(nextBlocked()).toBeNull();
      expect(draft?.saveBlocked).toBeNull();
      undoFromNotice('Connected to Crews. Added a list of Crews to this page.');
      expect(block('datatable_1').querySelector('[data-not-connected]')).not.toBeNull();
    });

    it('asks before leaving a page whose part is not connected: Stay keeps it, Discard changes goes on without saving', async () => {
      const h = harness();
      mount(h, undefined, twoTables);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings for Table of records' }), { key: 'Escape' });
      fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
      const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Home cannot be saved yet' });
      expect(within(dialog).getByText('Connect the parts that need a table, or delete them, to save.')).toBeTruthy();
      expect(h.saves).toHaveLength(0);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(order()).toContain('datatable_1');
      fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
      expect(await screen.findByText('About heading')).toBeTruthy();
      expect(h.saves).toHaveLength(0);
    });

    it('B8: a Quick add dropped next to a list skips a table that needs two fields and binds the next one', async () => {
      const spec = twoTables();
      // People needs a second field with no default, so a Quick add cannot save into it.
      spec.tables = [{ ...peopleTable, fields: [...peopleTable.fields, { id: 'email', label: 'Email', type: 'text' as const, required: true }] }, crewsTable];
      spec.pages[0] = { ...spec.pages[0], sources: [{ ...crewsSource, id: 'all_people', table: 'people' }, crewsSource] };
      mount(harness(), undefined, () => spec);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('button', { name: 'Add Quick add' }));
      expect(badgeOf('quickadd_1')).toBe('Connected to Crews');
    });

    describe('a write part on a table the page does not show', () => {
      const issueText = 'The Quick add on Home adds to People, but nothing on this page shows People.';

      it('is listed as advice, never blocks Next (P-19), can be kept on purpose, survives a remount and comes back with Show again', async () => {
        const first = mount(harness(), undefined, otherTable);
        await screen.findAllByRole('group', { name: 'Quick add' });
        expect(badgeOf('q1')).toBe('Connected to People');
        const issues = screen.getByRole('region', { name: 'Data connections' });
        expect(within(issues).getByText(issueText)).toBeTruthy();
        expect(within(issues).getByRole('button', { name: 'Change table' })).toBeTruthy();
        expect(nextBlocked()).toBeNull();

        fireEvent.click(within(issues).getByRole('button', { name: 'Keep it this way' }));
        expect(nextBlocked()).toBeNull();
        expect(within(screen.getByRole('region', { name: 'Data connections' })).getByText('Kept on purpose:')).toBeTruthy();

        // Kept per app in this browser: a new session still has it kept.
        first.unmount();
        mount(harness(), undefined, otherTable);
        await screen.findAllByRole('group', { name: 'Quick add' });
        expect(nextBlocked()).toBeNull();

        fireEvent.click(within(screen.getByRole('region', { name: 'Data connections' })).getByRole('button', { name: 'Show again' }));
        expect(nextBlocked()).toBeNull();
        expect(within(screen.getByRole('region', { name: 'Data connections' })).getByText(issueText)).toBeTruthy();
      });

      it('Change table opens the settings on the Table setting, and picking Crews clears the issue', async () => {
        mount(harness(), undefined, otherTable);
        await screen.findAllByRole('group', { name: 'Quick add' });
        fireEvent.click(within(screen.getByRole('region', { name: 'Data connections' })).getByRole('button', { name: 'Change table' }));
        const popover = screen.getByRole('dialog', { name: 'Settings for Quick add' });
        const table = within(popover).getByLabelText('Table') as HTMLSelectElement;
        await waitFor(() => expect(document.activeElement).toBe(table));
        fireEvent.change(table, { target: { value: 'crews' } });
        fireEvent.click(within(popover).getByRole('button', { name: 'Apply' }));
        expect(screen.queryByRole('region', { name: 'Data connections' })).toBeNull();
        await waitFor(() => expect(nextBlocked()).toBeNull());
      });
    });
  });

});
